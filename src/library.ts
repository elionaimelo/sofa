export type Game = {
  id: string;
  title: string;
  source: "steam" | "epic" | "gog";
  launch: string;
  cover: string | null;
  installed: boolean;
};
export function mergeLibrary(installed: Game[], owned: Game[]): Game[] {
  const merged = new Map<string, Game>();
  for (const game of owned) merged.set(game.id, { ...game, installed: false });
  for (const game of installed) {
    const account = merged.get(game.id);
    merged.set(game.id, {
      ...account,
      ...game,
      cover: game.cover ?? account?.cover ?? null,
      installed: true,
    });
  }
  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
export type LibraryFilters = {
  categories: string[];
  favoritesOnly: boolean;
  played: "any" | "never" | "recent7" | "recent30";
  artwork: "any" | "with" | "without";
};
export type Preferences = {
  favorites: string[];
  hidden: string[];
  recent: Record<string, number>;
  sort: "recent" | "title" | "titleDesc";
  density: "comfortable" | "compact";
  filters: LibraryFilters;
  categories: Record<string, string[]>;
};
export const defaultFilters: LibraryFilters = {
  categories: [],
  favoritesOnly: false,
  played: "any",
  artwork: "any",
};
export const defaults: Preferences = {
  favorites: [],
  hidden: [],
  recent: {},
  sort: "recent",
  density: "comfortable",
  filters: defaultFilters,
  categories: {},
};
const ids = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string"))]
    : [];
export function parsePreferences(
  raw: string | null,
  legacyRecent: string | null = null,
): Preferences {
  let p: Partial<Preferences> = {};
  try {
    const value = JSON.parse(raw ?? "{}");
    if (value && typeof value === "object") p = value;
  } catch {
    /* Recover corrupt settings. */
  }
  let recent: unknown = p.recent;
  if (!recent) {
    try {
      recent = JSON.parse(legacyRecent ?? "{}");
    } catch {
      recent = {};
    }
  }
  const f =
    p.filters && typeof p.filters === "object" ? p.filters : defaultFilters;
  return {
    favorites: ids(p.favorites),
    hidden: ids(p.hidden),
    recent: Object.fromEntries(
      Object.entries(recent && typeof recent === "object" ? recent : {}).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0,
      ),
    ),
    sort: p.sort === "title" || p.sort === "titleDesc" ? p.sort : "recent",
    density: p.density === "compact" ? "compact" : "comfortable",
    categories: Object.fromEntries(
      Object.entries(
        p.categories && typeof p.categories === "object" ? p.categories : {},
      ).map(([id, labels]) => [id, cleanCategories(labels)]),
    ),
    filters: {
      categories: cleanCategories(f.categories).map(categoryKey),
      favoritesOnly: f.favoritesOnly === true,
      played: ["never", "recent7", "recent30"].includes(f.played)
        ? f.played
        : "any",
      artwork:
        f.artwork === "with" || f.artwork === "without" ? f.artwork : "any",
    },
  };
}
export const activeFilters = (f: LibraryFilters) =>
  f.categories.length +
  Number(f.favoritesOnly) +
  Number(f.played !== "any") +
  Number(f.artwork !== "any");
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
export function filterGames(
  games: Game[],
  p: Preferences,
  tab: string,
  query: string,
  home = false,
  now = Date.now(),
  catalog: CategoryMap = {},
): Game[] {
  const q = fold(query.trim());
  const f = home ? defaultFilters : p.filters;
  return games
    .filter((g) => {
      if (home && !g.installed) return false;
      if (
        (tab === "hidden"
          ? !p.hidden.includes(g.id)
          : p.hidden.includes(g.id)) ||
        !(
          tab === "all" ||
          tab === "hidden" ||
          (tab === "favorites" ? p.favorites.includes(g.id) : g.source === tab)
        ) ||
        !fold(g.title).includes(q)
      )
        return false;
      if (
        f.categories.length &&
        !gameCategories(g.id, p, catalog).some((label) =>
          f.categories.includes(categoryKey(label)),
        )
      )
        return false;
      if (f.favoritesOnly && !p.favorites.includes(g.id)) return false;
      const played = p.recent[g.id];
      if (f.played === "never" && played) return false;
      if (f.played === "recent7" || f.played === "recent30") {
        const days = f.played === "recent7" ? 7 : 30;
        if (!played || played > now || played < now - days * 86400000)
          return false;
      }
      if (
        (f.artwork === "with" && !g.cover) ||
        (f.artwork === "without" && g.cover)
      )
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        (home || p.sort === "recent"
          ? (p.recent[b.id] ?? 0) - (p.recent[a.id] ?? 0)
          : 0) ||
        (!home && p.sort === "titleDesc" ? -1 : 1) *
          a.title.localeCompare(b.title),
    );
}
export function hero(g: Game | undefined): string | undefined {
  if (!g) return;
  return g.source === "steam"
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id.split(":")[1]}/library_hero.jpg`
    : (g.cover ?? undefined);
}

export type CategoryMap = Record<string, string[]>;
export const categoryKey = (label: string) =>
  fold(label).replace(/[^\p{L}\p{N}]/gu, "");
export function cleanCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60 || /[\u0000-\u001f]/.test(label)) continue;
    if (!found.has(categoryKey(label))) found.set(categoryKey(label), label);
    if (found.size >= 40) break;
  }
  return [...found.values()];
}
export function gameCategories(
  id: string,
  p: Preferences,
  catalog: CategoryMap,
): string[] {
  return cleanCategories([...(catalog[id] ?? []), ...(p.categories[id] ?? [])]);
}
export function categoryOptions(
  games: Game[],
  p: Preferences,
  catalog: CategoryMap,
) {
  const options = new Map<
    string,
    { key: string; label: string; count: number }
  >();
  for (const game of games)
    for (const label of gameCategories(game.id, p, catalog)) {
      const key = categoryKey(label);
      const option = options.get(key) ?? { key, label, count: 0 };
      option.count++;
      options.set(key, option);
    }
  return [...options.values()];
}
