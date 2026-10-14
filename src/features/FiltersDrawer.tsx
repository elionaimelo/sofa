import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  HeartIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Picker } from "../components/Picker";
import { SearchField } from "../components/SearchField";
import type { Lang, Translate } from "../i18n";
import { activeFilters, defaultFilters, type Preferences } from "../library";
import { categoryLabel, type useCategories } from "./Categories";

export type FilterTab = "categories" | "options";
type Choice = { key: string; label: string; count: number };

/** Active filters per drawer tab, shown on the tab itself. */
export const filterCount = (filters: Preferences["filters"], tab: FilterTab) =>
  tab === "categories"
    ? filters.categories.length
    : Number(filters.played !== "any") +
      Number(filters.artwork !== "any") +
      Number(filters.favoritesOnly);

/** The library's filters, in a drawer on the right: categories in one tab, the rest in another. */
export function FiltersDrawer({
  t,
  lang,
  prefs,
  setPrefs,
  tab,
  setTab,
  choices,
  categories,
  onToggleCategory,
  onClose,
}: {
  t: Translate;
  lang: Lang;
  prefs: Preferences;
  setPrefs: Dispatch<SetStateAction<Preferences>>;
  tab: FilterTab;
  setTab: (tab: FilterTab) => void;
  choices: Choice[];
  categories: Pick<
    ReturnType<typeof useCategories>,
    "loading" | "unavailable" | "retry"
  >;
  onToggleCategory: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = (choice: Choice) =>
    categoryLabel(choice.label, lang)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  const setFilters = (patch: Partial<Preferences["filters"]>) =>
    setPrefs((p) => ({ ...p, filters: { ...p.filters, ...patch } }));
  return (
    <>
      <button
        className="drawer-backdrop"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div className="library-filters" id="library-filters" data-filter-panel>
        <div className="drawer-head">
          <h2>{t("filters")}</h2>
          {activeFilters(prefs.filters) > 0 && (
            <span className="drawer-count">{activeFilters(prefs.filters)}</span>
          )}
          <button className="close" onClick={onClose} aria-label={t("close")}>
            <XIcon />
          </button>
        </div>
        <div className="segmented filter-tabs" role="tablist">
          {(["categories", "options"] as const).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {t(name === "categories" ? "categories" : "filterOptions")}
              {filterCount(prefs.filters, name) > 0 && (
                <span>{filterCount(prefs.filters, name)}</span>
              )}
            </button>
          ))}
        </div>
        {tab === "categories" && (
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                clearLabel={t("clearSearch")}
              />
            </div>
            <div className="category-options">
              {choices.filter(matches).map((c) => (
                <button
                  key={c.key}
                  aria-pressed={prefs.filters.categories.includes(c.key)}
                  onClick={() => onToggleCategory(c.key)}
                >
                  {/* Picked reads as a check, not as the pink focus ring. */}
                  {prefs.filters.categories.includes(c.key) && (
                    <CheckIcon weight="bold" aria-hidden />
                  )}
                  <span>{categoryLabel(c.label, lang)}</span>
                  <small>{c.count}</small>
                </button>
              ))}
            </div>
            {!choices.length && (
              <p className="muted">
                {t(categories.loading ? "categoriesLoading" : "noCategories")}
              </p>
            )}
            {choices.length > 0 && categories.loading && (
              <p className="muted" role="status">
                {t("categoriesLoading")}
              </p>
            )}
            {categories.unavailable && (
              <p className="category-sync-note">
                {t("categoriesOffline")}{" "}
                <button
                  onClick={() => !categories.loading && categories.retry()}
                  aria-disabled={categories.loading}
                >
                  {t("retry")}
                </button>
              </p>
            )}
            {choices.length > 0 && query && !choices.some(matches) && (
              <p className="muted">{t("noCategorySearch")}</p>
            )}
          </section>
        )}
        {tab === "options" && (
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
                onChange={(played) => setFilters({ played })}
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
                onChange={(artwork) => setFilters({ artwork })}
              />
            </div>
            <button
              className="filter-switch"
              aria-pressed={prefs.filters.favoritesOnly}
              onClick={() =>
                setFilters({ favoritesOnly: !prefs.filters.favoritesOnly })
              }
            >
              <HeartIcon
                weight={prefs.filters.favoritesOnly ? "fill" : "regular"}
              />
              {t("favoritesOnly")}
            </button>
          </div>
        )}
        <div className="filter-actions">
          <button
            onClick={() => setPrefs((p) => ({ ...p, filters: defaultFilters }))}
          >
            <ArrowCounterClockwiseIcon />
            {t("clearFilters")}
          </button>
          <button className="accent" onClick={onClose}>
            <CheckIcon weight="bold" />
            {t("showResults")}
          </button>
        </div>
      </div>
    </>
  );
}
