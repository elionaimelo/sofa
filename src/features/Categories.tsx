import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import { type CategoryMap, cleanCategories, type Game } from "../library";
import { demo } from "../services";

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
      // Results land in batches: one catalog update per game would re-render the library
      // every second for as long as the first fetch takes.
      let batch: Record<string, string[]> = {};
      const flush = () => {
        const found = batch;
        batch = {};
        if (alive && Object.keys(found).length)
          setCatalog((previous) => ({ ...previous, ...found }));
      };
      for (const [index, id] of pending.entries()) {
        if (!alive) break;
        if (index % 10 === 0) flush();
        try {
          const result = cleanCategories(
            await invoke<string[]>("game_categories", {
              id,
              lang,
              title: titles[id],
            }),
          );
          batch[id] = result;
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
      flush();
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
