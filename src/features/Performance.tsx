import { useEffect, useState, type ComponentType } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowsClockwiseIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CpuIcon,
  GameControllerIcon,
  LightningIcon,
  MemoryIcon,
  MoonIcon,
  ScalesIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Translate } from "../i18n";
import type { Game } from "../library";
import { desktop, navigateSpatial, serviceError, usePoll, type MessageKey } from "../services";
import { useInput } from "../useInput";
import { BatteryPanels, usePower } from "./Power";
import { initialLang, translator } from "../i18n";
type Metrics = {
  cpu: number | null;
  used_memory: number;
  total_memory: number;
};
type Mode = { width: number; height: number; refresh: number };
type DisplayStatus = {
  current: Mode | null;
  modes: Mode[];
  brightness: number | null;
  cpu_boost: boolean | null;
};
type AllyProfile = "silent" | "balanced" | "turbo";
const profileIcons = { silent: MoonIcon, balanced: ScalesIcon, turbo: LightningIcon };
function AllyProfiles({ t, onMessage }: { t: Translate; onMessage: (m: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  // ponytail: highlights what Sofa requested this session; read DSTS 0x00120075 if Armoury Crate changes drift.
  const [active, setActive] = useState<AllyProfile | null>(null);
  useEffect(() => {
    let alive = true;
    void desktop<{ supported: boolean }>("ally_status")
      .then((status) => { if (alive) setSupported(status.supported); })
      .catch(() => { if (alive) setSupported(false); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);
  const apply = async (profile: AllyProfile) => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      await desktop("set_ally_profile", { profile });
      setActive(profile);
      onMessage(t("allyProfileSent", { profile: t(`ally_${profile}`) }));
    } catch (error) {
      onMessage(t(serviceError(error)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ally-profiles" aria-label={t("allyProfiles")}>
      <h2>{t("allyProfiles")}</h2>
      <div className="ally-profile-options">
        {(["silent", "balanced", "turbo"] as const).map((profile) => {
          const Icon = profileIcons[profile];
          return (
            <button
              key={profile}
              aria-pressed={active === profile}
              disabled={!supported || busy}
              onClick={() => void apply(profile)}
            >
              <Icon size={22} aria-hidden />
              <strong>{t(`ally_${profile}`)}</strong>
              <small>{t(`ally_${profile}Watts`)}</small>
            </button>
          );
        })}
      </div>
      {!checking && !supported && <p className="muted">{t("allyUnavailable")}</p>}
    </section>
  );
}
function Tile({
  icon: Icon,
  label,
  value,
  note,
  expanded,
  pressed,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  note?: string;
  expanded?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "article";
  return (
    <Tag
      className="hud-tile"
      aria-expanded={expanded}
      aria-pressed={pressed}
      disabled={onClick ? disabled : undefined}
      onClick={onClick}
    >
      <span className="hud-tile-label">
        <Icon size={20} aria-hidden />
        {label}
        {expanded !== undefined && <CaretDownIcon className="hud-caret" size={16} aria-hidden />}
        {pressed !== undefined && <i className="hud-dot" aria-hidden />}
      </span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </Tag>
  );
}
export function Hud() {
  const t = translator(initialLang());
  const { data: metrics, error } = usePoll(() => desktop<Metrics>("system_metrics"), 2000);
  const game = usePoll(() => desktop<Game | null>("current_game"), 5000).data;
  const power = usePower();
  const [display, setDisplay] = useState<DisplayStatus | null>(null);
  const [open, setOpen] = useState<"resolution" | "refresh" | "brightness" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = () =>
    desktop<DisplayStatus>("display_status").then(setDisplay).catch(() => setDisplay(null));
  useEffect(() => void refresh(), []);
  const run = async (command: string, args: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await desktop(command, args);
      // The focused option is about to unmount; keep controller focus on its tile.
      document.querySelector<HTMLElement>(".hud-tile[aria-expanded='true']")?.focus();
      setOpen(null);
      await refresh();
    } catch (e) {
      setMessage(t(serviceError(e)));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };
  useInput((a) => {
    if (a === "b") open ? setOpen(null) : close();
    else navigateSpatial(a, document.querySelector(".floating-hud"));
  });
  const current = display?.current;
  const same = (m: Mode, w: number, h: number) => m.width === w && m.height === h;
  const resolutions = (display?.modes ?? []).filter(
    (m, i, all) => all.findIndex((o) => same(o, m.width, m.height)) === i,
  );
  const rates = current
    ? (display?.modes ?? []).filter((m) => same(m, current.width, current.height))
    : [];
  // A new resolution keeps the current refresh rate when the panel supports it there.
  const pickResolution = (m: Mode) =>
    display?.modes.find((o) => same(o, m.width, m.height) && o.refresh === current?.refresh) ??
    display?.modes.find((o) => same(o, m.width, m.height))!;
  const options =
    open === "resolution"
      ? resolutions.map((m) => ({
          label: `${m.width}×${m.height}`,
          selected: !!current && same(current, m.width, m.height),
          pick: () => run("set_display_mode", { mode: pickResolution(m) }),
        }))
      : open === "refresh"
        ? rates.map((m) => ({
            label: `${m.refresh} Hz`,
            selected: m.refresh === current?.refresh,
            pick: () => run("set_display_mode", { mode: m }),
          }))
        : open === "brightness"
          ? [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => ({
              label: `${percent}%`,
              selected: percent === display?.brightness,
              pick: () => run("set_brightness", { percent }),
            }))
          : [];
  const toggle = (name: NonNullable<typeof open>) => setOpen(open === name ? null : name);
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  const battery = power.data?.batteries[0]?.charge_percent;
  return (
    <main className="floating-hud">
      <header data-tauri-drag-region>
        <span data-tauri-drag-region>Sofa HUD</span>
        {battery != null && <span className="hud-pill">{Math.round(battery)}%</span>}
        <button onClick={close} aria-label={t("close")}>
          <XIcon />
        </button>
      </header>
      <section className="hud-now" aria-label={t("hudNowPlaying")}>
        {game ? (
          <>
            {game.cover && <img src={game.cover} alt="" />}
            <div>
              <small>{t("hudNowPlaying")}</small>
              <strong>{game.title}</strong>
            </div>
          </>
        ) : (
          <>
            <GameControllerIcon size={28} aria-hidden />
            <p>{t("hudNoGame")}</p>
          </>
        )}
      </section>
      <AllyProfiles t={t} onMessage={setMessage} />
      <div className="hud-tiles">
        <Tile
          icon={ArrowsOutIcon}
          label={t("hudResolution")}
          value={current ? `${current.width}×${current.height}` : "—"}
          note={t("hudTapToChange")}
          expanded={open === "resolution"}
          disabled={busy || resolutions.length < 2}
          onClick={() => toggle("resolution")}
        />
        <Tile
          icon={ArrowsClockwiseIcon}
          label={t("hudRefreshRate")}
          value={current ? `${current.refresh} Hz` : "—"}
          note={t("hudTapToChange")}
          expanded={open === "refresh"}
          disabled={busy || rates.length < 2}
          onClick={() => toggle("refresh")}
        />
        {options.length > 0 && open !== "brightness" && (
          <Options options={options} disabled={busy} />
        )}
        <Tile
          icon={SunIcon}
          label={t("hudBrightness")}
          value={display?.brightness != null ? `${display.brightness}%` : "—"}
          note={t("hudTapToChange")}
          expanded={open === "brightness"}
          disabled={busy || display?.brightness == null}
          onClick={() => toggle("brightness")}
        />
        <Tile
          icon={LightningIcon}
          label="CPU Boost"
          value={t(display?.cpu_boost ? "on" : "off")}
          pressed={!!display?.cpu_boost}
          disabled={busy || display?.cpu_boost == null}
          onClick={() => void run("set_cpu_boost", { on: !display?.cpu_boost })}
        />
        {open === "brightness" && <Options options={options} disabled={busy} />}
        <Tile
          icon={CpuIcon}
          label={t("cpuUsage")}
          value={metrics?.cpu != null ? `${metrics.cpu.toFixed(0)}%` : "—"}
          note={metrics?.cpu == null ? t("sampling") : undefined}
        />
        <Tile
          icon={MemoryIcon}
          label={t("memory")}
          value={metrics ? `${gb(metrics.used_memory)} GB` : "—"}
          note={metrics ? t("ofMemory", { total: gb(metrics.total_memory) }) : t("sampling")}
        />
      </div>
      <BatteryPanels t={t} data={power.data} error={power.error} />
      {(message || error) && <p role="status">{message || t(error as MessageKey)}</p>}
    </main>
  );
}
function Options({
  options,
  disabled,
}: {
  options: { label: string; selected: boolean; pick: () => void }[];
  disabled: boolean;
}) {
  return (
    <div className="hud-options">
      {options.map((o) => (
        <button
          key={o.label}
          autoFocus={o.selected}
          aria-pressed={o.selected}
          disabled={disabled}
          onClick={o.pick}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
