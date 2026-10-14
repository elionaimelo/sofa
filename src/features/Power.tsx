import {
  ArrowClockwiseIcon,
  ArrowUUpLeftIcon,
  BatteryChargingIcon,
  BatteryEmptyIcon,
  BatteryFullIcon,
  BatteryHighIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  GameControllerIcon,
  MoonIcon,
  PowerIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/Dialog";
import type { Translate } from "../i18n";
import {
  commandQuery,
  desktop,
  type InputRef,
  type MessageKey,
  navigateControls,
  queryError,
  serviceError,
  useFeatureInput,
} from "../services";
export type PowerAction = "shutdown" | "restart" | "hibernate";
export type DeviceBattery = {
  index: number;
  model: string | null;
  charge_percent: number | null;
  state: string;
  full_capacity_wh: number | null;
  design_capacity_wh: number | null;
  health_percent: number | null;
  cycles: number | null;
  remaining_seconds: number | null;
  charging_seconds: number | null;
};
export type PowerStatus = {
  batteries: DeviceBattery[];
  ac_power: boolean | null;
  battery_error: boolean;
  controllers: { index: number; kind: string; level: string }[];
  controller_battery_supported: boolean;
  actions: Record<PowerAction, boolean>;
};
export function usePower() {
  const { data, error } = useQuery({
    ...commandQuery<PowerStatus>("power_status"),
    refetchInterval: 5000,
  });
  return { data: data ?? null, error: queryError(error) };
}
/** Controller batteries (XInput); the device battery lives in the top bar and HUD pill. */
export function ControllerBatteries({
  t,
  data,
}: {
  t: Translate;
  data: PowerStatus | null;
}) {
  return (
    <section
      className="battery-section"
      aria-label={t("controllerBattery")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the HUD's spatial navigation must reach this card below the tiles.
      tabIndex={0}
    >
      <h2>{t("controllerBattery")}</h2>
      {!data?.controllers.length ? (
        <p className="muted">
          {t(
            data?.controller_battery_supported
              ? "noBatteryControllers"
              : "controllerBatteryUnavailable",
          )}
        </p>
      ) : (
        <div className="controller-batteries">
          {data.controllers.map((c) => (
            <article key={c.index}>
              <GameControllerIcon size={32} />
              <div>
                <h3>{t("controllerNumber", { index: String(c.index) })}</h3>
                <p>{t(`controller_${c.level}` as Parameters<Translate>[0])}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="inline-note">{t("controllerLevelNote")}</p>
    </section>
  );
}
const actionIcons = {
  shutdown: PowerIcon,
  restart: ArrowClockwiseIcon,
  hibernate: MoonIcon,
};
export function PowerMenu({
  t,
  data,
  input,
  onClose,
}: {
  t: Translate;
  data: PowerStatus | null;
  input: InputRef;
  onClose: () => void;
}) {
  const [action, setAction] = useState<PowerAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | "">("");
  // Focus follows the step: the safe choice when asking, the action again when cancelled.
  const lastAction = useRef<PowerAction | null>(null);
  useEffect(() => {
    if (action) lastAction.current = action;
    document
      .querySelector<HTMLElement>(
        action
          ? "dialog[open] [data-initial-focus]"
          : `dialog[open] [data-power="${lastAction.current}"]`,
      )
      ?.focus();
  }, [action]);
  const close = () => {
    if (!busy) {
      if (action) setAction(null);
      else onClose();
    }
  };
  useFeatureInput(input, (a) => {
    if (a === "b") {
      close();
      return;
    }
    navigateControls(a, document.querySelector("dialog[open]"));
  });
  const execute = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      await desktop("perform_power", { action, confirmed: true });
      onClose();
    } catch (e) {
      setError(serviceError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog label={t("powerMenu")} onClose={close}>
      <div className="settings-head">
        <h1>{action ? t(action) : t("powerMenu")}</h1>
        <button onClick={close} aria-disabled={busy} aria-label={t("close")}>
          <XIcon />
        </button>
      </div>
      <div className="power-menu-body">
        {action ? (
          <>
            <p className="power-confirm-copy">
              {t(action === "hibernate" ? "hibernateConfirm" : "powerConfirm")}
            </p>
            <div className="detail-actions">
              <button
                data-initial-focus
                onClick={() => !busy && setAction(null)}
                aria-disabled={busy}
              >
                <ArrowUUpLeftIcon />
                {t("cancel")}
              </button>
              <button
                className="accent"
                onClick={() => void execute()}
                aria-disabled={busy}
                aria-busy={busy}
              >
                {t(action)}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="power-actions">
              {(["shutdown", "restart", "hibernate"] as const).map((a) => {
                const Icon = actionIcons[a];
                return (
                  <button
                    key={a}
                    data-power={a}
                    disabled={!data?.actions[a]}
                    onClick={() => {
                      setAction(a);
                      setError("");
                    }}
                  >
                    <Icon size={26} />
                    <span>
                      <strong>{t(a)}</strong>
                      <span>
                        {t(`${a}Description` as Parameters<Translate>[0])}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!data?.actions.shutdown && (
              <p className="muted">{t("powerUnavailable")}</p>
            )}
            {data?.actions.shutdown && !data.actions.hibernate && (
              <p className="muted">{t("hibernateUnavailable")}</p>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {t(error as MessageKey)}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function TopBatteries({
  t,
  data,
  onOpen,
}: {
  t: Translate;
  data: PowerStatus | null;
  onOpen: () => void;
}) {
  const battery = data?.batteries[0];
  const percent = battery?.charge_percent;
  // Plugged in counts as charging: the driver reports "unknown" or "full" on a charger.
  const charging = battery?.state === "charging" || data?.ac_power === true;
  const DeviceIcon = charging
    ? BatteryChargingIcon
    : percent == null
      ? BatteryEmptyIcon
      : percent <= 10
        ? BatteryEmptyIcon
        : percent <= 25
          ? BatteryLowIcon
          : percent <= 60
            ? BatteryMediumIcon
            : percent <= 85
              ? BatteryHighIcon
              : BatteryFullIcon;
  const controllers = data?.controllers ?? [];
  const icons: Record<string, typeof BatteryFullIcon> = {
    empty: BatteryEmptyIcon,
    low: BatteryLowIcon,
    medium: BatteryMediumIcon,
    full: BatteryFullIcon,
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>).
    <div
      className="top-batteries"
      role="group"
      aria-label={t("batteryOverview")}
    >
      <button
        className="battery-status device-status"
        onClick={onOpen}
        aria-label={`${t("deviceBattery")}: ${percent == null ? t("battery_unknown") : `${Math.round(percent)}%`}`}
        title={t("deviceBattery")}
        data-low={percent != null && percent <= 20 && !charging}
      >
        <DeviceIcon />
        <span>{percent == null ? "—" : `${Math.round(percent)}%`}</span>
      </button>
      {controllers.slice(0, 2).map((controller) => {
        const Icon = icons[controller.level] ?? BatteryEmptyIcon;
        const description = `${t("controllerNumber", { index: String(controller.index) })}: ${t(`controller_${controller.level}` as Parameters<Translate>[0])}`;
        return (
          <button
            key={controller.index}
            className="controller-status"
            onClick={onOpen}
            aria-label={description}
            title={description}
            data-low={
              controller.level === "low" || controller.level === "empty"
            }
          >
            <span className="controller-marker">
              <GameControllerIcon />
              <small>{controller.index}</small>
            </span>
            {controller.level === "wired" ? (
              <span className="controller-level">USB</span>
            ) : controller.level === "unknown" ? (
              <span className="controller-level">?</span>
            ) : (
              <Icon className="controller-charge" />
            )}
          </button>
        );
      })}
      {controllers.length > 2 && (
        <button
          className="controller-overflow"
          onClick={onOpen}
          aria-label={t("moreControllers", {
            count: String(controllers.length - 2),
          })}
          title={t("controllerBattery")}
        >
          +{controllers.length - 2}
        </button>
      )}
    </div>
  );
}
