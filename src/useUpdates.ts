import { useMutation, useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Notify } from "./services";

/** OTA updates from GitHub Releases and the installed version. */
export function useUpdates(notify: Notify) {
  const installer = useMutation({
    mutationFn: async (next: Update) => {
      await next.downloadAndInstall();
      await relaunch();
    },
    onMutate: (next) => notify("updating", { version: next.version }),
    // The raw error can carry URLs; the message says what to do instead.
    onError: () => notify("updateFailed"),
  });
  const latest = useQuery({
    queryKey: ["update"],
    queryFn: () => check(),
    enabled: isTauri() && !installer.isPending,
    // Sofa can stay open for days as the home app; keep looking for new releases.
    refetchInterval: 6 * 3600_000,
    staleTime: 6 * 3600_000,
    retry: false,
  });
  // The installed binary's version; it can't change while Sofa runs.
  const version = useQuery({
    queryKey: ["app_version"],
    queryFn: getVersion,
    enabled: isTauri(),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  const update = latest.data ?? null;
  return {
    update,
    version,
    checking: latest.isFetching,
    installing: installer.isPending,
    /** Manual check from Settings; reports "up to date" and failures. */
    check: async () => {
      if (!isTauri()) return notify("browserPreview");
      const result = await latest.refetch();
      if (result.error) notify("updateCheckFailed");
      else if (!result.data) notify("noUpdate");
    },
    install: () => {
      if (update && !installer.isPending) installer.mutate(update);
    },
  };
}
