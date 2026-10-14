import { CheckIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Lang, Translate } from "../i18n";
import {
  type CategoryMap,
  categoryKey,
  cleanCategories,
  type Game,
  gameCategories,
  type Preferences,
} from "../library";
import { demo, keyboardOnActivate } from "../services";

// Demonstration data stays in the explicitly labeled browser demo.
const demoCategories: CategoryMap = {
  "steam:1245620": ["Action", "RPG", "Souls-like", "Open World"],
  "steam:1091500": ["RPG", "Open World", "Cyberpunk"],
  "steam:1086940": ["RPG", "Strategy", "Turn-Based"],
  "steam:1145360": ["Action", "Rogue-like", "Indie"],
  "steam:553850": ["Action", "Co-op", "Shooter"],
  "steam:620": ["Action", "Adventure", "Puzzle", "Co-op"],
  "steam:413150": ["RPG", "Simulation", "Indie"],
  "steam:1030300": ["Action", "Adventure", "Metroidvania", "Indie"],
};
const labels: Record<string, [string, string]> = {
  Action: ["Ação", "Acción"],
  Adventure: ["Aventura", "Aventura"],
  Strategy: ["Estratégia", "Estrategia"],
  Simulation: ["Simulação", "Simulación"],
  Sports: ["Esportes", "Deportes"],
  Racing: ["Corrida", "Carreras"],
  "Souls-like": ["Soulslike", "Soulslike"],
  "Open World": ["Mundo aberto", "Mundo abierto"],
  "Co-op": ["Cooperativo", "Cooperativo"],
  Puzzle: ["Quebra-cabeça", "Puzles"],
  "Turn-Based": ["Por turnos", "Por turnos"],
  Shooter: ["Tiro", "Disparos"],
  Horror: ["Terror", "Terror"],
  "Rogue-like": ["Roguelike", "Roguelike"],
  "Action RPG": ["RPG de ação", "RPG de acción"],
  Singleplayer: ["Um jogador", "Un jugador"],
  Multiplayer: ["Multijogador", "Multijugador"],
  "Dark Fantasy": ["Fantasia sombria", "Fantasía oscura"],
  "Third Person": ["Terceira pessoa", "Tercera persona"],
};
export const categoryLabel = (value: string, lang: Lang) =>
  lang === "en" ? value : (labels[value]?.[lang === "pt-BR" ? 0 : 1] ?? value);
export function useCategories(games: Game[], lang: Lang) {
  const [catalog, setCatalog] = useState<CategoryMap>({});
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  // Rescans hand over a new array every few seconds; only a different set of games (or
  // language: labels come localized from the store) restarts the fetch. Epic and GOG titles
  // are looked up on Steam by name, so the title travels with the id.
  const wanted = games
    .map((g) => `${g.id}\t${g.title}`)
    .sort()
    .join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the retry trigger.
  useEffect(() => {
    if (demo) {
      setCatalog(demoCategories);
      setReady(true);
      return;
    }
    const entries = wanted
      ? wanted.split("\n").map((line) => line.split("\t") as [string, string])
      : [];
    const ids = entries.map(([id]) => id);
    const titles = Object.fromEntries(entries);
    if (!isTauri() || !ids.length) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const run = async () => {
      setLoading(true);
      setUnavailable(false);
      let cached: Record<string, { updated: number; labels: string[] }> = {};
      try {
        cached = await invoke<typeof cached>("cached_categories", { lang });
        if (alive) {
          setCatalog(
            Object.fromEntries(
              Object.entries(cached).map(([id, entry]) => [
                id,
                cleanCategories(entry.labels),
              ]),
            ),
          );
          setReady(true);
        }
      } catch {
        /* Online results still work if cache is unreadable. */
      }
      const pending = ids.filter(
        (id) =>
          !cached[id]?.labels.length ||
          Date.now() / 1000 - cached[id].updated >= 30 * 86400,
      );
      for (const id of pending) {
        if (!alive) break;
        try {
          const result = cleanCategories(
            await invoke<string[]>("game_categories", {
              id,
              lang,
              title: titles[id],
            }),
          );
          if (alive) setCatalog((previous) => ({ ...previous, [id]: result }));
        } catch (e) {
          if (alive) setUnavailable(true);
          // Stop requests when offline or throttled; cached labels and manual categories stay usable.
          if (["network", "rateLimit", "accessDenied"].includes(String(e)))
            break;
        }
        if (alive)
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, 1000);
          });
      }
      if (alive) {
        setLoading(false);
        setReady(true);
      }
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
      wake?.();
    };
  }, [wanted, lang, revision]);
  return {
    catalog,
    ready,
    loading,
    unavailable,
    retry: () => setRevision((n) => n + 1),
  };
}
export function CategoryEditor({
  game,
  prefs,
  catalog,
  t,
  lang,
  onChange,
}: {
  game: Game;
  prefs: Preferences;
  catalog: CategoryMap;
  t: Translate;
  lang: Lang;
  onChange: (labels: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const moreMeasurement = useRef<HTMLSpanElement>(null);
  const manual = prefs.categories[game.id] ?? [];
  const all = gameCategories(game.id, prefs, catalog);
  const names = all.map((label) => categoryLabel(label, lang));
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the labels or language change.
  useLayoutEffect(() => {
    const row = summary.current;
    const measure = measurement.current;
    if (!row || !measure) return;
    const fit = () => {
      const widths = [...measure.children].map(
        (item) => item.getBoundingClientRect().width,
      );
      const available = row.clientWidth;
      const buttonWidth = Math.max(
        ...[...(moreMeasurement.current?.children ?? [])].map(
          (item) => item.getBoundingClientRect().width,
        ),
        0,
      );
      const fullLimit = available - buttonWidth - 12;
      if (widths.reduce((sum, width) => sum + width, 0) <= fullLimit) {
        setVisibleCount(all.length);
        return;
      }
      const limit = fullLimit - 26;
      let used = 0;
      let count = 0;
      for (const width of widths) {
        if (used + width > limit) break;
        used += width;
        count++;
      }
      setVisibleCount(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [all.length, names.join("\0"), lang]);
  const add = () => {
    const next = cleanCategories([...manual, draft]);
    if (next.length > manual.length) {
      onChange(next);
      setDraft("");
    }
  };
  return (
    <section className="category-editor">
      <h2>{t("categories")}</h2>
      <div className="category-summary-line" ref={summary}>
        {names.slice(0, visibleCount).map((name, i) => (
          <span className="category-summary-item" key={categoryKey(all[i])}>
            {i > 0 ? ", " : ""}
            {name}
          </span>
        ))}
        {all.length > visibleCount && (
          <span className="category-summary-ellipsis">…</span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="category-editor-details"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? t("showLessCategories")
            : all.length > visibleCount
              ? t("moreCategories", {
                  count: String(all.length - visibleCount),
                })
              : t("editCategories")}
        </button>
      </div>
      <div
        className="category-summary-measure"
        ref={measurement}
        aria-hidden="true"
      >
        {names.map((name, i) => (
          <span key={categoryKey(all[i])}>
            {i > 0 ? ", " : ""}
            {name}
          </span>
        ))}
      </div>
      <span
        className="category-more-measure"
        ref={moreMeasurement}
        aria-hidden="true"
      >
        <span>{t("moreCategories", { count: String(all.length) })}</span>
        <span>{t("editCategories")}</span>
        <span>{t("showLessCategories")}</span>
      </span>
      {expanded && (
        <div id="category-editor-details">
          <div className="category-chips">
            {all.map((label) =>
              manual.some((m) => categoryKey(m) === categoryKey(label)) ? (
                <button
                  key={categoryKey(label)}
                  onClick={() =>
                    onChange(
                      manual.filter(
                        (m) => categoryKey(m) !== categoryKey(label),
                      ),
                    )
                  }
                  aria-label={t("removeCategory", {
                    category: categoryLabel(label, lang),
                  })}
                >
                  {categoryLabel(label, lang)}
                  <XIcon />
                </button>
              ) : (
                <span key={categoryKey(label)}>
                  {categoryLabel(label, lang)}
                  <CheckIcon aria-hidden />
                </span>
              ),
            )}
          </div>
          <p className="muted">{t("categoriesSource")}</p>
          <form
            className="category-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="new-category">{t("addCategory")}</label>
            <div>
              <input
                {...keyboardOnActivate}
                id="new-category"
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("categoryPlaceholder")}
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!draft.trim() || manual.length >= 40}
                aria-label={t("addCategory")}
              >
                <PlusIcon />
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
