import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
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

export type Provider = "steam" | "epic";
export const providers: Provider[] = ["steam", "epic"];
/** Everything under "library" is refreshed together. */
const keys = {
  all: ["library"] as const,
  installed: ["library", "installed"] as const,
  owned: (provider: Provider) => ["library", provider] as const,
};

/** Owned games from the provider's saved session; null when it isn't connected. */
async function ownedLibrary(provider: Provider): Promise<Game[] | null> {
  if (demo) return demoGames.filter((game) => game.source === provider);
  if (!isTauri()) return null;
  try {
    return await invoke<Game[]>(`connect_${provider}_library`, {
      signIn: false,
    });
  } catch (error) {
    if (
      ["notConnected", `${provider}SessionExpired`].includes(
        serviceError(error),
      )
    )
      return null;
    throw error;
  }
}

/** One store account: owned games, sign-in on the store's own page and sign-out. */
function useAccount(provider: Provider, onStatus: Notify) {
  const queryClient = useQueryClient();
  const owned = useQuery({
    queryKey: keys.owned(provider),
    queryFn: () => ownedLibrary(provider),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connect = useMutation({
    mutationFn: () =>
      invoke<Game[]>(`connect_${provider}_library`, { signIn: true }),
    onSuccess: (games) => {
      // Also clears any error from the startup restore attempt.
      queryClient.setQueryData(keys.owned(provider), games);
      onStatus(
        games.length
          ? `${provider}LibraryConnected`
          : `${provider}NoOwnedGames`,
        { count: String(games.length) },
      );
    },
    onError: (error) => {
      const status = httpStatus(error);
      if (status) onStatus("serviceStatus", { status });
      else onStatus(serviceError(error));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => invoke(`disconnect_${provider}_library`),
    onSuccess: () => {
      queryClient.setQueryData(keys.owned(provider), null);
      onStatus(`${provider}LibraryDisconnected`);
    },
    onError: (error) => onStatus(serviceError(error)),
  });
  return {
    owned: owned.data ?? null,
    connected: owned.data != null,
    error: owned.error ? serviceError(owned.error) : null,
    busy: connect.isPending || disconnect.isPending || owned.isPending,
    connect: () => connect.mutate(),
    disconnect: () => disconnect.mutate(),
  };
}

/**
 * Installed games plus owned Steam and Epic games, with store sign-in and the polling
 * that confirms installs and uninstalls started in the launchers.
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
  const steam = useAccount("steam", onStatus);
  const epic = useAccount("epic", onStatus);
  // Steam's manifest reports the download; Sofa comes back in front once it has started.
  const watching = pendingInstalls[0];
  const progress = useQuery({
    queryKey: ["install_progress", watching],
    queryFn: () =>
      invoke<{ downloaded: number; total: number; installed: boolean } | null>(
        "install_progress",
        { id: watching },
      ),
    enabled: !!watching && isTauri() && !demo,
    refetchInterval: 2000,
  });
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!watching || !progress.data || focused.current === watching) return;
    focused.current = watching;
    void invoke("focus_main").catch(() => undefined);
  }, [watching, progress.data]);
  useEffect(() => {
    if (progress.data?.installed)
      void queryClient.invalidateQueries({ queryKey: keys.installed });
  }, [progress.data?.installed, queryClient]);

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

  const games = useMemo(
    () =>
      mergeLibrary(installed.data ?? [], [
        ...(steam.owned ?? []),
        ...(epic.owned ?? []),
      ]),
    [installed.data, steam.owned, epic.owned],
  );
  return {
    games,
    accounts: { steam, epic },
    loading: installed.isFetching,
    scanError: installed.error ? serviceError(installed.error) : ("" as const),
    refresh: () => queryClient.invalidateQueries({ queryKey: keys.all }),
    watchUninstall: setPendingUninstall,
    installProgress:
      watching && progress.data && progress.data.total > 0
        ? {
            id: watching,
            percent: Math.min(
              100,
              Math.round(
                (progress.data.downloaded / progress.data.total) * 100,
              ),
            ),
          }
        : null,
    watchInstall: (id: string) =>
      setPendingInstalls((ids) => (ids.includes(id) ? ids : [...ids, id])),
  };
}
