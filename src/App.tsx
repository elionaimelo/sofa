import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { LANGS, type Lang, initialLang, saveLang, translator } from "./i18n";
import {
  categoryOptions,
  filterGames,
  hero,
  parsePreferences,
  activeFilters,
  defaultFilters,
  type Game,
} from "./library";
import { useInput } from "./useInput";
import { Dialog } from "./components/Dialog";
import { Scene } from "./components/Scene";
import { AnimatePresence } from "motion/react";
import "./App.css";
import "@fontsource-variable/outfit";
import {
  HouseIcon,
  SquaresFourIcon,
  StorefrontIcon,
  UsersThreeIcon,
  GaugeIcon,
  GearSixIcon,
  SlidersHorizontalIcon,
  PowerIcon,
  HeartIcon,
  PlayIcon,
  XIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { Store } from "./features/Store";
import { Friends } from "./features/Friends";
import { Performance } from "./features/Performance";
import { TopBatteries, PowerMenu, usePower } from "./features/Power";
import { demo, navigateControls, type InputRef } from "./services";
import {
  CategoryEditor,
  categoryLabel,
  useCategories,
} from "./features/Categories";
import { Uninstall } from "./features/Uninstall";
const PAGES = ["home", "library", "store", "friends", "hud"] as const;
const pageIcons = {
  home: HouseIcon,
  library: SquaresFourIcon,
  store: StorefrontIcon,
  friends: UsersThreeIcon,
  hud: GaugeIcon,
};
const TABS = ["all", "favorites", "steam", "epic", "gog", "hidden"] as const;
const preferencesKey = demo ? "sofa.demo.preferences" : "sofa.preferences";
const demoGames: Game[] = [
  ["1245620", "ELDEN RING"],
  ["1091500", "Cyberpunk 2077"],
  ["1086940", "Baldur's Gate 3"],
  ["1145360", "Hades"],
  ["553850", "HELLDIVERS 2"],
  ["620", "Portal 2"],
  ["413150", "Stardew Valley"],
  ["1030300", "Hollow Knight: Silksong"],
].map(([id, title]) => ({
  id: `steam:${id}`,
  title,
  source: "steam",
  launch: "",
  cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
}));
function Cover({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      {game.cover && !failed && (
        <img
          src={game.cover}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span className="title">{game.title}</span>
      <span className="badge">{game.source}</span>
    </>
  );
}
export default function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState("");
  const [page, setPage] = useState<(typeof PAGES)[number]>("home");
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [query, setQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const categories = useCategories(games);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [prefs, setPrefs] = useState(() =>
    parsePreferences(
      localStorage.getItem(preferencesKey),
      demo ? null : localStorage.getItem("recent"),
    ),
  );
  const [status, setStatus] = useState("");
  const [lang, setLang] = useState(initialLang);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState<Game | null>(null);
  const [settings, setSettings] = useState(false);
  const [powerMenu, setPowerMenu] = useState(false);
  const powerInput: InputRef = useRef(null);
  const power = usePower();
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [now, setNow] = useState(new Date());
  const t = useMemo(() => translator(lang), [lang]);
  const grid = useRef<HTMLDivElement>(null);
  const featureInput: InputRef = useRef(null);
  const scanBusy = useRef(false),
    launchBusy = useRef(false),
    updateBusy = useRef(false),
    checkBusy = useRef(false);
  const scan = useCallback(async () => {
    if (scanBusy.current) return;
    scanBusy.current = true;
    setLoading(true);
    setScanError("");
    try {
      setGames(
        demo
          ? demoGames
          : isTauri()
            ? await invoke<Game[]>("scan_library")
            : [],
      );
    } catch (e) {
      setScanError(String(e));
    } finally {
      scanBusy.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!pendingUninstall) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 120000;
    const poll = async () => {
      try {
        const installed = await invoke<Game[]>("scan_library");
        if (!alive) return;
        if (!installed.some((game) => game.id === pendingUninstall)) {
          setGames(installed);
          setPendingUninstall(null);
          setStatus(t("uninstallComplete"));
          return;
        }
      } catch {
        /* Refresh can be retried; never claim the removal completed. */
      }
      if (alive && Date.now() >= deadline) {
        setPendingUninstall(null);
        setStatus(t("uninstallStillInstalled"));
      } else if (alive) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    const onFocus = () => void scan();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pendingUninstall, scan, t]);
  const checkUpdates = useCallback(
    async (manual = false) => {
      if (!isTauri()) {
        if (manual) setStatus(t("browserPreview"));
        return;
      }
      if (checkBusy.current || updateBusy.current) return;
      checkBusy.current = true;
      setChecking(true);
      try {
        const next = await check();
        setUpdate(next);
        if (manual && !next) setStatus(t("noUpdate"));
      } catch (e) {
        if (manual) setStatus(t("updateCheckFailed", { error: String(e) }));
      } finally {
        checkBusy.current = false;
        setChecking(false);
      }
    },
    [t],
  );
  useEffect(() => {
    void scan();
  }, [scan]);
  useEffect(() => {
    void checkUpdates();
  }, [checkUpdates]);
  useEffect(() => saveLang(lang), [lang]);
  useEffect(() => {
    localStorage.setItem(preferencesKey, JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const visible = useMemo(
    () =>
      filterGames(
        games,
        prefs,
        page === "home" ? "all" : tab,
        page === "home" ? "" : query,
        page === "home",
        Date.now(),
        categories.catalog,
      ),
    [games, prefs, page, tab, query, categories.catalog],
  );
  const categoryChoices = useMemo(
    () =>
      categoryOptions(
        games.filter((g) =>
          tab === "hidden"
            ? prefs.hidden.includes(g.id)
            : !prefs.hidden.includes(g.id),
        ),
        prefs,
        categories.catalog,
      ).sort((a, b) =>
        categoryLabel(a.label, lang).localeCompare(
          categoryLabel(b.label, lang),
        ),
      ),
    [games, prefs, categories.catalog, lang, tab],
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
  useEffect(() => setFocus(0), [tab, query, page, prefs.filters, prefs.sort]);
  useEffect(() => {
    if (filtersOpen)
      document
        .querySelector<HTMLElement>(
          "[data-filter-panel] button, [data-filter-panel] select",
        )
        ?.focus();
  }, [filtersOpen]);
  useEffect(
    () => setFocus((f) => Math.min(f, Math.max(0, visible.length - 1))),
    [visible.length],
  );
  useEffect(() => {
    grid.current?.children[focus]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [focus]);
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
    if (launchBusy.current) return;
    if (demo || !isTauri()) {
      setStatus(t(demo ? "previewLaunch" : "browserPreview"));
      return;
    }
    launchBusy.current = true;
    setLaunching(true);
    setStatus(t("launching", { title: g.title }));
    try {
      await invoke("launch", { id: g.id });
      setPrefs((p) => ({ ...p, recent: { ...p.recent, [g.id]: Date.now() } }));
      setDetails(null);
      setStatus("");
    } catch (e) {
      setStatus(t("launchFailed", { title: g.title, error: String(e) }));
    } finally {
      launchBusy.current = false;
      setLaunching(false);
    }
  };
  const install = async () => {
    if (!update || updateBusy.current) return;
    updateBusy.current = true;
    setUpdating(true);
    setStatus(t("updating", { version: update.version }));
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setStatus(t("updateFailed", { error: String(e) }));
    } finally {
      updateBusy.current = false;
      setUpdating(false);
    }
  };
  const fullscreen = async () => {
    try {
      if (isTauri()) {
        const w = getCurrentWindow();
        await w.setFullscreen(!(await w.isFullscreen()));
      } else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      setStatus(String(e));
    }
  };
  useInput((a) => {
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
    if (
      !document.querySelector("dialog[open]") &&
      (a === "menu" ||
        (primary?.contains(document.activeElement) &&
          ["up", "down", "left", "right", "a", "b"].includes(a)))
    ) {
      if (a === "menu")
        primary
          ?.querySelector<HTMLElement>("button[aria-current='page']")
          ?.focus();
      else if (a === "b") (document.activeElement as HTMLElement)?.blur();
      else {
        navigateControls(a, primary);
        if (a === "a") (document.activeElement as HTMLElement)?.blur();
      }
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
      else navigateControls(a, document.querySelector("[data-filter-panel]"));
      return;
    }
    if (page !== "home" && page !== "library" && !settings && !details) {
      if (a === "home") setPage("home");
      else if (a === "settings") setSettings(true);
      else featureInput.current?.(a);
      return;
    }
    if (a === "b") {
      if (details) closeDetails();
      else if (settings) setSettings(false);
      else if (page === "library") setPage("home");
      return;
    }
    if (details || settings) {
      const dialog = document.querySelector("dialog[open]");
      const controls = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select, input",
        ) ?? [],
      );
      const i = controls.indexOf(document.activeElement as HTMLElement);
      if (["left", "up", "right", "down"].includes(a))
        controls[
          (i + (["left", "up"].includes(a) ? -1 : 1) + controls.length) %
            controls.length
        ]?.focus();
      if (a === "a") {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) active.click();
      }
      if (a === "x" && details) toggleFavorite(details);
      if (a === "y" && !settings && details) toggleHidden(details);
      if (a === "lb" || a === "rb") {
        const active = document.activeElement;
        if (active instanceof HTMLSelectElement) {
          active.selectedIndex =
            (active.selectedIndex +
              (a === "lb" ? -1 : 1) +
              active.options.length) %
            active.options.length;
          active.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      return;
    }
    const cols =
      page === "home"
        ? 1
        : grid.current
          ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
          : 1;
    const move = (delta: number) => {
      (document.activeElement as HTMLElement)?.blur();
      setFocus((f) =>
        Math.min(Math.max(f + delta, 0), Math.max(visible.length - 1, 0)),
      );
    };
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-cols);
    if (a === "down") move(cols);
    if (a === "lb" || a === "rb") {
      setPage("library");
      setTab(
        (s) =>
          TABS[
            (TABS.indexOf(s) + (a === "lb" ? -1 : 1) + TABS.length) %
              TABS.length
          ],
      );
    }
    if (a === "a" && selected) setDetails(selected);
    if (a === "x" && selected) toggleFavorite(selected);
    if (a === "y") void install();
    if (a === "settings") setSettings(true);
    if (a === "home") setPage("home");
  });
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
          sofa<span>●</span>
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
        <div className="system-bar">
          <TopBatteries t={t} data={power.data} onOpen={() => setPage("hud")} />
          <button
            onClick={() => setPowerMenu(true)}
            aria-label={t("powerMenu")}
            title={t("powerMenu")}
          >
            <PowerIcon />
          </button>
          <time>
            {now.toLocaleTimeString(lang, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <button
            onClick={() => setSettings(true)}
            aria-label={t("settings")}
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
              <nav className="source-tabs" aria-label={t("sources")}>
                <kbd>LB</kbd>
                {TABS.map((s) => (
                  <button
                    key={s}
                    aria-pressed={s === tab}
                    onClick={() => setTab(s)}
                  >
                    {s === "all"
                      ? t("allGames")
                      : s === "favorites" || s === "hidden"
                        ? t(s)
                        : s === "gog"
                          ? "GOG"
                          : s === "steam"
                            ? "Steam"
                            : "Epic"}
                  </button>
                ))}
                <kbd>RB</kbd>
              </nav>
              <div className="tools">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchHint")}
                  aria-label={t("searchGames")}
                />
                <button disabled={loading} onClick={() => void scan()}>
                  {t("refresh")}
                </button>
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
                <div
                  className="active-categories"
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
                <div
                  className="library-filters"
                  id="library-filters"
                  data-filter-panel
                >
                  <section
                    className="category-filter"
                    aria-labelledby="category-filter-title"
                  >
                    <div className="category-filter-heading">
                      <div>
                        <h2 id="category-filter-title">{t("categories")}</h2>
                        <p>{t("categoryMatchAny")}</p>
                      </div>
                      <input
                        aria-label={t("searchCategories")}
                        placeholder={t("searchCategories")}
                        value={categoryQuery}
                        onChange={(e) => setCategoryQuery(e.target.value)}
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
                          onClick={categories.retry}
                          disabled={categories.loading}
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
                  <label>
                    {t("sort")}
                    <select
                      value={prefs.sort}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          sort: e.target.value as typeof p.sort,
                        }))
                      }
                    >
                      <option value="recent">{t("recent")}</option>
                      <option value="title">{t("titleAsc")}</option>
                      <option value="titleDesc">{t("titleDesc")}</option>
                    </select>
                  </label>
                  <label>
                    {t("playedFilter")}
                    <select
                      value={prefs.filters.played}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          filters: {
                            ...p.filters,
                            played: e.target.value as typeof p.filters.played,
                          },
                        }))
                      }
                    >
                      <option value="any">{t("anyHistory")}</option>
                      <option value="never">{t("neverPlayedFilter")}</option>
                      <option value="recent7">{t("recent7")}</option>
                      <option value="recent30">{t("recent30")}</option>
                    </select>
                  </label>
                  <label>
                    {t("artworkFilter")}
                    <select
                      value={prefs.filters.artwork}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          filters: {
                            ...p.filters,
                            artwork: e.target.value as typeof p.filters.artwork,
                          },
                        }))
                      }
                    >
                      <option value="any">{t("anyArtwork")}</option>
                      <option value="with">{t("withArtwork")}</option>
                      <option value="without">{t("withoutArtwork")}</option>
                    </select>
                  </label>
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
                  <div className="filter-actions">
                    <button
                      onClick={() =>
                        setPrefs((p) => ({ ...p, filters: defaultFilters }))
                      }
                    >
                      {t("clearFilters")}
                    </button>
                    <button onClick={() => setFiltersOpen(false)}>
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
                <p>{t("scanFailed", { error: scanError })}</p>
                <button onClick={() => void scan()}>{t("retry")}</button>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty">
                <h1>
                  {page === "home"
                    ? t("library")
                    : tab === "favorites" || tab === "hidden"
                      ? t(tab)
                      : t("allGames")}
                </h1>
                <p>
                  {query
                    ? t("noMatches")
                    : tab === "favorites" && page !== "home"
                      ? t("emptyFavorites")
                      : tab === "hidden" && page !== "home"
                        ? t("emptyHidden")
                        : activeFilters(prefs.filters) > 0
                          ? t("filterNoMatches")
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
                <button
                  onClick={() => {
                    setPage("library");
                    setTab("all");
                    setQuery("");
                    void scan();
                  }}
                >
                  {t("refresh")}
                </button>
              </div>
            ) : (
              <>
                {page === "home" && selected && (
                  <section className="hero-copy">
                    <span className="game-meta">
                      {selected.source.toUpperCase()} · {t("installed")}
                    </span>
                    <h1>{selected.title}</h1>
                    <p>
                      {prefs.recent[selected.id]
                        ? t("lastPlayed", {
                            date: new Date(
                              prefs.recent[selected.id],
                            ).toLocaleDateString(lang),
                          })
                        : t("neverPlayed")}
                    </p>
                    <div className="hero-actions">
                      <button
                        className="accent"
                        disabled={launching}
                        onClick={() => void play(selected)}
                      >
                        <PlayIcon weight="fill" />
                        {t("play")}
                      </button>
                      <button onClick={() => setDetails(selected)}>
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
                    <h2>
                      {page === "home"
                        ? t(
                            visible.some((g) => prefs.recent[g.id])
                              ? "recentGames"
                              : "library",
                          )
                        : t("filteredCount", {
                            visible: String(visible.length),
                            total: String(
                              filterGames(
                                games,
                                { ...prefs, filters: defaultFilters },
                                tab,
                                "",
                                false,
                              ).length,
                            ),
                          })}
                    </h2>
                    {page === "home" && (
                      <button onClick={() => setPage("library")}>
                        {t("browseLibrary")} <ArrowRightIcon />
                      </button>
                    )}
                  </div>
                  <div
                    className={page === "home" ? "game-row" : "grid"}
                    ref={grid}
                    aria-label={t("library")}
                  >
                    {visible.map((g, i) => (
                      <button
                        key={g.id}
                        className="tile"
                        aria-current={i === focus}
                        aria-label={`${g.title} · ${g.source}`}
                        onFocus={() => setFocus(i)}
                        onMouseEnter={() => setFocus(i)}
                        onClick={() => {
                          setFocus(i);
                          setDetails(g);
                        }}
                      >
                        <Cover game={g} />
                        {prefs.favorites.includes(g.id) && (
                          <span
                            className="favorite-mark"
                            aria-label={t("favorite")}
                          >
                            <HeartIcon weight="fill" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ))}
          {page === "store" && (
            <Store
              t={t}
              lang={lang}
              input={featureInput}
              onBack={() => setPage("home")}
            />
          )}
          {page === "friends" && (
            <Friends
              t={t}
              input={featureInput}
              onBack={() => setPage("home")}
            />
          )}
          {page === "hud" && (
            <Performance
              t={t}
              input={featureInput}
              power={power.data}
              powerError={power.error}
              onBack={() => setPage("home")}
            />
          )}
        </Scene>
      </AnimatePresence>
      <footer>
        <span role="status">
          {status || (!isTauri() && !demo ? t("browserPreview") : "Sofa")}
        </span>
        {update && (
          <button
            className="update"
            disabled={updating}
            onClick={() => void install()}
          >
            <kbd>Y</kbd>
            {t("updateAvailable", { version: update.version })}
          </button>
        )}
        <span className="hints">
          <kbd>View</kbd> {t("menu")} <kbd>A</kbd> {t("selectAction")}{" "}
          {(page === "home" || page === "library" || page === "store") && (
            <>
              <kbd>X</kbd> {t(page === "store" ? "wishlist" : "favorites")}
            </>
          )}{" "}
          <kbd>B</kbd> {t("home")}
        </span>
      </footer>
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
          <div
            className="detail-banner"
            style={{ backgroundImage: `url("${hero(details)}")` }}
          >
            <button
              className="close"
              onClick={closeDetails}
              aria-label={t("close")}
            >
              <XIcon />
            </button>
            <div>
              <p>
                {details.source.toUpperCase()} · {t("installed")}
              </p>
              <h1>{details.title}</h1>
            </div>
          </div>
          <div className="detail-body">
            <p>
              {prefs.recent[details.id]
                ? t("lastPlayed", {
                    date: new Date(prefs.recent[details.id]).toLocaleString(
                      lang,
                    ),
                  })
                : t("neverPlayed")}
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
            <p className="muted">{t("launchHint")}</p>
            <div className="detail-actions">
              <button
                data-initial-focus
                className="accent"
                disabled={launching}
                onClick={() => void play(details)}
              >
                {t("play")}
              </button>
              <button onClick={() => toggleFavorite(details)}>
                {t(
                  prefs.favorites.includes(details.id)
                    ? "removeFavorite"
                    : "addFavorite",
                )}
              </button>
              <button onClick={() => toggleHidden(details)}>
                {t(
                  prefs.hidden.includes(details.id)
                    ? "restoreGame"
                    : "hideGame",
                )}
              </button>
            </div>
            <Uninstall
              key={details.id}
              game={details}
              t={t}
              onStarted={(id, completed) => {
                if (completed) void scan();
                else setPendingUninstall(id);
                setDetails(null);
                setStatus(
                  t(completed ? "uninstallComplete" : "uninstallStarted"),
                );
              }}
            />
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog label={t("settings")} onClose={() => setSettings(false)}>
          <div className="settings-head">
            <h1>{t("settings")}</h1>
            <button onClick={() => setSettings(false)} aria-label={t("close")}>
              <XIcon />
            </button>
          </div>
          <div className="settings-body">
            <h2>{t("appearance")}</h2>
            <label>
              {t("language")}
              <select
                data-initial-focus
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                {Object.entries(LANGS).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("density")}
              <select
                value={prefs.density}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    density: e.target.value as typeof p.density,
                  }))
                }
              >
                <option value="comfortable">{t("comfortable")}</option>
                <option value="compact">{t("compact")}</option>
              </select>
            </label>
            <button onClick={() => void fullscreen()}>{t("fullscreen")}</button>
            <button
              onClick={() => {
                setSettings(false);
                setPowerMenu(true);
              }}
            >
              <PowerIcon />
              {t("powerMenu")}
            </button>
            <h2>{t("librarySettings")}</h2>
            <label>
              {t("sort")}
              <select
                value={prefs.sort}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    sort: e.target.value as typeof p.sort,
                  }))
                }
              >
                <option value="recent">{t("recent")}</option>
                <option value="title">{t("titleAsc")}</option>
                <option value="titleDesc">{t("titleDesc")}</option>
              </select>
            </label>
            <div className="detail-actions">
              <button disabled={loading} onClick={() => void scan()}>
                {t("refresh")}
              </button>
              <button
                onClick={() => {
                  setPage("library");
                  setTab("hidden");
                  setSettings(false);
                }}
              >
                {t("hidden")} ({prefs.hidden.length})
              </button>
            </div>
            <h2>{t("updates")}</h2>
            <button
              disabled={checking || updating}
              onClick={() =>
                update ? void install() : void checkUpdates(true)
              }
            >
              {update
                ? t("updateAvailable", { version: update.version })
                : t("checkUpdates")}
            </button>
            <p className="settings-status" role="status">
              {status}
            </p>
          </div>
        </Dialog>
      )}
    </main>
  );
}
