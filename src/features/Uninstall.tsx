import { ArrowUUpLeftIcon, TrashIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Dialog } from "../components/Dialog";
import type { Translate } from "../i18n";
import type { Game } from "../library";
import { demo, desktop, type MessageKey, serviceError } from "../services";
export function Uninstall({
  game,
  t,
  onUninstalled,
}: {
  game: Game;
  t: Translate;
  onUninstalled: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | "">("");
  const request = useRef(false);
  const close = () => {
    if (!busy) setConfirm(false);
  };
  const uninstall = async () => {
    if (request.current || demo) return;
    request.current = true;
    setBusy(true);
    setError("");
    try {
      await desktop("uninstall_game", { id: game.id, confirmed: true });
      onUninstalled(game.id);
    } catch (e) {
      setError(
        serviceError(e, [
          "confirmationRequired",
          "uninstallUnavailable",
          "gameNoLongerInstalled",
          "unsafeUninstallPath",
          "invalidUninstallManifest",
          "uninstallFailed",
          "uninstallTitleRunning",
          "uninstallSteamRunning",
          "steamCloseFailed",
          "uninstallBusy",
        ]),
      );
    } finally {
      request.current = false;
      setBusy(false);
    }
  };
  if (
    game.source === "gog" ||
    game.source === "xbox" ||
    game.source === "custom"
  )
    return null;
  return (
    <>
      <button
        className="uninstall-trigger"
        disabled={demo}
        title={demo ? t("previewUninstall") : undefined}
        onClick={() => setConfirm(true)}
      >
        <TrashIcon />
        {t("uninstall")}
      </button>
      {confirm && (
        <Dialog
          label={t("uninstallTitle", { title: game.title })}
          onClose={close}
        >
          <div
            className="uninstall-confirm"
            data-confirm
            data-uninstall-busy={busy || undefined}
          >
            <h2>{t("uninstallTitle", { title: game.title })}</h2>
            <p>
              {t(
                game.source === "epic"
                  ? "uninstallEpicConfirm"
                  : "uninstallConfirm",
              )}
            </p>
            <div className="detail-actions">
              <button
                data-confirm-cancel
                data-initial-focus
                aria-disabled={busy}
                onClick={close}
              >
                <ArrowUUpLeftIcon />
                {t("cancel")}
              </button>
              <button
                className="danger-action"
                disabled={demo}
                aria-disabled={busy}
                aria-busy={busy}
                onClick={() => void uninstall()}
              >
                <TrashIcon />
                {t(busy ? "uninstalling" : "uninstall")}
              </button>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {t(error as MessageKey)}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
