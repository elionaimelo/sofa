import { XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Dialog } from "../components/Dialog";
import { LANGS, type Lang, type Translate } from "../i18n";
import type { Preferences } from "../library";
import {
  commandQuery,
  demo,
  type MessageKey,
  type Notify,
  serviceError,
} from "../services";
import type { useLibrary } from "../useLibrary";
import type { useUpdates } from "../useUpdates";

export type SettingsPanel = "library" | "appearance" | "updates";
type SetPrefs = Dispatch<SetStateAction<Preferences>>;

const titles: Record<SettingsPanel, MessageKey> = {
  library: "librarySettings",
  appearance: "appearance",
  updates: "updates",
};

/** Frame shared by every settings panel: title, close button and status line. */
export function SettingsDialog({
  panel,
  t,
  status,
  onClose,
  children,
}: {
  panel: SettingsPanel;
  t: Translate;
  status: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog label={t(titles[panel])} onClose={onClose}>
      <div className="settings-head">
        <h1>{t(titles[panel])}</h1>
        <button onClick={onClose} aria-label={t("close")}>
          <XIcon />
        </button>
      </div>
      <div className="settings-body">
        {children}
        <p className="settings-status" role="status">
          {status}
        </p>
      </div>
    </Dialog>
  );
}

export function LibrarySettings({
  t,
  library,
  prefs,
  setPrefs,
  onShowHidden,
}: {
  t: Translate;
  library: ReturnType<typeof useLibrary>;
  prefs: Preferences;
  setPrefs: SetPrefs;
  onShowHidden: () => void;
}) {
  return (
    <>
      <section className="library-account">
        <div>
          <h3>Steam</h3>
          <p>{t("steamLibraryDescription")}</p>
        </div>
        {library.steamConnected || demo ? (
          <div className="library-account-connected">
            <span>
              {t("steamLibraryConnected", {
                count: String(library.ownedCount),
              })}
            </span>
            <div className="detail-actions">
              <button
                data-initial-focus
                disabled={library.loading}
                onClick={() => void library.refresh()}
              >
                {t("refresh")}
              </button>
              {!demo && (
                <button
                  disabled={library.steamBusy}
                  onClick={library.disconnectSteam}
                >
                  {t("disconnect")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            data-initial-focus
            className="accent"
            disabled={library.steamBusy || !isTauri()}
            onClick={library.connectSteam}
          >
            {t(library.steamBusy ? "connecting" : "connectSteam")}
          </button>
        )}
        {library.steamError && (
          <p className="inline-error" role="alert">
            {t(library.steamError)}
          </p>
        )}
        <p className="muted">{t("steamLibraryPrivacy")}</p>
      </section>
      <p className="muted">{t("otherSourcesInstalledOnly")}</p>
      <label>
        {t("sort")}
        <select
          value={prefs.sort}
          onChange={(e) =>
            setPrefs((p) => ({
              ...p,
              sort: e.target.value as typeof p.sort,
            }))
          }
        >
          <option value="recent">{t("recent")}</option>
          <option value="title">{t("titleAsc")}</option>
          <option value="titleDesc">{t("titleDesc")}</option>
        </select>
      </label>
      <button onClick={onShowHidden}>
        {t("hidden")} ({prefs.hidden.length})
      </button>
    </>
  );
}

type XboxMode = { home: boolean; startup: boolean; active: boolean | null };

export function AppearanceSettings({
  t,
  lang,
  setLang,
  prefs,
  setPrefs,
  notify,
}: {
  t: Translate;
  lang: Lang;
  setLang: (lang: Lang) => void;
  prefs: Preferences;
  setPrefs: SetPrefs;
  notify: Notify;
}) {
  const queryClient = useQueryClient();
  // Null when Sofa's identity package isn't registered (dev builds).
  const xboxMode =
    useQuery({
      ...commandQuery<XboxMode | null>("xbox_mode_status"),
      enabled: !demo && isTauri(),
    }).data ?? null;
  const fullscreen = useQuery({
    queryKey: ["fullscreen"],
    queryFn: () =>
      isTauri()
        ? getCurrentWindow().isFullscreen()
        : document.fullscreenElement !== null,
  });
  const toggleFullscreen = useMutation({
    mutationFn: async (on: boolean) => {
      if (isTauri()) await getCurrentWindow().setFullscreen(on);
      else if (on) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["fullscreen"] }),
    onError: (error) => notify(serviceError(error)),
  });
  const startup = !!xboxMode?.home && !!xboxMode.startup;
  const toggleStartup = useMutation({
    mutationFn: (on: boolean) => invoke("set_xbox_mode_startup", { on }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["xbox_mode_status"] }),
    onError: (error) => notify(serviceError(error)),
  });
  return (
    <>
      <label>
        {t("language")}
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {Object.entries(LANGS).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("density")}
        <select
          value={prefs.density}
          onChange={(e) =>
            setPrefs((p) => ({
              ...p,
              density: e.target.value as typeof p.density,
            }))
          }
        >
          <option value="comfortable">{t("comfortable")}</option>
          <option value="compact">{t("compact")}</option>
        </select>
      </label>
      {/* Xbox mode owns the window layout; the toggle only makes sense outside it. */}
      {xboxMode?.active !== true && (
        <button
          aria-pressed={!!fullscreen.data}
          disabled={toggleFullscreen.isPending}
          onClick={() => toggleFullscreen.mutate(!fullscreen.data)}
        >
          {t("fullscreen")}: {t(fullscreen.data ? "on" : "off")}
        </button>
      )}
      {xboxMode && (
        <>
          <button
            aria-pressed={startup}
            disabled={toggleStartup.isPending}
            onClick={() => toggleStartup.mutate(!startup)}
          >
            {t("xboxModeStartup")}: {t(startup ? "on" : "off")}
          </button>
          <p className="muted">{t("xboxModeStartupNote")}</p>
          {xboxMode.active === true ? (
            <p className="muted">{t("xboxModeActive")}</p>
          ) : (
            xboxMode.home &&
            xboxMode.active === false && (
              <button
                onClick={() =>
                  void invoke("enter_xbox_mode").catch((error) =>
                    notify(serviceError(error)),
                  )
                }
              >
                {t("enterXboxMode")}
              </button>
            )
          )}
        </>
      )}
    </>
  );
}

export function UpdateSettings({
  t,
  updates,
}: {
  t: Translate;
  updates: ReturnType<typeof useUpdates>;
}) {
  const { update, version } = updates;
  return (
    <>
      {version && <p>{t("installedVersion", { version })}</p>}
      {isTauri() && (
        <button onClick={() => void invoke("open_log").catch(() => undefined)}>
          {t("openLog")}
        </button>
      )}
      <button
        disabled={updates.checking || updates.installing}
        onClick={() => (update ? updates.install() : void updates.check())}
      >
        {update
          ? t("updateAvailable", { version: update.version })
          : t("checkUpdates")}
      </button>
    </>
  );
}
