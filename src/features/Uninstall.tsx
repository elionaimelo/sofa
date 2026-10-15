import { ArrowUUpLeftIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
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
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
    <section
      className="uninstall-section"
      data-uninstall-busy={busy || undefined}
    >
      <p className="uninstall-note">
        {t(game.source === "epic" ? "uninstallEpicNote" : "uninstallSteamNote")}
      </p>
      {confirm ? (
        <div className="uninstall-confirm" data-confirm>
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
              ref={cancel}
              data-confirm-cancel
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                setConfirm(false);
                // Back to the button that asked, not the dialog's close X.
                requestAnimationFrame(() => trigger.current?.focus());
              }}
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
        </div>
      ) : (
        <button
          ref={trigger}
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
          {t(error as MessageKey)}
        </p>
      )}
    </section>
  );
}
