import { useEffect, useRef } from "react";
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "home"
  | "settings"
  | "menu"
  | "power"
  | "filters";
const keys: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "a",
  Escape: "b",
  x: "x",
  u: "y",
  q: "lb",
  e: "rb",
  Home: "home",
  F2: "settings",
  F4: "power",
  f: "filters",
  m: "menu",
};
const buttons: [number, Action][] = [
  [0, "a"],
  [1, "b"],
  [2, "x"],
  [3, "y"],
  [4, "lb"],
  [5, "rb"],
  [9, "settings"],
  [8, "menu"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];
export function useInput(onAction: (action: Action) => void) {
  const cb = useRef(onAction);
  cb.current = onAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target;
      const editing =
        target instanceof HTMLElement &&
        (target.matches("input, select, textarea") || target.isContentEditable);
      if (editing && e.key !== "Escape") return;
      // Native controls handle Enter/Space themselves; avoid firing twice.
      if (target instanceof HTMLButtonElement && e.key === "Enter") return;
      const a = keys[e.key];
      if (a && (!e.repeat || ["up", "down", "left", "right"].includes(a))) {
        document.documentElement.classList.remove("gamepad-input");
        e.preventDefault();
        cb.current(a);
      }
    };
    window.addEventListener("keydown", onKey);
    const last = new Map<Action, number>();
    const deferred: Action[] = ["menu", "settings"];
    let chord = false;
    const fire = (a: Action) => {
      document.documentElement.classList.add("gamepad-input");
      cb.current(a);
    };
    let raf = 0;
    const poll = () => {
      if (!document.hasFocus()) {
        last.clear();
        raf = requestAnimationFrame(poll);
        return;
      }
      const now = performance.now(),
        held = new Set<Action>();
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (pad?.mapping !== "standard") continue;
        for (const [i, a] of buttons) if (pad.buttons[i]?.pressed) held.add(a);
        const [x = 0, y = 0] = pad.axes;
        if (y < -0.5) held.add("up");
        if (y > 0.5) held.add("down");
        if (x < -0.5) held.add("left");
        if (x > 0.5) held.add("right");
      }
      // View + Menu together toggles the native HUD; those two fire on release
      // so the chord doesn't also open the menu or settings here.
      if (held.has("menu") && held.has("settings")) chord = true;
      for (const a of last.keys())
        if (!held.has(a)) {
          last.delete(a);
          if (deferred.includes(a) && !chord) fire(a);
        }
      if (!held.has("menu") && !held.has("settings")) chord = false;
      for (const a of held) {
        const repeats = ["up", "down", "left", "right"].includes(a);
        if (!last.has(a) || (repeats && now - (last.get(a) ?? 0) > 180)) {
          last.set(a, now);
          if (!deferred.includes(a)) fire(a);
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, []);
}
