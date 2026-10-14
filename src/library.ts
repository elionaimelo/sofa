export type Game = {
  id: string;
  title: string;
  source: "steam" | "epic" | "gog";
  launch: string;
  cover: string | null;
  installed: boolean;
  /** Unix seconds of the launcher's last recorded session (Steam). */
  last_played?: number;
  /** Total minutes played, as Steam counts it. */
  playtime?: number;
  /** Bytes on disk, when the launcher's manifest records it. */
  size?: number;
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
/** Heading for a title-sorted group: its first letter, or "#" for digits and symbols. */
export function titleGroup(title: string): string {
  const first = title.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(first) ? first : "#";
}
export type LibraryFilters = {
  categories: string[];
  favoritesOnly: boolean;
  played: "any" | "never" | "recent7" | "recent30";
  artwork: "any" | "with" | "without";
};
/** Steam store regions the price lookup accepts; the backend holds the same list. */
export const regions = ["us", "br", "es", "mx", "ar", "pt"] as const;
export type Region = (typeof regions)[number];
export type Preferences = {
  favorites: string[];
  hidden: string[];
  recent: Record<string, number>;
  sort: "recent" | "mostPlayed" | "installed" | "title" | "size";
  density: "comfortable" | "compact";
  /** Unset means "follow the language" (see App). */
  region?: Region;
  filters: LibraryFilters;
  categories: Record<string, string[]>;
};
const sorts: Preferences["sort"][] = [
  "recent",
  "mostPlayed",
  "installed",
  "title",
  "size",
];
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
    sort: sorts.find((sort) => sort === p.sort) ?? "recent",
    density: p.density === "compact" ? "compact" : "comfortable",
    ...(regions.includes(p.region as Region)
      ? { region: p.region as Region }
      : {}),
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
  // Built once per call: libraries can hold thousands of owned games.
  const hidden = new Set(p.hidden);
  const favorites = new Set(p.favorites);
  const wanted = new Set(f.categories);
  return games
    .filter((g) => {
      if (home && !g.installed) return false;
      if (
        hidden.has(g.id) ||
        !(
          tab === "all" ||
          (tab === "favorites" ? favorites.has(g.id) : g.source === tab)
        ) ||
        (q !== "" && !fold(g.title).includes(q))
      )
        return false;
      if (
        wanted.size &&
        !gameCategories(g.id, p, catalog).some((label) =>
          wanted.has(categoryKey(label)),
        )
      )
        return false;
      if (f.favoritesOnly && !favorites.has(g.id)) return false;
      const played = lastPlayed(g, p);
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
    .sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title);
      if (home || p.sort === "recent")
        return lastPlayed(b, p) - lastPlayed(a, p) || byTitle;
      switch (p.sort) {
        case "mostPlayed":
          return (b.playtime ?? 0) - (a.playtime ?? 0) || byTitle;
        case "installed":
          return Number(b.installed) - Number(a.installed) || byTitle;
        // Biggest first, to free space; games without a known size go last.
        case "size":
          return (b.size ?? -1) - (a.size ?? -1) || byTitle;
        default:
          return byTitle;
      }
    });
}
/** Milliseconds of the latest session: a launch from Sofa or one the launcher recorded. */
export const lastPlayed = (g: Game, p: Preferences) =>
  Math.max(p.recent[g.id] ?? 0, (g.last_played ?? 0) * 1000);
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
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
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
