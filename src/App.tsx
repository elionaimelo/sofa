import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { LANGS, type Lang, initialLang, saveLang, translator } from "./i18n";
import "./App.css";

type Game = { id: string; title: string; source: "steam" | "epic" | "gog"; launch: string; cover: string | null };
type Action = "up" | "down" | "left" | "right" | "a" | "y" | "lb" | "rb";

const TABS = ["all", "steam", "epic", "gog"] as const;
const RECENT_KEY = "recent";

const readRecent = (): Record<string, number> => JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}");

const KEYS: Record<string, Action> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "a", u: "y", q: "lb", e: "rb",
};
// Standard gamepad mapping: A, Y, LB, RB, D-pad up/down/left/right.
const BUTTONS: [number, Action][] = [[0, "a"], [3, "y"], [4, "lb"], [5, "rb"], [12, "up"], [13, "down"], [14, "left"], [15, "right"]];
const REPEAT_MS = 180;

function useInput(onAction: (a: Action) => void) {
  const cb = useRef(onAction);
  cb.current = onAction;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.key !== "Enter" && !e.key.startsWith("Arrow")) return;
      const a = KEYS[e.key];
      if (a) { e.preventDefault(); cb.current(a); }
    };
    window.addEventListener("keydown", onKey);

    // Polled because the Gamepad API has no button events. Held directions repeat.
    const last: Partial<Record<Action, number>> = {};
    let raf = 0;
    const poll = () => {
      const now = performance.now();
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const [x = 0, y = 0] = pad.axes;
        const held = new Set<Action>(BUTTONS.filter(([i]) => pad.buttons[i]?.pressed).map(([, a]) => a));
        if (y < -0.5) held.add("up");
        if (y > 0.5) held.add("down");
        if (x < -0.5) held.add("left");
        if (x > 0.5) held.add("right");
        for (const a of Object.keys(last) as Action[]) if (!held.has(a)) delete last[a];
        for (const a of held) {
          const repeats = ["up", "down", "left", "right"].includes(a);
          if (last[a] === undefined || (repeats && now - last[a]! > REPEAT_MS)) {
            last[a] = now;
            cb.current(a);
          }
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); };
  }, []);
}

export default function App() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const [status, setStatus] = useState("");
  const [lang, setLang] = useState(initialLang);
  const [update, setUpdate] = useState<Update | null>(null);
  const t = useMemo(() => translator(lang), [lang]);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => { invoke<Game[]>("scan_library").then(setGames); }, []);
  useEffect(() => saveLang(lang), [lang]);
  // Offline or no release published yet: just no banner.
  useEffect(() => { check().then(setUpdate).catch(() => {}); }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (games ?? [])
      .filter((g) => (tab === "all" || g.source === tab) && g.title.toLowerCase().includes(q))
      .sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0));
  }, [games, tab, query, recent]);

  useEffect(() => setFocus(0), [tab, query]);
  useEffect(() => {
    grid.current?.children[focus]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const play = useCallback(async (g: Game) => {
    const next = { ...readRecent(), [g.id]: Date.now() };
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    setRecent(next);
    setStatus(t("launching", { title: g.title }));
    try { await invoke("launch", { id: g.id }); }
    catch (e) { setStatus(t("launchFailed", { title: g.title, error: String(e) })); return; }
    setTimeout(() => setStatus(""), 3000);
  }, [t]);

  const install = useCallback(async () => {
    if (!update) return;
    setStatus(t("updating", { version: update.version }));
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setStatus(t("updateFailed", { error: String(e) }));
    }
  }, [update, t]);

  useInput((a) => {
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 1;
    const move = (d: number) => setFocus((f) => Math.min(Math.max(f + d, 0), Math.max(visible.length - 1, 0)));
    const shiftTab = (d: number) => setTab((t) => TABS[(TABS.indexOf(t) + d + TABS.length) % TABS.length]);
    ({
      left: () => move(-1), right: () => move(1), up: () => move(-cols), down: () => move(cols),
      lb: () => shiftTab(-1), rb: () => shiftTab(1),
      a: () => visible[focus] && play(visible[focus]),
      y: install,
    })[a]();
  });

  return (
    <main>
      <header>
        <nav role="tablist" aria-label={t("sources")}>
          <kbd aria-hidden>LB</kbd>
          {TABS.map((s) => (
            <button key={s} role="tab" aria-selected={tab === s} tabIndex={-1} onClick={() => setTab(s)}>
              {s === "all" ? t("allGames") : s === "gog" ? "GOG" : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          <kbd aria-hidden>RB</kbd>
        </nav>
        <div className="tools">
          <input type="search" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("searchGames")} />
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("language")}>
            {Object.entries(LANGS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
      </header>

      {games === null ? (
        <p className="empty">{t("scanning")}</p>
      ) : visible.length === 0 ? (
        <p className="empty">{games.length ? t("noMatches") : t("noGames")}</p>
      ) : (
        <div className="grid" ref={grid} role="grid">
          {visible.map((g, i) => (
            <button
              key={g.id}
              className="tile"
              aria-current={i === focus}
              tabIndex={-1}
              onMouseEnter={() => setFocus(i)}
              onClick={() => play(g)}
            >
              {g.cover && <img src={g.cover} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}
              <span className="title">{g.title}</span>
              <span className="badge">{g.source}</span>
            </button>
          ))}
        </div>
      )}

      <footer>
        <span role="status">{status}</span>
        {update && (
          <button className="update" onClick={install}>
            <kbd>Y</kbd> {t("updateAvailable", { version: update.version })}
          </button>
        )}
        <span className="hints"><kbd>A</kbd> {t("play")} <kbd>LB</kbd><kbd>RB</kbd> {t("source")}</span>
      </footer>
    </main>
  );
}
