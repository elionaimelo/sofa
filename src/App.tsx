import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AnimatePresence } from "motion/react";
import {
  type CSSProperties,
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog } from "./components/Dialog";
import { LaunchScreen } from "./components/LaunchScreen";
import { Picker } from "./components/Picker";
import { Scene } from "./components/Scene";
import { SearchField } from "./components/SearchField";
import { SofaIcon } from "./components/SofaIcon";
import { initialLang, type Lang, saveLang, translator } from "./i18n";
import {
  activeFilters,
  categoryOptions,
  defaultFilters,
  filterGames,
  type Game,
  hero,
  parsePreferences,
  titleGroup,
} from "./library";
import { useInput } from "./useInput";
import { useLibrary } from "./useLibrary";
import { useUpdates } from "./useUpdates";
import "./App.css";
import "@fontsource-variable/outfit";
import {
  AppWindowIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BluetoothIcon,
  CheckIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  GaugeIcon,
  GearSixIcon,
  HardDrivesIcon,
  HeartIcon,
  HouseIcon,
  InfoIcon,
  PlayIcon,
  PowerIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  CategoryEditor,
  categoryLabel,
  useCategories,
} from "./features/Categories";
import { HudPanel } from "./features/Performance";
import { PowerMenu, TopBatteries, usePower } from "./features/Power";
import {
  AppearanceSettings,
  AppsSettings,
  ControllerSettings,
  LibrarySettings,
  SettingsDialog,
  type SettingsPanel,
  UpdateSettings,
} from "./features/Settings";
import { Store } from "./features/Store";
import { Uninstall } from "./features/Uninstall";
import {
  commandQuery,
  demo,
  desktop,
  type InputRef,
  type Notify,
  navigateControls,
  navigateSpatial,
  pickerInput,
  serviceError,
} from "./services";

const PAGES = ["home", "library", "store"] as const;
const pageIcons = {
  home: HouseIcon,
  library: SquaresFourIcon,
  store: StorefrontIcon,
};
const TABS = ["all", "favorites", "steam", "epic", "gog"] as const;
const preferencesKey = demo ? "sofa.demo.preferences" : "sofa.preferences";
/** Whole gigabytes as Windows counts them (1024³), enough for a storage overview. */
const gb = (bytes: number) => String(Math.round(bytes / 1024 ** 3));
/** Hours with one decimal from Steam's minutes; nothing under six minutes. */
const hoursPlayed = (minutes: number) =>
  minutes >= 6 ? `${(minutes / 60).toFixed(minutes >= 600 ? 0 : 1)} h` : "";
/** One decimal above a gigabyte, whole megabytes below. */
const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
/**
 * Steam's portrait art is missing for some titles and, for newer ones, so is the header on
 * the legacy CDN (their assets moved to hashed paths); the hero banner is the last resort.
 */
function coverSources(game: Game): string[] {
  const sources = game.cover ? [game.cover] : [];
  const appId = game.id.startsWith("steam:") ? game.id.slice(6) : "";
  if (/^\d+$/.test(appId))
    sources.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    );
  return sources.filter((source, i) => sources.indexOf(source) === i);
}
/** The art alone, trying each source in turn; nothing when all fail. */
function CoverImage({ game }: { game: Game }) {
  const [failed, setFailed] = useState(0);
  const src = coverSources(game)[failed];
  return (
    src && (
      <img
        src={src}
        alt=""
        loading="lazy"
        data-fallback={failed > 0 || undefined}
        onError={() => setFailed((n) => n + 1)}
      />
    )
  );
}
function Cover({ game }: { game: Game }) {
  return (
    <>
      <CoverImage game={game} />
      <span className="title">
        <span>{game.title}</span>
      </span>
      <span className="badge">{game.source}</span>
    </>
  );
}
/** Ticks on its own so the clock doesn't re-render the whole library every 30 s. */
function Clock({ lang }: { lang: Lang }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <time>
      {now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
export default function App() {
  const [page, setPage] = useState<(typeof PAGES)[number] | "settings">("home");
  const [tabChoice, setTab] = useState<(typeof TABS)[number]>("all");
  const [query, setQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The drawer's two tabs: the (possibly long) category list, and the other filters.
  const [filterTab, setFilterTab] = useState<"categories" | "options">(
    "categories",
  );
  const [focus, setFocus] = useState(0);
  const [prefs, setPrefs] = useState(() =>
    parsePreferences(
      localStorage.getItem(preferencesKey),
      demo ? null : localStorage.getItem("recent"),
    ),
  );
  const [status, setStatus] = useState("");
  // Status lines are transient feedback; a stale "installing…" or error misleads later.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(""), 8000);
    return () => clearTimeout(id);
  }, [status]);
  const [lang, setLang] = useState(initialLang);
  const [details, setDetails] = useState<Game | null>(null);
  const [settings, setSettings] = useState<SettingsPanel | null>(null);
  const [powerMenu, setPowerMenu] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  const [launchScreen, setLaunchScreen] = useState<Game | null>(null);
  const hudInput: InputRef = useRef(null);
  // The launch screen stays until the game takes focus; launchers can take a while.
  useEffect(() => {
    if (!launchScreen) return;
    const done = () => setLaunchScreen(null);
    const timeout = setTimeout(done, 30_000);
    window.addEventListener("blur", done);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("blur", done);
    };
  }, [launchScreen]);
  const powerInput: InputRef = useRef(null);
  const power = usePower();
  const [launching, setLaunching] = useState(false);
  const t = useMemo(() => translator(lang), [lang]);
  // Async work reads the current language here, so switching it doesn't rescan or re-check updates.
  const tRef = useRef(t);
  tRef.current = t;
  const grid = useRef<HTMLDivElement>(null);
  const sortSelect = useRef<HTMLButtonElement>(null);
  const featureInput: InputRef = useRef(null);
  const launchBusy = useRef(false);
  const notify = useCallback<Notify>(
    (message, values) => setStatus(tRef.current(message, values)),
    [],
  );
  const library = useLibrary(notify);
  const updates = useUpdates(notify);
  // Expected download of an owned Steam game, from its store requirements.
  const sizeEstimate = useQuery({
    ...commandQuery<number | null>("game_size_estimate", {
      id: details?.id,
      title: details?.title,
    }),
    enabled: !!details && !details.installed && isTauri(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Fixed disks for the storage card; looked up again when the user comes back to Sofa.
  const storage = useQuery({
    ...commandQuery<{ name: string; total: number; available: number }[]>(
      "storage_status",
    ),
    enabled: page === "settings" && isTauri(),
    refetchOnWindowFocus: true,
  });
  const { update, install } = updates;
  const { games, loading, scanError } = library;
  const categories = useCategories(games, lang);
  // One line of facts under a title: last session, hours, size on disk or to download.
  const gameMeta = (game: Game, lastAt?: number, estimate?: number) =>
    [
      lastAt
        ? t("lastPlayed", { date: new Date(lastAt).toLocaleDateString(lang) })
        : t("neverPlayed"),
      game.playtime
        ? t("hoursPlayed", { hours: hoursPlayed(game.playtime) })
        : "",
      game.installed && game.size != null
        ? t("diskSpaceUsed", { size: formatSize(game.size) })
        : estimate != null
          ? t("downloadEstimate", { size: formatSize(estimate) })
          : "",
    ]
      .filter(Boolean)
      .join(" · ");
  // Active filters per drawer tab, shown on the tab itself.
  const filterCount = (tab: "categories" | "options") =>
    tab === "categories"
      ? prefs.filters.categories.length
      : Number(prefs.filters.played !== "any") +
        Number(prefs.filters.artwork !== "any") +
        Number(prefs.filters.favoritesOnly);
  // Store prices follow the language unless the user picked a region.
  const region =
    prefs.region ?? (lang === "pt-BR" ? "br" : lang === "es" ? "es" : "us");
  useEffect(() => saveLang(lang), [lang]);
  useEffect(() => {
    localStorage.setItem(preferencesKey, JSON.stringify(prefs));
  }, [prefs]);
  const availableTabs = useMemo(
    () =>
      TABS.filter(
        (value) =>
          value === "all" ||
          value === "favorites" ||
          games.some((game) => game.source === value),
      ),
    [games],
  );
  // A source tab disappears when its last game does; fall back to "all" without an extra render.
  const tab = availableTabs.includes(tabChoice) ? tabChoice : "all";
  // Typing stays responsive with thousands of owned games; the grid catches up a frame later.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () =>
      filterGames(
        games,
        prefs,
        page === "home" ? "all" : tab,
        page === "home" ? "" : deferredQuery,
        page === "home",
        Date.now(),
        categories.catalog,
      ),
    [games, prefs, page, tab, deferredQuery, categories.catalog],
  );
  const categoryChoices = useMemo(
    () =>
      categoryOptions(
        games.filter((g) => !prefs.hidden.includes(g.id)),
        prefs,
        categories.catalog,
      ).sort((a, b) =>
        categoryLabel(a.label, lang).localeCompare(
          categoryLabel(b.label, lang),
        ),
      ),
    [games, prefs, categories.catalog, lang],
  );
  useEffect(() => {
    if (!games.length || !categories.ready || categories.loading) return;
    const available = new Set(categoryChoices.map((c) => c.key));
    setPrefs((p) =>
      p.filters.categories.some((key) => !available.has(key))
        ? {
            ...p,
            filters: {
              ...p.filters,
              categories: p.filters.categories.filter((key) =>
                available.has(key),
              ),
            },
          }
        : p,
    );
  }, [games.length, categories.ready, categories.loading, categoryChoices]);
  const toggleCategory = (key: string) =>
    setPrefs((p) => ({
      ...p,
      filters: {
        ...p.filters,
        categories: p.filters.categories.includes(key)
          ? p.filters.categories.filter((c) => c !== key)
          : [...p.filters.categories, key],
      },
    }));
  const selected = visible[Math.min(focus, Math.max(0, visible.length - 1))];
  useEffect(() => {
    if (!details) return;
    const current = games.find((game) => game.id === details.id);
    if (current && current.installed !== details.installed) setDetails(current);
  }, [games, details]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab, search, page or filter starts at the first tile.
  useEffect(() => setFocus(0), [tab, query, page, prefs.filters, prefs.sort]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab shows new controls; focus the first one.
  useEffect(() => {
    if (filtersOpen)
      document
        .querySelector<HTMLElement>(
          "[data-filter-panel] [data-tabpanel] :is(button:not(:disabled), input)",
        )
        ?.focus();
  }, [filtersOpen, filterTab]);
  useEffect(
    () => setFocus((f) => Math.min(f, Math.max(0, visible.length - 1))),
    [visible.length],
  );
  // Letter headings sit between tiles when sorting by title; index tiles, not children.
  const tileAt = useCallback(
    (i: number) => grid.current?.querySelectorAll<HTMLElement>(".tile")[i],
    [],
  );
  // Hiding or uninstalling the focused game removes its tile (and the dialog's return
  // target); put controller focus back on the grid instead of losing it to <body>.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    const tile = tileAt(Math.min(focus, visible.length - 1));
    tile?.focus();
  }, [visible.length, focus, tileAt]);
  useEffect(() => {
    tileAt(focus)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [focus, tileAt]);
  const toggleFavorite = (g: Game) =>
    setPrefs((p) => ({
      ...p,
      favorites: p.favorites.includes(g.id)
        ? p.favorites.filter((id) => id !== g.id)
        : [...p.favorites, g.id],
    }));
  const toggleHidden = (g: Game) => {
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(g.id)
        ? p.hidden.filter((id) => id !== g.id)
        : [...p.hidden, g.id],
    }));
    setDetails(null);
  };
  const closeDetails = () => {
    if (!document.querySelector("[data-uninstall-busy]")) setDetails(null);
  };
  const play = async (g: Game) => {
    if (!g.installed) return;
    if (launchBusy.current) return;
    if (demo) {
      // The preview shows the launch screen without starting anything.
      setLaunchScreen(g);
      return;
    }
    if (!isTauri()) {
      setStatus(t("browserPreview"));
      return;
    }
    launchBusy.current = true;
    setLaunching(true);
    setLaunchScreen(g);
    try {
      await invoke("launch", { id: g.id });
      setPrefs((p) => ({ ...p, recent: { ...p.recent, [g.id]: Date.now() } }));
      setDetails(null);
      setStatus("");
    } catch (e) {
      setLaunchScreen(null);
      setStatus(
        t("launchFailed", { title: g.title, error: t(serviceError(e)) }),
      );
    } finally {
      launchBusy.current = false;
      setLaunching(false);
    }
  };
  const hudLaunch = useMutation({
    mutationFn: () => desktop("open_hud"),
    onError: (error) => notify(serviceError(error)),
  });
  const openHud = () => {
    if (demo) setHudOpen(true);
    else if (!hudLaunch.isPending) hudLaunch.mutate();
  };
  const installGame = async (game: Game) => {
    if (game.installed) return;
    if (demo || !isTauri()) {
      setStatus(t(demo ? "previewInstall" : "browserPreview"));
      return;
    }
    try {
      await invoke("install_owned_game", { id: game.id });
      library.watchInstall(game.id);
      setStatus(
        t("installRequested", {
          title: game.title,
          launcher: game.source === "epic" ? "Epic Games" : "Steam",
        }),
      );
    } catch (error) {
      setStatus(t(serviceError(error)));
    }
  };
  useInput((a) => {
    if (pickerInput.current) {
      pickerInput.current(a);
      return;
    }
    if (launchScreen) {
      if (a === "b") setLaunchScreen(null);
      return;
    }
    if (hudOpen) {
      hudInput.current?.(a);
      return;
    }
    if (
      a === "filters" &&
      page === "library" &&
      !settings &&
      !details &&
      !powerMenu
    ) {
      setFiltersOpen((open) => !open);
      return;
    }

    if (powerMenu) {
      powerInput.current?.(a);
      return;
    }
    const uninstallConfirm = document.querySelector("[data-uninstall-confirm]");
    if (uninstallConfirm) {
      if (a === "b")
        uninstallConfirm
          .querySelector<HTMLButtonElement>("[data-uninstall-cancel]")
          ?.click();
      else navigateControls(a, uninstallConfirm);
      return;
    }
    if (a === "power") {
      if (!settings && !details) setPowerMenu(true);
      return;
    }
    const primary = document.querySelector(".primary-nav");
    if (a === "menu" && !document.querySelector("dialog[open]")) {
      (
        primary?.querySelector<HTMLElement>("button[aria-current='page']") ??
        document.querySelector<HTMLElement>(
          ".system-bar button[aria-current='page']",
        )
      )?.focus();
      return;
    }
    if (document.querySelector(".scene[inert]")) return;
    if (
      filtersOpen &&
      page === "library" &&
      !settings &&
      !details &&
      !["settings", "home"].includes(a)
    ) {
      if (a === "b") setFiltersOpen(false);
      else if (a === "y") setPrefs((p) => ({ ...p, filters: defaultFilters }));
      else if (a === "lb" || a === "rb")
        setFilterTab((tab) =>
          tab === "categories" ? "options" : "categories",
        );
      else navigateSpatial(a, document.querySelector("[data-filter-panel]"));
      return;
    }
    if (a === "b") {
      if (details) closeDetails();
      else if (settings) setSettings(null);
      else if (page === "library" || page === "settings") setPage("home");
      else if (page !== "home") featureInput.current?.(a);
      return;
    }
    if (details || settings) {
      const actions = document.querySelector("dialog[open] .detail-actions");
      const buttons = [
        ...(actions?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? []),
      ];
      const position = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (
        details &&
        position >= 0 &&
        ["up", "down", "left", "right"].includes(a)
      ) {
        const next = position + (["up", "left"].includes(a) ? -1 : 1);
        if (buttons[next]) {
          buttons[next].focus();
          return;
        }
      }
      navigateSpatial(a, document.querySelector("dialog[open]"));
      if (a === "x" && details) toggleFavorite(details);
      if (a === "y" && details) toggleHidden(details);
      return;
    }
    const featureDialog = document.querySelector("dialog[open]");
    if (featureDialog) {
      if (
        !["up", "down", "left", "right", "a", "lb", "rb"].includes(a) ||
        !navigateSpatial(a, featureDialog)
      )
        featureInput.current?.(a);
      return;
    }
    if (a === "settings") {
      setPage("settings");
      return;
    }
    if (a === "home") {
      setPage("home");
      return;
    }
    if (a === "lb" || a === "rb") {
      if (navigateSpatial(a, document.querySelector("main"))) return;
      if (page === "home" || page === "library") {
        setPage("library");
        setTab(
          (s) =>
            availableTabs[
              (Math.max(0, availableTabs.indexOf(s)) +
                (a === "lb" ? -1 : 1) +
                availableTabs.length) %
                availableTabs.length
            ],
        );
      } else featureInput.current?.(a);
      return;
    }
    if (["up", "down", "left", "right", "a"].includes(a)) {
      const initial = (
        page === "home" || page === "library"
          ? tileAt(focus)
          : document.querySelector("#content button")
      ) as HTMLElement | null;
      if (navigateSpatial(a, document.querySelector("main"), initial)) return;
      // Up from the library goes to the sort select if nothing above.
      if (
        a === "up" &&
        (page === "home" || page === "library") &&
        sortSelect.current
      ) {
        sortSelect.current.focus();
        return;
      }
    }
    if (page !== "home" && page !== "library" && !settings && !details) {
      featureInput.current?.(a);
      return;
    }
    if (a === "x" && selected) toggleFavorite(selected);
    if (a === "y") install();
  });
  // The library's collection title is its page heading; on Home the hero title is.
  const CollectionHeading = page === "library" ? "h1" : "h2";
  const hints: [string, string][] = launchScreen
    ? [["B", t("close")]]
    : hudOpen
      ? [
          ["A", t("selectAction")],
          ["B", t("close")],
        ]
      : details
        ? [
            ["A", t("selectAction")],
            ["X", t("favorites")],
            [
              "Y",
              t(prefs.hidden.includes(details.id) ? "restoreGame" : "hideGame"),
            ],
            ["B", t("close")],
          ]
        : settings || powerMenu
          ? [
              ["A", t("selectAction")],
              ["B", t("close")],
            ]
          : filtersOpen && page === "library"
            ? [
                ["A", t("selectAction")],
                ["LB/RB", t("filterTabs")],
                ["Y", t("clearFilters")],
                ["B", t("close")],
              ]
            : [
                ["View", t("menu")],
                ["A", t("selectAction")],
                ...(page === "home" || page === "library"
                  ? ([
                      ["X", t("favorites")],
                      ["LB/RB", t("sources")],
                    ] as [string, string][])
                  : page === "store"
                    ? ([
                        ["X", t("wishlist")],
                        ["LB/RB", `${t("discover")} / ${t("wishlist")}`],
                      ] as [string, string][])
                    : []),
                ...(page === "home"
                  ? []
                  : ([["B", t("home")]] as [string, string][])),
              ];
  return (
    <main className={`page-${page} density-${prefs.density}`}>
      <a className="skip-link" href="#content">
        {t("skipContent")}
      </a>
      {selected && (page === "home" || page === "library") && (
        <div
          key={selected.id}
          className="backdrop"
          style={{ backgroundImage: `url("${hero(selected)}")` }}
        />
      )}
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setPage("home")}
          aria-label={`Sofa · ${t("home")}`}
        >
          <SofaIcon />
          <span className="brand-name">sofa</span>
        </button>
        <nav className="primary-nav" aria-label="Sofa">
          {PAGES.map((p) => {
            const Icon = pageIcons[p];
            return (
              <button
                key={p}
                title={t(p)}
                aria-label={t(p)}
                aria-current={page === p ? "page" : undefined}
                onClick={() => setPage(p)}
              >
                <Icon weight={page === p ? "fill" : "regular"} />
                <span>{t(p)}</span>
              </button>
            );
          })}
        </nav>
        <SearchField
          className="header-search"
          value={query}
          name="search"
          enterKeyHint="search"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage("library");
            setTab("all");
          }}
          onClear={() => setQuery("")}
          clearLabel={t("clearSearch")}
          placeholder={t("searchGames")}
          aria-label={t("searchGames")}
        />
        <div className="system-bar">
          <TopBatteries t={t} data={power.data} onOpen={openHud} />
          <button
            onClick={() => setPowerMenu(true)}
            aria-label={t("powerMenu")}
            title={t("powerMenu")}
          >
            <PowerIcon />
          </button>
          <Clock lang={lang} />
          <button
            className={update ? "has-update" : undefined}
            onClick={() => setPage("settings")}
            aria-label={
              update
                ? `${t("settings")} · ${t("updateAvailable", { version: update.version })}`
                : t("settings")
            }
            aria-current={page === "settings" ? "page" : undefined}
            title={t("settings")}
          >
            <GearSixIcon />
          </button>
        </div>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <Scene key={page}>
          {page === "library" && (
            <section className="library-toolbar">
              {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>). */}
              <div
                className="source-tabs"
                role="group"
                aria-label={t("sources")}
              >
                <kbd aria-hidden>LB</kbd>
                {availableTabs.map((s) => (
                  <button
                    key={s}
                    aria-pressed={s === tab}
                    onClick={() => setTab(s)}
                  >
                    {s === "all"
                      ? t("allGames")
                      : s === "favorites"
                        ? t(s)
                        : s === "gog"
                          ? "GOG"
                          : s === "steam"
                            ? "Steam"
                            : "Epic"}
                  </button>
                ))}
                <kbd aria-hidden>RB</kbd>
              </div>
              <div className="tools">
                <SearchField
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  clearLabel={t("clearSearch")}
                  placeholder={t("searchHint")}
                  aria-label={t("searchGames")}
                />
                <button
                  className="filter-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls="library-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontalIcon />
                  {t("filters")}
                  {activeFilters(prefs.filters) > 0 && (
                    <span>{activeFilters(prefs.filters)}</span>
                  )}
                </button>
              </div>
              {prefs.filters.categories.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>).
                <div
                  className="active-categories"
                  role="group"
                  aria-label={t("activeCategories")}
                >
                  {categoryChoices
                    .filter((c) => prefs.filters.categories.includes(c.key))
                    .map((c) => (
                      <button
                        key={c.key}
                        onClick={() => toggleCategory(c.key)}
                        aria-label={t("removeCategory", {
                          category: categoryLabel(c.label, lang),
                        })}
                      >
                        {categoryLabel(c.label, lang)}
                        <XIcon />
                      </button>
                    ))}
                </div>
              )}
              {filtersOpen && (
                <button
                  className="drawer-backdrop"
                  aria-label={t("close")}
                  onClick={() => setFiltersOpen(false)}
                />
              )}
              {filtersOpen && (
                <div
                  className="library-filters"
                  id="library-filters"
                  data-filter-panel
                >
                  <div className="drawer-head">
                    <h2>{t("filters")}</h2>
                    {activeFilters(prefs.filters) > 0 && (
                      <span className="drawer-count">
                        {activeFilters(prefs.filters)}
                      </span>
                    )}
                    <button
                      className="close"
                      onClick={() => setFiltersOpen(false)}
                      aria-label={t("close")}
                    >
                      <XIcon />
                    </button>
                  </div>
                  <div className="segmented filter-tabs" role="tablist">
                    {(["categories", "options"] as const).map((tab) => (
                      <button
                        key={tab}
                        role="tab"
                        aria-selected={filterTab === tab}
                        onClick={() => setFilterTab(tab)}
                      >
                        {t(
                          tab === "categories" ? "categories" : "filterOptions",
                        )}
                        {filterCount(tab) > 0 && (
                          <span>{filterCount(tab)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {filterTab === "categories" && (
                    <section
                      className="category-filter"
                      aria-labelledby="category-filter-title"
                      data-tabpanel
                    >
                      <div className="category-filter-heading">
                        <div>
                          <h2 id="category-filter-title">{t("categories")}</h2>
                          <p>{t("categoryMatchAny")}</p>
                        </div>
                        <SearchField
                          aria-label={t("searchCategories")}
                          placeholder={t("searchCategories")}
                          value={categoryQuery}
                          onChange={(e) => setCategoryQuery(e.target.value)}
                          onClear={() => setCategoryQuery("")}
                          clearLabel={t("clearSearch")}
                        />
                      </div>
                      <div className="category-options">
                        {categoryChoices
                          .filter((c) =>
                            categoryLabel(c.label, lang)
                              .toLocaleLowerCase()
                              .includes(categoryQuery.toLocaleLowerCase()),
                          )
                          .map((c) => (
                            <button
                              key={c.key}
                              aria-pressed={prefs.filters.categories.includes(
                                c.key,
                              )}
                              onClick={() => toggleCategory(c.key)}
                            >
                              <span>{categoryLabel(c.label, lang)}</span>
                              <small>{c.count}</small>
                            </button>
                          ))}
                      </div>
                      {!categoryChoices.length && (
                        <p className="muted">
                          {t(
                            categories.loading
                              ? "categoriesLoading"
                              : "noCategories",
                          )}
                        </p>
                      )}
                      {categoryChoices.length > 0 && categories.loading && (
                        <p className="muted" role="status">
                          {t("categoriesLoading")}
                        </p>
                      )}
                      {categories.unavailable && (
                        <p className="category-sync-note">
                          {t("categoriesOffline")}{" "}
                          <button
                            onClick={() =>
                              !categories.loading && categories.retry()
                            }
                            aria-disabled={categories.loading}
                          >
                            {t("retry")}
                          </button>
                        </p>
                      )}
                      {categoryChoices.length > 0 &&
                        categoryQuery &&
                        !categoryChoices.some((c) =>
                          categoryLabel(c.label, lang)
                            .toLocaleLowerCase()
                            .includes(categoryQuery.toLocaleLowerCase()),
                        ) && <p className="muted">{t("noCategorySearch")}</p>}
                    </section>
                  )}
                  {filterTab === "options" && (
                    <div className="filter-options" data-tabpanel>
                      <div className="field">
                        {t("playedFilter")}
                        <Picker
                          label={t("playedFilter")}
                          value={prefs.filters.played}
                          options={[
                            { value: "any", label: t("anyHistory") },
                            { value: "never", label: t("neverPlayedFilter") },
                            { value: "recent7", label: t("recent7") },
                            { value: "recent30", label: t("recent30") },
                          ]}
                          onChange={(played) =>
                            setPrefs((p) => ({
                              ...p,
                              filters: { ...p.filters, played },
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        {t("artworkFilter")}
                        <Picker
                          label={t("artworkFilter")}
                          value={prefs.filters.artwork}
                          options={[
                            { value: "any", label: t("anyArtwork") },
                            { value: "with", label: t("withArtwork") },
                            { value: "without", label: t("withoutArtwork") },
                          ]}
                          onChange={(artwork) =>
                            setPrefs((p) => ({
                              ...p,
                              filters: { ...p.filters, artwork },
                            }))
                          }
                        />
                      </div>
                      <label className="filter-checkbox">
                        <input
                          type="checkbox"
                          checked={prefs.filters.favoritesOnly}
                          onChange={(e) =>
                            setPrefs((p) => ({
                              ...p,
                              filters: {
                                ...p.filters,
                                favoritesOnly: e.target.checked,
                              },
                            }))
                          }
                        />
                        {t("favoritesOnly")}
                      </label>
                    </div>
                  )}
                  <div className="filter-actions">
                    <button
                      onClick={() =>
                        setPrefs((p) => ({ ...p, filters: defaultFilters }))
                      }
                    >
                      <ArrowCounterClockwiseIcon />
                      {t("clearFilters")}
                    </button>
                    <button
                      className="accent"
                      onClick={() => setFiltersOpen(false)}
                    >
                      <CheckIcon weight="bold" />
                      {t("showResults")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          {demo && <span className="preview-label">{t("preview")}</span>}
          {(page === "home" || page === "library") &&
            (loading ? (
              <div className="empty" role="status">
                {t("scanning")}
              </div>
            ) : scanError ? (
              <div className="empty" role="alert">
                <p>{t("scanFailed", { error: t(scanError) })}</p>
                <button onClick={() => void library.refresh()}>
                  {t("retry")}
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty">
                <h1>
                  {page === "home"
                    ? t("library")
                    : tab === "favorites"
                      ? t(tab)
                      : t("allGames")}
                </h1>
                <p>
                  {query
                    ? t("noMatches")
                    : tab === "favorites" && page !== "home"
                      ? t("emptyFavorites")
                      : activeFilters(prefs.filters) > 0
                        ? t("filterNoMatches")
                        : page === "home" &&
                            games.some((game) => !game.installed)
                          ? t("homeNoInstalled")
                          : t("noGames")}
                </p>
                {page === "library" && activeFilters(prefs.filters) > 0 && (
                  <button
                    onClick={() =>
                      setPrefs((p) => ({ ...p, filters: defaultFilters }))
                    }
                  >
                    {t("clearFilters")}
                  </button>
                )}
              </div>
            ) : (
              <>
                {page === "home" && selected && (
                  <section className="hero-copy" key={selected.id}>
                    <span className="game-meta">
                      {selected.source.toUpperCase()} ·{" "}
                      {t(
                        selected.installed ? "installed" : "availableToInstall",
                      )}
                    </span>
                    <h1>{selected.title}</h1>
                    <p>{gameMeta(selected, prefs.recent[selected.id])}</p>
                    <div className="hero-actions">
                      <button
                        className="accent primary-action"
                        aria-disabled={launching}
                        aria-busy={launching}
                        onClick={() =>
                          void (selected.installed
                            ? play(selected)
                            : installGame(selected))
                        }
                      >
                        {selected.installed ? (
                          <PlayIcon weight="fill" />
                        ) : (
                          <DownloadSimpleIcon weight="bold" />
                        )}
                        {t(selected.installed ? "play" : "installGame")}
                      </button>
                      <button onClick={() => setDetails(selected)}>
                        <InfoIcon />
                        {t("details")}
                      </button>
                      <button
                        aria-pressed={prefs.favorites.includes(selected.id)}
                        onClick={() => toggleFavorite(selected)}
                      >
                        <HeartIcon
                          weight={
                            prefs.favorites.includes(selected.id)
                              ? "fill"
                              : "regular"
                          }
                        />{" "}
                        {t("favorites")}
                      </button>
                    </div>
                  </section>
                )}
                <section className="collection" id="content" tabIndex={-1}>
                  <div className="collection-heading">
                    <CollectionHeading>
                      {page === "home"
                        ? t(
                            visible.some((g) => prefs.recent[g.id])
                              ? "recentGames"
                              : "library",
                          )
                        : t("filteredCount", {
                            installed: String(
                              visible.filter((game) => game.installed).length,
                            ),
                            total: String(visible.length),
                          })}
                    </CollectionHeading>
                    {page === "library" && (
                      <div className="collection-actions">
                        {/* Sorting sits right above the list it orders; UP from the list brings focus here. */}
                        <Picker
                          ref={sortSelect}
                          label={t("sort")}
                          value={prefs.sort}
                          options={[
                            { value: "recent", label: t("recent") },
                            { value: "mostPlayed", label: t("sortMostPlayed") },
                            { value: "installed", label: t("sortInstalled") },
                            { value: "title", label: t("titleAsc") },
                            { value: "size", label: t("sortSize") },
                          ]}
                          onChange={(sort) => setPrefs((p) => ({ ...p, sort }))}
                        />
                      </div>
                    )}
                    {page === "home" && (
                      <button onClick={() => setPage("library")}>
                        {t("browseLibrary")} <ArrowRightIcon />
                      </button>
                    )}
                  </div>
                  {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>). */}
                  <div
                    className={page === "home" ? "game-row" : "grid"}
                    ref={grid}
                    role="group"
                    aria-label={t("library")}
                  >
                    {visible.map((g, i) => (
                      <Fragment key={g.id}>
                        {page === "library" &&
                          prefs.sort === "title" &&
                          (i === 0 ||
                            titleGroup(visible[i - 1].title) !==
                              titleGroup(g.title)) && (
                            <h3 className="grid-letter">
                              {titleGroup(g.title)}
                            </h3>
                          )}
                        <button
                          className="tile"
                          style={{ "--i": i % 18 } as CSSProperties}
                          data-installed={g.installed}
                          aria-current={i === focus}
                          aria-label={`${g.title} · ${g.source} · ${t(g.installed ? "installed" : "availableToInstall")}`}
                          onFocus={() => setFocus(i)}
                          onMouseEnter={() => setFocus(i)}
                          onClick={() => {
                            setFocus(i);
                            setDetails(g);
                          }}
                        >
                          <Cover game={g} />
                          {!g.installed && (
                            <span className="install-mark">
                              {t("installGame")}
                            </span>
                          )}
                          {prefs.favorites.includes(g.id) && (
                            <span
                              className="favorite-mark"
                              role="img"
                              aria-label={t("favorite")}
                            >
                              <HeartIcon weight="fill" />
                            </span>
                          )}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                </section>
              </>
            ))}
          {page === "store" && (
            <Store
              t={t}
              lang={lang}
              region={region}
              input={featureInput}
              onBack={() => setPage("home")}
            />
          )}
          {page === "settings" && (
            <section className="settings-hub" id="content" tabIndex={-1}>
              <div className="settings-hub-heading">
                <p className="eyebrow">
                  <SofaIcon size={36} />
                  {updates.version ? `Sofa ${updates.version}` : "Sofa"}
                </p>
                <h1>{t("settings")}</h1>
                <p>{t("settingsHubIntro")}</p>
              </div>
              <div className="settings-hub-grid">
                <button
                  onClick={() => {
                    setSettings("library");
                  }}
                >
                  <SquaresFourIcon aria-hidden />
                  <strong>{t("librarySettings")}</strong>
                  <span>{t("settingsLibraryDescription")}</span>
                </button>
                <button
                  onClick={() => {
                    setSettings("apps");
                  }}
                >
                  <AppWindowIcon aria-hidden />
                  <strong>{t("apps")}</strong>
                  <span>{t("settingsAppsDescription")}</span>
                </button>
                <button
                  onClick={() => {
                    setSettings("appearance");
                  }}
                >
                  <GearSixIcon aria-hidden />
                  <strong>{t("appearance")}</strong>
                  <span>{t("settingsAppearanceDescription")}</span>
                </button>
                <button onClick={openHud}>
                  <GaugeIcon aria-hidden />
                  <strong>{t("hud")}</strong>
                  <span>{t("settingsPerformanceDescription")}</span>
                </button>
                <button
                  onClick={() => {
                    setSettings("controllers");
                  }}
                >
                  <BluetoothIcon aria-hidden />
                  <strong>{t("controllers")}</strong>
                  <span>{t("settingsControllersDescription")}</span>
                </button>
                <button
                  onClick={() =>
                    void desktop("open_storage_settings").catch((error) =>
                      notify(serviceError(error)),
                    )
                  }
                >
                  <HardDrivesIcon aria-hidden />
                  <ArrowSquareOutIcon className="external" aria-hidden />
                  <strong>{t("storage")}</strong>
                  <span>
                    {storage.data?.length
                      ? storage.data.map((disk) => (
                          <Fragment key={disk.name}>
                            {t("storageFree", {
                              name: disk.name,
                              free: gb(disk.available),
                              total: gb(disk.total),
                            })}
                            <br />
                          </Fragment>
                        ))
                      : t("settingsStorageDescription")}
                  </span>
                </button>
                <button
                  className={update ? "has-update" : undefined}
                  onClick={() => {
                    setSettings("updates");
                  }}
                >
                  <ArrowRightIcon aria-hidden />
                  <strong>{t("updates")}</strong>
                  <span>
                    {update
                      ? t("updateAvailable", { version: update.version })
                      : t("settingsUpdatesDescription")}
                  </span>
                </button>
              </div>
            </section>
          )}
        </Scene>
      </AnimatePresence>
      <footer>
        <span role="status">
          {status || (!isTauri() && !demo ? t("browserPreview") : "")}
        </span>
        {update && (
          <button
            className="update"
            aria-disabled={updates.installing}
            aria-busy={updates.installing}
            onClick={install}
          >
            <kbd>Y</kbd>
            {t("updateAvailable", { version: update.version })}
          </button>
        )}
        <span className="hints">
          {hints.map(([button, label]) => (
            <span key={button}>
              <kbd>{button}</kbd> {label}
            </span>
          ))}
        </span>
      </footer>
      {launchScreen && <LaunchScreen game={launchScreen} t={t} />}
      {hudOpen && (
        <Dialog label="HUD" onClose={() => setHudOpen(false)}>
          <HudPanel
            t={t}
            inputRef={hudInput}
            embedded
            onClose={() => setHudOpen(false)}
          />
        </Dialog>
      )}
      {powerMenu && (
        <PowerMenu
          t={t}
          data={power.data}
          input={powerInput}
          onClose={() => setPowerMenu(false)}
        />
      )}
      {details && (
        <Dialog
          label={`${t("details")} · ${details.title}`}
          onClose={closeDetails}
        >
          {/* Fixed-size: the cover and the title never move; only the details column scrolls. */}
          <div
            className="detail-layout"
            style={{ backgroundImage: `url("${hero(details)}")` }}
          >
            <button
              className="close"
              onClick={closeDetails}
              aria-label={t("close")}
            >
              <XIcon />
            </button>
            <div className="detail-cover" aria-hidden>
              <CoverImage key={details.id} game={details} />
            </div>
            <div className="detail-body">
              <p className="detail-meta">
                {details.source.toUpperCase()} ·{" "}
                {t(details.installed ? "installed" : "availableToInstall")}
              </p>
              <h1>{details.title}</h1>
              <p className="detail-meta-line">
                {gameMeta(
                  details,
                  prefs.recent[details.id],
                  details.installed
                    ? undefined
                    : (sizeEstimate.data ?? undefined),
                )}
              </p>
              <CategoryEditor
                key={details.id}
                game={details}
                prefs={prefs}
                catalog={categories.catalog}
                t={t}
                lang={lang}
                onChange={(labels) =>
                  setPrefs((p) => ({
                    ...p,
                    categories: { ...p.categories, [details.id]: labels },
                  }))
                }
              />
              <p className="muted">
                {t(details.installed ? "launchHint" : "installHint")}
              </p>
              <div className="detail-actions">
                <button
                  data-initial-focus
                  className="accent"
                  aria-disabled={details.installed && launching}
                  aria-busy={details.installed && launching}
                  onClick={() =>
                    void (details.installed
                      ? play(details)
                      : installGame(details))
                  }
                >
                  {details.installed ? (
                    <PlayIcon weight="fill" />
                  ) : (
                    <DownloadSimpleIcon weight="bold" />
                  )}
                  {t(details.installed ? "play" : "installGame")}
                </button>
                <button onClick={() => toggleFavorite(details)}>
                  <HeartIcon
                    weight={
                      prefs.favorites.includes(details.id) ? "fill" : "regular"
                    }
                  />
                  {t(
                    prefs.favorites.includes(details.id)
                      ? "removeFavorite"
                      : "addFavorite",
                  )}
                </button>
                <button onClick={() => toggleHidden(details)}>
                  {prefs.hidden.includes(details.id) ? (
                    <EyeIcon />
                  ) : (
                    <EyeSlashIcon />
                  )}
                  {t(
                    prefs.hidden.includes(details.id)
                      ? "restoreGame"
                      : "hideGame",
                  )}
                </button>
              </div>
              {details.installed && (
                <Uninstall
                  key={details.id}
                  game={details}
                  t={t}
                  onStarted={(id, completed) => {
                    if (completed) void library.refresh();
                    else library.watchUninstall(id);
                    setDetails(null);
                    setStatus(
                      t(completed ? "uninstallComplete" : "uninstallStarted"),
                    );
                  }}
                />
              )}
            </div>
          </div>
        </Dialog>
      )}
      {settings && (
        <SettingsDialog
          panel={settings}
          t={t}
          status={status}
          onClose={() => setSettings(null)}
        >
          {settings === "library" && (
            <LibrarySettings
              t={t}
              library={library}
              prefs={prefs}
              onRestore={toggleHidden}
            />
          )}
          {settings === "appearance" && (
            <AppearanceSettings
              t={t}
              lang={lang}
              setLang={setLang}
              region={region}
              prefs={prefs}
              setPrefs={setPrefs}
              notify={notify}
            />
          )}
          {settings === "apps" && <AppsSettings t={t} notify={notify} />}
          {settings === "controllers" && (
            <ControllerSettings t={t} notify={notify} />
          )}
          {settings === "updates" && <UpdateSettings t={t} updates={updates} />}
        </SettingsDialog>
      )}
    </main>
  );
}
