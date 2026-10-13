import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { AnimatePresence } from "motion/react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog } from "./components/Dialog";
import { Scene } from "./components/Scene";
import { initialLang, LANGS, type Lang, saveLang, translator } from "./i18n";
import {
  activeFilters,
  categoryOptions,
  defaultFilters,
  filterGames,
  type Game,
  hero,
  mergeLibrary,
  parsePreferences,
} from "./library";
import { useInput } from "./useInput";
import "./App.css";
import "@fontsource-variable/outfit";
import {
  ArrowRightIcon,
  GaugeIcon,
  GearSixIcon,
  HeartIcon,
  HouseIcon,
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
import { PowerMenu, TopBatteries, usePower } from "./features/Power";
import { Store } from "./features/Store";
import { Uninstall } from "./features/Uninstall";
import {
  commandQuery,
  demo,
  type InputRef,
  navigateControls,
  navigateSpatial,
  serviceError,
} from "./services";

const PAGES = ["home", "library", "store"] as const;
const pageIcons = {
  home: HouseIcon,
  library: SquaresFourIcon,
  store: StorefrontIcon,
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
].map(([id, title], index) => ({
  id: `steam:${id}`,
  title,
  source: "steam",
  launch: "",
  cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  installed: index < 2,
}));
demoGames.push({
  id: "epic:demo-control",
  title: "Control",
  source: "epic",
  launch: "",
  cover:
    "https://cdn.cloudflare.steamstatic.com/steam/apps/870780/library_600x900.jpg",
  installed: true,
});
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
  const [installedGames, setInstalledGames] = useState<Game[]>([]);
  const [ownedGames, setOwnedGames] = useState<Game[]>([]);
  const games = useMemo(
    () => mergeLibrary(installedGames, ownedGames),
    [installedGames, ownedGames],
  );
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState("");
  const [steamConnected, setSteamConnected] = useState(false);
  const [steamBusy, setSteamBusy] = useState(false);
  const [page, setPage] = useState<(typeof PAGES)[number] | "settings">("home");
  const [tabChoice, setTab] = useState<(typeof TABS)[number]>("all");
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
  const [details, setDetails] = useState<Game | null>(null);
  const [settings, setSettings] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<
    "library" | "appearance" | "updates"
  >("library");
  const [powerMenu, setPowerMenu] = useState(false);
  const powerInput: InputRef = useRef(null);
  const power = usePower();
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
  const [pendingInstalls, setPendingInstalls] = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);
  const t = useMemo(() => translator(lang), [lang]);
  // Async work reads the current language here, so switching it doesn't rescan or re-check updates.
  const tRef = useRef(t);
  tRef.current = t;
  const grid = useRef<HTMLDivElement>(null);
  const featureInput: InputRef = useRef(null);
  const scanBusy = useRef(false),
    launchBusy = useRef(false),
    queryClient = useQueryClient();
  const scan = useCallback(async () => {
    if (scanBusy.current) return;
    scanBusy.current = true;
    setLoading(true);
    setScanError("");
    try {
      setInstalledGames(
        demo
          ? demoGames.filter((game) => game.installed)
          : isTauri()
            ? await invoke<Game[]>("scan_library")
            : [],
      );
      if (demo)
        setOwnedGames(demoGames.filter((game) => game.source === "steam"));
      else if (steamConnected) {
        try {
          setOwnedGames(await invoke<Game[]>("refresh_steam_library"));
        } catch (error) {
          // Expired web session: show the connect button again instead of a dead "connected" state.
          if (
            ["steamSessionExpired", "notConnected"].includes(
              serviceError(error),
            )
          ) {
            setSteamConnected(false);
            setOwnedGames([]);
          }
          setStatus(tRef.current(serviceError(error)));
        }
      }
    } catch (e) {
      setScanError(String(e));
    } finally {
      scanBusy.current = false;
      setLoading(false);
    }
  }, [steamConnected]);
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
          setInstalledGames(installed);
          setPendingUninstall(null);
          setStatus(tRef.current("uninstallComplete"));
          return;
        }
      } catch {
        /* Refresh can be retried; never claim the removal completed. */
      }
      if (alive && Date.now() >= deadline) {
        setPendingUninstall(null);
        setStatus(tRef.current("uninstallStillInstalled"));
      } else if (alive) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pendingUninstall]);
  useEffect(() => {
    if (!pendingInstalls.length || demo || !isTauri()) return;
    let active = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const installed = await invoke<Game[]>("scan_library");
        if (!active) return;
        setInstalledGames(installed);
        const completed = pendingInstalls.filter((id) =>
          installed.some((game) => game.id === id),
        );
        if (completed.length) {
          setPendingInstalls((current) =>
            current.filter((id) => !completed.includes(id)),
          );
          setStatus(tRef.current("installComplete"));
        }
      } catch {
        // Retry while the launcher is installing the game.
      } finally {
        busy = false;
        if (active) timer = setTimeout(() => void refresh(), 5000);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pendingInstalls]);
  const installUpdate = useMutation({
    mutationFn: async (next: Update) => {
      await next.downloadAndInstall();
      await relaunch();
    },
    onMutate: (next) => setStatus(t("updating", { version: next.version })),
    onError: (e) => setStatus(t("updateFailed", { error: String(e) })),
  });
  const updateQuery = useQuery({
    queryKey: ["update"],
    queryFn: () => check(),
    enabled: isTauri() && !installUpdate.isPending,
    // Sofa can stay open for days as the home app; keep looking for new releases.
    refetchInterval: 6 * 3600_000,
    staleTime: 6 * 3600_000,
    retry: false,
  });
  const update = updateQuery.data ?? null;
  // The installed binary's version; it can't change while Sofa runs.
  const version = useQuery({
    queryKey: ["app_version"],
    queryFn: getVersion,
    enabled: isTauri(),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  const updating = installUpdate.isPending;
  const checking = updateQuery.isFetching;
  const checkUpdates = async () => {
    if (!isTauri()) return setStatus(t("browserPreview"));
    const result = await updateQuery.refetch();
    if (result.error)
      setStatus(t("updateCheckFailed", { error: String(result.error) }));
    else if (!result.data) setStatus(t("noUpdate"));
  };
  const install = () => {
    if (update && !updating) installUpdate.mutate(update);
  };
  useEffect(() => {
    void scan();
  }, [scan]);
  useEffect(() => {
    if (demo || !isTauri()) return;
    setSteamBusy(true);
    invoke<Game[]>("connect_steam_library", { signIn: false })
      .then((owned) => {
        setOwnedGames(owned);
        setSteamConnected(true);
      })
      .catch(() => {
        /* No saved Steam session: the Connect button stays. */
      })
      .finally(() => setSteamBusy(false));
  }, []);
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
          value === "hidden" ||
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
  useEffect(() => {
    if (!details) return;
    const current = games.find((game) => game.id === details.id);
    if (current && current.installed !== details.installed) setDetails(current);
  }, [games, details]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab, search, page or filter starts at the first tile.
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
    if (!g.installed) return;
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
  const connectSteamLibrary = async () => {
    if (steamBusy || !isTauri()) return;
    setSteamBusy(true);
    try {
      const owned = await invoke<Game[]>("connect_steam_library", {
        signIn: true,
      });
      setOwnedGames(owned);
      setSteamConnected(true);
      setStatus(
        t(owned.length ? "steamLibraryConnected" : "steamNoOwnedGames", {
          count: String(owned.length),
        }),
      );
    } catch (error) {
      setStatus(t(serviceError(error)));
    } finally {
      setSteamBusy(false);
    }
  };
  const disconnectSteamLibrary = async () => {
    if (steamBusy || !isTauri()) return;
    setSteamBusy(true);
    try {
      await invoke("disconnect_steam_library");
      setSteamConnected(false);
      setOwnedGames([]);
      setStatus(t("steamLibraryDisconnected"));
    } catch (error) {
      setStatus(t(serviceError(error)));
    } finally {
      setSteamBusy(false);
    }
  };
  const openHud = () => {
    if (!isTauri()) return setStatus(t("browserPreview"));
    invoke("open_hud").catch((e) => setStatus(t(serviceError(e))));
  };
  const installGame = async (game: Game) => {
    if (game.installed) return;
    if (demo || !isTauri()) {
      setStatus(t(demo ? "previewInstall" : "browserPreview"));
      return;
    }
    try {
      await invoke("install_owned_game", { id: game.id });
      setPendingInstalls((current) =>
        current.includes(game.id) ? current : [...current, game.id],
      );
      setStatus(t("installRequested", { title: game.title }));
    } catch (error) {
      setStatus(t(serviceError(error)));
    }
  };
  const xboxMode =
    useQuery({
      ...commandQuery<{
        home: boolean;
        startup: boolean;
        active: boolean | null;
      } | null>("xbox_mode_status"),
      enabled:
        settings && settingsTarget === "appearance" && !demo && isTauri(),
    }).data ?? null;
  const xboxStartup = !!xboxMode?.home && !!xboxMode.startup;
  const toggleXboxStartup = useMutation({
    mutationFn: (on: boolean) => invoke("set_xbox_mode_startup", { on }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["xbox_mode_status"] }),
    onError: (error) => setStatus(t(serviceError(error))),
  });
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
      else navigateSpatial(a, document.querySelector("[data-filter-panel]"));
      return;
    }
    if (a === "b") {
      if (details) closeDetails();
      else if (settings) setSettings(false);
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
          ? grid.current?.children[focus]
          : document.querySelector("#content button")
      ) as HTMLElement | null;
      if (navigateSpatial(a, document.querySelector("main"), initial)) return;
    }
    if (page !== "home" && page !== "library" && !settings && !details) {
      featureInput.current?.(a);
      return;
    }
    if (a === "x" && selected) toggleFavorite(selected);
    if (a === "y") install();
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
        <input
          className="header-search"
          type="search"
          value={query}
          onFocus={() => setPage("library")}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage("library");
            setTab("all");
          }}
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
              <nav className="source-tabs" aria-label={t("sources")}>
                <kbd>LB</kbd>
                {availableTabs.map((s) => (
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
                    {page === "library" && (
                      <span className="library-stats">
                        {t("availabilitySummary", {
                          installed: String(
                            visible.filter((game) => game.installed).length,
                          ),
                          available: String(
                            visible.filter((game) => !game.installed).length,
                          ),
                        })}
                      </span>
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
                      <button
                        key={g.id}
                        className="tile"
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
          {page === "settings" && (
            <section className="settings-hub" id="content" tabIndex={-1}>
              <div className="settings-hub-heading">
                <p className="eyebrow">
                  {version ? `Sofa ${version}` : "Sofa"}
                </p>
                <h1>{t("settings")}</h1>
                <p>{t("settingsHubIntro")}</p>
              </div>
              <div className="settings-hub-grid">
                <button
                  onClick={() => {
                    setSettingsTarget("library");
                    setSettings(true);
                  }}
                >
                  <SquaresFourIcon aria-hidden />
                  <strong>{t("librarySettings")}</strong>
                  <span>{t("settingsLibraryDescription")}</span>
                </button>
                <button
                  onClick={() => {
                    setSettingsTarget("appearance");
                    setSettings(true);
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
                  className={update ? "has-update" : undefined}
                  onClick={() => {
                    setSettingsTarget("updates");
                    setSettings(true);
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
          {status || (!isTauri() && !demo ? t("browserPreview") : "Sofa")}
        </span>
        {update && (
          <button className="update" disabled={updating} onClick={install}>
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
                {details.source.toUpperCase()} ·{" "}
                {t(details.installed ? "installed" : "availableToInstall")}
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
            <p className="muted">
              {t(details.installed ? "launchHint" : "installHint")}
            </p>
            <div className="detail-actions">
              <button
                data-initial-focus
                className="accent"
                disabled={details.installed && launching}
                onClick={() =>
                  void (details.installed
                    ? play(details)
                    : installGame(details))
                }
              >
                {t(details.installed ? "play" : "installGame")}
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
            {details.installed && (
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
            )}
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog
          label={t(
            settingsTarget === "library"
              ? "librarySettings"
              : settingsTarget === "appearance"
                ? "appearance"
                : "updates",
          )}
          onClose={() => setSettings(false)}
        >
          <div className="settings-head">
            <h1>
              {t(
                settingsTarget === "library"
                  ? "librarySettings"
                  : settingsTarget === "appearance"
                    ? "appearance"
                    : "updates",
              )}
            </h1>
            <button onClick={() => setSettings(false)} aria-label={t("close")}>
              <XIcon />
            </button>
          </div>
          <div className="settings-body">
            {settingsTarget === "library" && (
              <>
                <section className="library-account">
                  <div>
                    <h3>Steam</h3>
                    <p>{t("steamLibraryDescription")}</p>
                  </div>
                  {steamConnected || demo ? (
                    <div className="library-account-connected">
                      <span>
                        {t("steamLibraryConnected", {
                          count: String(ownedGames.length),
                        })}
                      </span>
                      <div className="detail-actions">
                        <button
                          data-initial-focus
                          disabled={loading}
                          onClick={() => void scan()}
                        >
                          {t("refresh")}
                        </button>
                        {!demo && (
                          <button
                            disabled={steamBusy}
                            onClick={() => void disconnectSteamLibrary()}
                          >
                            {t("disconnect")}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      data-initial-focus
                      className="accent"
                      disabled={steamBusy || !isTauri()}
                      onClick={() => void connectSteamLibrary()}
                    >
                      {t(steamBusy ? "connecting" : "connectSteam")}
                    </button>
                  )}
                  <p className="muted">{t("steamLibraryPrivacy")}</p>
                  <p className="muted">{t("otherSourcesInstalledOnly")}</p>
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
                <button
                  onClick={() => {
                    setPage("library");
                    setTab("hidden");
                    setSettings(false);
                  }}
                >
                  {t("hidden")} ({prefs.hidden.length})
                </button>
              </>
            )}
            {settingsTarget === "appearance" && (
              <>
                <label>
                  {t("language")}
                  <select
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
                <button onClick={() => void fullscreen()}>
                  {t("fullscreen")}
                </button>
                {xboxMode && (
                  <>
                    <button
                      aria-pressed={xboxStartup}
                      disabled={toggleXboxStartup.isPending}
                      onClick={() => toggleXboxStartup.mutate(!xboxStartup)}
                    >
                      {t("xboxModeStartup")}: {t(xboxStartup ? "on" : "off")}
                    </button>
                    <p className="muted">{t("xboxModeStartupNote")}</p>
                    {xboxMode.home && xboxMode.active === false && (
                      <button
                        onClick={() =>
                          void invoke("enter_xbox_mode").catch((error) =>
                            setStatus(t(serviceError(error))),
                          )
                        }
                      >
                        {t("enterXboxMode")}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => {
                    setSettings(false);
                    setPowerMenu(true);
                  }}
                >
                  <PowerIcon />
                  {t("powerMenu")}
                </button>
              </>
            )}
            {settingsTarget === "updates" && (
              <>
                {version && <p>{t("installedVersion", { version })}</p>}
                <button
                  disabled={checking || updating}
                  onClick={() => (update ? install() : void checkUpdates())}
                >
                  {update
                    ? t("updateAvailable", { version: update.version })
                    : t("checkUpdates")}
                </button>
              </>
            )}
            <p className="settings-status" role="status">
              {status}
            </p>
          </div>
        </Dialog>
      )}
    </main>
  );
}
