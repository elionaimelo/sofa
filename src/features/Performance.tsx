import {
  ArrowsClockwiseIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CursorIcon,
  FanIcon,
  FloppyDiskIcon,
  GameControllerIcon,
  GaugeIcon,
  LightbulbIcon,
  LightningIcon,
  MoonIcon,
  ScalesIcon,
  SparkleIcon,
  SpeakerHighIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ComponentType, useEffect, useRef, useState } from "react";
import type { Translate } from "../i18n";
import { initialLang, isLang, translator } from "../i18n";
import type { Game } from "../library";
import {
  commandQuery,
  desktop,
  type InputRef,
  navigateSpatial,
  serviceError,
  useFeatureInput,
} from "../services";
import { useInput } from "../useInput";
import { ControllerBatteries, usePower } from "./Power";

type Mode = { width: number; height: number; refresh: number };
type DisplayStatus = {
  current: Mode | null;
  modes: Mode[];
  brightness: number | null;
  cpu_boost: boolean | null;
  auto_hdr: boolean | null;
};
type AllyProfile = "silent" | "balanced" | "turbo";
type FanPreset = "default" | "quiet" | "cool";
const fanPresets: FanPreset[] = ["default", "quiet", "cool"];
/** Same list the backend accepts; 0 removes the limit. */
const framerateLimits = [0, 30, 40, 45, 60, 72, 90, 120];
const profileIcons = {
  silent: MoonIcon,
  balanced: ScalesIcon,
  turbo: LightningIcon,
};
function AllyProfiles({
  t,
  onMessage,
  onApplied,
}: {
  t: Translate;
  onMessage: (m: string) => void;
  onApplied?: (profile: AllyProfile) => void;
}) {
  // The device model doesn't change while Sofa runs.
  const status = useQuery({
    ...commandQuery<{ supported: boolean }>("ally_status"),
    staleTime: Infinity,
  });
  const supported = !!status.data?.supported;
  // ponytail: highlights what Sofa requested this session; read DSTS 0x00120075 if Armoury Crate changes drift.
  const [active, setActive] = useState<AllyProfile | null>(null);
  const apply = useMutation({
    mutationFn: (profile: AllyProfile) =>
      desktop("set_ally_profile", { profile }),
    onSuccess: (_, profile) => {
      setActive(profile);
      onApplied?.(profile);
      onMessage(t("allyProfileSent", { profile: t(`ally_${profile}`) }));
    },
    onError: (error) => onMessage(t(serviceError(error))),
  });
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
              // Unsupported devices can't use profiles at all; busy keeps focus (aria-disabled).
              disabled={!supported}
              aria-disabled={apply.isPending}
              aria-busy={apply.isPending}
              onClick={() => !apply.isPending && apply.mutate(profile)}
            >
              <Icon size={22} aria-hidden />
              <strong>{t(`ally_${profile}`)}</strong>
              <small>{t(`ally_${profile}Watts`)}</small>
            </button>
          );
        })}
      </div>
      {!status.isPending && !supported && (
        <p className="muted">{t("allyUnavailable")}</p>
      )}
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
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className="hud-tile"
      aria-expanded={expanded}
      aria-controls={expanded ? "hud-options" : undefined}
      aria-pressed={pressed}
      // aria-disabled keeps the tile focusable while busy, so the controller stays put.
      aria-disabled={onClick ? disabled : undefined}
      onClick={disabled ? undefined : onClick}
    >
      <span className="hud-tile-label">
        <Icon size={20} aria-hidden />
        {label}
        {expanded !== undefined && (
          <CaretDownIcon className="hud-caret" size={16} aria-hidden />
        )}
        {pressed !== undefined && <i className="hud-dot" aria-hidden />}
      </span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </Tag>
  );
}
const inWidget = new URLSearchParams(location.search).get("widget") === "1";
/** Game Bar widget page and the native HUD preview on non-Windows platforms. */
export function Hud() {
  // The widget can't read the library's localStorage: ask the backend, then the browser.
  const saved = useQuery({
    ...commandQuery<string | null>("language"),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  const lang = isLang(saved) ? saved : initialLang();
  document.documentElement.lang = lang;
  const t = translator(lang);
  const inputRef: InputRef = useRef(null);
  useInput(
    (a) => inputRef.current?.(a),
    inWidget && new URLSearchParams(location.search).get("nativeInput") === "1",
  );
  return (
    <HudPanel
      t={t}
      inputRef={inputRef}
      onClose={() => {
        if (isTauri()) void getCurrentWindow().close();
        else if (inWidget) {
          const host = window as Window & {
            chrome?: { webview?: { postMessage: (message: string) => void } };
          };
          host.chrome?.webview?.postMessage("close");
        }
      }}
    />
  );
}

/**
 * HUD content hosted by Game Bar on Windows, or `embedded` in the browser demo dialog.
 */
export function HudPanel({
  t,
  inputRef,
  onClose,
  embedded = false,
}: {
  t: Translate;
  inputRef: InputRef;
  onClose: () => void;
  embedded?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, []);
  const session = useQuery({
    ...commandQuery<{
      game: Game;
      session_seconds: number;
      total_seconds: number;
    } | null>("current_session"),
    refetchInterval: 5000,
  }).data;
  const game = session?.game;
  const queryClient = useQueryClient();
  // Last profile picked in this HUD; what "save for this game" stores.
  const [profile, setProfile] = useState<AllyProfile | null>(null);
  const ally = useQuery({
    ...commandQuery<{
      supported: boolean;
      tdp_supported: boolean;
      tdp: number | null;
      fans: boolean;
      pad: { lighting: boolean | null; mouse_mode: boolean | null };
    }>("ally_status"),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  // Each of these shows a tile only when the piece that does the work is installed.
  const framerate = useQuery(
    commandQuery<{ installed: boolean; limit: number | null }>(
      "framerate_status",
    ),
  ).data;
  const volume = useQuery(
    commandQuery<{ percent: number | null; muted: boolean }>("volume_status"),
  ).data;
  const builtin = useQuery(
    commandQuery<{ enabled: boolean | null }>("builtin_controller"),
  ).data;
  // The firmware doesn't report the active curve; remember what this HUD picked.
  const [fan, setFan] = useState<FanPreset>("default");
  const [tdp, setTdp] = useState<number | null>(null);
  const currentTdp = tdp ?? ally?.tdp ?? null;
  const saved = useQuery({
    ...commandQuery<{
      profile?: AllyProfile;
      mode?: Mode;
      brightness?: number;
      tdp?: number;
    } | null>("game_settings", { id: game?.id }),
    enabled: !!game,
  });
  const saveForGame = useMutation({
    mutationFn: (settings: object | null) =>
      desktop("set_game_settings", { id: game?.id, settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["game_settings"] });
      setMessage(t("hudGameSettingsSaved"));
    },
    onError: (error) => setMessage(t(serviceError(error))),
  });
  const clock = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h}h ${m.toString().padStart(2, "0")}min` : `${m}min`;
  };
  const power = usePower();
  const display = useQuery(commandQuery<DisplayStatus>("display_status")).data;
  const [open, setOpen] = useState<
    | "resolution"
    | "refresh"
    | "brightness"
    | "volume"
    | "tdp"
    | "fps"
    | "fans"
    | null
  >(null);
  const [message, setMessage] = useState("");
  const change = useMutation({
    mutationFn: ({
      command,
      args,
    }: {
      command: string;
      args: Record<string, unknown>;
      refresh: string;
    }) => desktop(command, args),
    onMutate: () => setMessage(""),
    onSuccess: (_, { refresh }) => {
      // The focused option is about to unmount; keep controller focus on its tile.
      document
        .querySelector<HTMLElement>(".hud-tile[aria-expanded='true']")
        ?.focus();
      setOpen(null);
      return queryClient.invalidateQueries({ queryKey: [refresh] });
    },
    onError: (error) => setMessage(t(serviceError(error))),
  });
  const busy = change.isPending;
  const run = (
    command: string,
    args: Record<string, unknown>,
    refresh = "display_status",
  ) => {
    if (!busy) change.mutate({ command, args, refresh });
  };
  const close = onClose;
  useFeatureInput(inputRef, (a) => {
    if (a === "b") {
      if (open) {
        root.current
          ?.querySelector<HTMLElement>(".hud-tile[aria-expanded='true']")
          ?.focus();
        setOpen(null);
      } else close();
    } else {
      const focused = document.activeElement;
      navigateSpatial(a, root.current);
      // Status text can extend below the last button. Keep scrolling at the
      // navigation boundary so every part of a resized widget stays reachable.
      if ((a === "up" || a === "down") && document.activeElement === focused)
        root.current?.scrollBy({ top: a === "down" ? 96 : -96 });
    }
  });
  const Root = embedded ? "div" : "main";
  const current = display?.current;
  const same = (m: Mode, w: number, h: number) =>
    m.width === w && m.height === h;
  const resolutions = (display?.modes ?? []).filter(
    (m, i, all) => all.findIndex((o) => same(o, m.width, m.height)) === i,
  );
  const rates = current
    ? (display?.modes ?? []).filter((m) =>
        same(m, current.width, current.height),
      )
    : [];
  // A new resolution keeps the current refresh rate when the panel supports it there.
  const pickResolution = (m: Mode) =>
    display?.modes.find(
      (o) => same(o, m.width, m.height) && o.refresh === current?.refresh,
    ) ?? m;
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
          : open === "tdp"
            ? [5, 8, 10, 12, 15, 18, 20, 25, 30].map((watts) => ({
                label: `${watts} W`,
                selected: watts === currentTdp,
                pick: () => {
                  setTdp(watts);
                  run("set_tdp", { watts });
                },
              }))
            : open === "volume"
              ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => ({
                  label: percent ? `${percent}%` : t("hudMuted"),
                  selected: volume?.muted
                    ? percent === 0
                    : percent === volume?.percent,
                  pick: () => run("set_volume", { percent }, "volume_status"),
                }))
              : open === "fps"
                ? framerateLimits.map((fps) => ({
                    label: fps ? `${fps} FPS` : t("off"),
                    selected: fps === (framerate?.limit ?? 0),
                    pick: () =>
                      run("set_framerate_limit", { fps }, "framerate_status"),
                  }))
                : open === "fans"
                  ? fanPresets.map((preset) => ({
                      label: t(`fan_${preset}`),
                      selected: preset === fan,
                      pick: () => {
                        setFan(preset);
                        run("set_fan_curve", { preset }, "ally_status");
                      },
                    }))
                  : [];
  const toggle = (name: NonNullable<typeof open>) =>
    setOpen(open === name ? null : name);
  const battery = power.data?.batteries[0]?.charge_percent;
  return (
    <Root className="floating-hud" ref={root as never}>
      {/* Inside the Game Bar widget the host draws the title bar and close button. */}
      {/* The Game Bar draws its own title bar; keep the page heading for screen readers. */}
      {inWidget && <h1 className="visually-hidden">Sofa HUD</h1>}
      {!inWidget && (
        <header data-tauri-drag-region>
          <h1 data-tauri-drag-region>Sofa HUD</h1>
          {battery != null && (
            <span className="hud-pill">{Math.round(battery)}%</span>
          )}
          <button onClick={close} aria-label={t("close")}>
            <XIcon />
          </button>
        </header>
      )}
      <section className="hud-now" aria-label={t("hudNowPlaying")}>
        {game ? (
          <>
            {game.cover && (
              <img src={game.cover} alt="" width={40} height={60} />
            )}
            <div>
              <small>{t("hudNowPlaying")}</small>
              <strong>{game.title}</strong>
              {session && (
                <small>
                  {t("hudSession", {
                    session: clock(session.session_seconds),
                    total: clock(session.total_seconds),
                  })}
                </small>
              )}
            </div>
          </>
        ) : (
          <>
            <GameControllerIcon size={28} aria-hidden />
            <p>{t("hudNoGame")}</p>
          </>
        )}
      </section>
      <AllyProfiles t={t} onMessage={setMessage} onApplied={setProfile} />
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
        {(open === "resolution" || open === "refresh") && (
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
        {volume?.percent != null && (
          <Tile
            icon={SpeakerHighIcon}
            label={t("hudVolume")}
            value={volume.muted ? t("hudMuted") : `${volume.percent}%`}
            note={t("hudTapToChange")}
            expanded={open === "volume"}
            disabled={busy}
            onClick={() => toggle("volume")}
          />
        )}
        {open === "volume" && <Options options={options} disabled={busy} />}
        {ally?.tdp_supported && (
          <Tile
            icon={LightningIcon}
            label={t("hudTdp")}
            value={currentTdp != null ? `${currentTdp} W` : "—"}
            note={t("hudTdpNote")}
            expanded={open === "tdp"}
            disabled={busy}
            onClick={() => toggle("tdp")}
          />
        )}
        {open === "tdp" && <Options options={options} disabled={busy} />}
        {framerate?.installed && (
          <Tile
            icon={GaugeIcon}
            label={t("hudFramerateLimit")}
            value={framerate.limit ? `${framerate.limit} FPS` : t("off")}
            note={t("hudTapToChange")}
            expanded={open === "fps"}
            disabled={busy}
            onClick={() => toggle("fps")}
          />
        )}
        {open === "fps" && <Options options={options} disabled={busy} />}
        {display?.auto_hdr != null && (
          <Tile
            icon={SparkleIcon}
            label="Auto HDR"
            value={t(display.auto_hdr ? "on" : "off")}
            note={t("hudAutoHdrNote")}
            pressed={display.auto_hdr}
            disabled={busy}
            onClick={() => run("set_auto_hdr", { on: !display.auto_hdr })}
          />
        )}
        {ally?.fans && (
          <Tile
            icon={FanIcon}
            label={t("hudFanCurve")}
            value={t(`fan_${fan}`)}
            note={t("hudFanNote")}
            expanded={open === "fans"}
            disabled={busy}
            onClick={() => toggle("fans")}
          />
        )}
        {open === "fans" && <Options options={options} disabled={busy} />}
        {ally?.supported && (
          <>
            <Tile
              icon={LightbulbIcon}
              label={t("hudControllerLighting")}
              value={t(ally.pad.lighting === false ? "off" : "on")}
              pressed={ally.pad.lighting !== false}
              disabled={busy}
              onClick={() =>
                run(
                  "set_controller_lighting",
                  { on: ally.pad.lighting === false },
                  "ally_status",
                )
              }
            />
            <Tile
              icon={CursorIcon}
              label={t("hudMouseMode")}
              value={t(ally.pad.mouse_mode ? "on" : "off")}
              note={t("hudMouseModeNote")}
              pressed={!!ally.pad.mouse_mode}
              disabled={busy}
              onClick={() =>
                run(
                  "set_controller_mode",
                  { mouse: !ally.pad.mouse_mode },
                  "ally_status",
                )
              }
            />
          </>
        )}
        {builtin?.enabled != null && (
          <Tile
            icon={GameControllerIcon}
            label={t("hudExternalController")}
            value={t(builtin.enabled ? "off" : "on")}
            note={t("hudExternalControllerNote")}
            pressed={!builtin.enabled}
            disabled={busy}
            onClick={() =>
              run(
                "set_builtin_controller",
                { enabled: !builtin.enabled },
                "builtin_controller",
              )
            }
          />
        )}
        {game && (
          <Tile
            icon={FloppyDiskIcon}
            label={t("hudSaveForGame")}
            value={t(saved.data ? "on" : "off")}
            note={
              saved.data
                ? [
                    saved.data.profile && t(`ally_${saved.data.profile}`),
                    saved.data.tdp && `${saved.data.tdp} W`,
                    saved.data.mode &&
                      `${saved.data.mode.width}×${saved.data.mode.height} ${saved.data.mode.refresh} Hz`,
                    saved.data.brightness != null &&
                      `${saved.data.brightness}%`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || game.title
                : game.title
            }
            pressed={!!saved.data}
            disabled={busy || saveForGame.isPending || saved.isPending}
            onClick={() =>
              saveForGame.mutate(
                saved.data
                  ? null
                  : {
                      profile: profile ?? undefined,
                      mode: display?.current ?? undefined,
                      brightness: display?.brightness ?? undefined,
                      tdp: tdp ?? undefined,
                    },
              )
            }
          />
        )}
      </div>
      <ControllerBatteries t={t} data={power.data} />
      {/* Live regions stay mounted so screen readers announce changes, not insertions. */}
      <p role="status">{message}</p>
    </Root>
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
    <div className="hud-options" id="hud-options">
      {options.map((o) => (
        <button
          key={o.label}
          // biome-ignore lint/a11y/noAutofocus: the controller needs focus on the current value when the list opens.
          autoFocus={o.selected}
          aria-pressed={o.selected}
          aria-disabled={disabled}
          onClick={disabled ? undefined : o.pick}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
