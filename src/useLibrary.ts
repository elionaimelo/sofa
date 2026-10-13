import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { type Game, mergeLibrary } from "./library";
import { demo, httpStatus, type Notify, serviceError } from "./services";

const demoGames: Game[] = [
  ["1245620", "ELDEN RING"],
  ["1091500", "Cyberpunk 2077"],
  ["1086940", "Baldur's Gate 3"],
  ["1145360", "Hades"],
  ["553850", "HELLDIVERS 2"],
  ["620", "Portal 2"],
  ["413150", "Stardew Valley"],
  ["1030300", "Hollow Knight: Silksong"],
].map(([id, title], index) => ({
  id: `steam:${id}`,
  title,
  source: "steam",
  launch: "",
  cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  installed: index < 2,
}));
demoGames.push({
  id: "epic:demo-control",
  title: "Control",
  source: "epic",
  launch: "",
  cover:
    "https://cdn.cloudflare.steamstatic.com/steam/apps/870780/library_600x900.jpg",
  installed: true,
});

/** Everything under "library" is refreshed together. */
const keys = {
  all: ["library"] as const,
  installed: ["library", "installed"] as const,
  steam: ["library", "steam"] as const,
};

/** Owned Steam games from the saved session; null when Steam isn't connected. */
async function steamLibrary(): Promise<Game[] | null> {
  if (demo) return demoGames.filter((game) => game.source === "steam");
  if (!isTauri()) return null;
  try {
    return await invoke<Game[]>("connect_steam_library", { signIn: false });
  } catch (error) {
    if (["notConnected", "steamSessionExpired"].includes(serviceError(error)))
      return null;
    throw error;
  }
}

/**
 * Installed games plus owned Steam games, with Steam sign-in and the polling that
 * confirms installs and uninstalls started in the launchers.
 */
export function useLibrary(onStatus: Notify) {
  const queryClient = useQueryClient();
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
  const [pendingInstalls, setPendingInstalls] = useState<string[]>([]);
  const pending = !!pendingUninstall || pendingInstalls.length > 0;
  const installed = useQuery({
    queryKey: keys.installed,
    queryFn: () =>
      demo
        ? demoGames.filter((game) => game.installed)
        : isTauri()
          ? invoke<Game[]>("scan_library")
          : [],
    // Rescanned on demand, and every few seconds while a launcher installs or uninstalls.
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: pending ? 4000 : false,
    refetchOnWindowFocus: pending,
  });
  const steam = useQuery({
    queryKey: keys.steam,
    queryFn: steamLibrary,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connect = useMutation({
    mutationFn: () => invoke<Game[]>("connect_steam_library", { signIn: true }),
    onSuccess: (owned) => {
      // Also clears any error from the startup restore attempt.
      queryClient.setQueryData(keys.steam, owned);
      onStatus(owned.length ? "steamLibraryConnected" : "steamNoOwnedGames", {
        count: String(owned.length),
      });
    },
    onError: (error) => {
      const status = httpStatus(error);
      if (status) onStatus("serviceStatus", { status });
      else onStatus(serviceError(error));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => invoke("disconnect_steam_library"),
    onSuccess: () => {
      queryClient.setQueryData(keys.steam, null);
      onStatus("steamLibraryDisconnected");
    },
    onError: (error) => onStatus(serviceError(error)),
  });

  // Each scan settles pending launcher work; never claim it before the scan shows it.
  const scanned = installed.data;
  useEffect(() => {
    if (!scanned) return;
    if (pendingUninstall && !scanned.some((g) => g.id === pendingUninstall)) {
      setPendingUninstall(null);
      onStatus("uninstallComplete");
    }
    const done = pendingInstalls.filter((id) =>
      scanned.some((g) => g.id === id),
    );
    if (done.length) {
      setPendingInstalls((ids) => ids.filter((id) => !done.includes(id)));
      onStatus("installComplete");
    }
  }, [scanned, pendingUninstall, pendingInstalls, onStatus]);
  useEffect(() => {
    if (!pendingUninstall) return;
    const id = setTimeout(() => {
      setPendingUninstall(null);
      onStatus("uninstallStillInstalled");
    }, 120_000);
    return () => clearTimeout(id);
  }, [pendingUninstall, onStatus]);

  const owned = steam.data ?? null;
  const games = useMemo(
    () => mergeLibrary(installed.data ?? [], owned ?? []),
    [installed.data, owned],
  );
  return {
    games,
    ownedCount: owned?.length ?? 0,
    steamConnected: owned !== null,
    steamError: steam.error ? serviceError(steam.error) : null,
    steamBusy: connect.isPending || disconnect.isPending || steam.isPending,
    loading: installed.isFetching,
    scanError: installed.error ? serviceError(installed.error) : ("" as const),
    refresh: () => queryClient.invalidateQueries({ queryKey: keys.all }),
    connectSteam: () => connect.mutate(),
    disconnectSteam: () => disconnect.mutate(),
    watchUninstall: setPendingUninstall,
    watchInstall: (id: string) =>
      setPendingInstalls((ids) => (ids.includes(id) ? ids : [...ids, id])),
  };
}
