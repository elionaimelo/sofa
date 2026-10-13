import { useEffect, useRef, useState } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import { desktop, demo, serviceError } from "../services";
import type { Translate } from "../i18n";
import type { Game } from "../library";
export function Uninstall({
  game,
  t,
  onStarted,
}: {
  game: Game;
  t: Translate;
  onStarted: (id: string, completed: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const request = useRef(false);
  useEffect(() => {
    if (confirm) cancel.current?.focus();
  }, [confirm]);
  const uninstall = async () => {
    if (request.current || demo) return;
    request.current = true;
    setBusy(true);
    setError("");
    try {
      const completed = await desktop<boolean>("uninstall_game", {
        id: game.id,
        confirmed: true,
      });
      onStarted(game.id, completed);
    } catch (e) {
      setError(
        [
          "confirmationRequired",
          "uninstallUnavailable",
          "gameNoLongerInstalled",
          "unsafeUninstallPath",
          "invalidUninstallManifest",
          "uninstallFailed",
          "uninstallTitleRunning",
          "uninstallBusy",
          "desktopRequired",
        ].includes(String(e))
          ? String(e)
          : serviceError(e),
      );
    } finally {
      request.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="uninstall-section"
      data-uninstall-busy={busy || undefined}
    >
      <p className="uninstall-note">
        {t(
          game.source === "epic"
            ? "uninstallEpicNote"
            : game.source === "gog"
              ? "uninstallGogNote"
              : "uninstallSteamNote",
        )}
      </p>
      {confirm ? (
        <div className="uninstall-confirm" data-uninstall-confirm>
          <h2>{t("uninstallTitle", { title: game.title })}</h2>
          <p>
            {t(
              game.source === "epic"
                ? "uninstallEpicConfirm"
                : game.source === "gog"
                  ? "uninstallGogConfirm"
                  : "uninstallConfirm",
            )}
          </p>
          <div className="detail-actions">
            <button
              ref={cancel}
              data-uninstall-cancel
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {t("cancel")}
            </button>
            <button
              className="danger-action"
              disabled={busy || demo}
              onClick={() => void uninstall()}
            >
              <TrashIcon />
              {t(game.source === "steam" ? "uninstallSteam" : "uninstall")}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="uninstall-trigger"
          disabled={demo}
          onClick={() => setConfirm(true)}
        >
          <TrashIcon />
          {t("uninstall")}
        </button>
      )}
      {demo && <p className="uninstall-note">{t("previewUninstall")}</p>}
      {error && (
        <p className="inline-error" role="alert">
          {t(error as Parameters<Translate>[0])}
        </p>
      )}
    </section>
  );
}
