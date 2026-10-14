import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  HeartIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { DetailFrame } from "../components/DetailFrame";
import { SearchField } from "../components/SearchField";
import type { Lang, Translate } from "../i18n";
import type { Region } from "../library";
import {
  commandQuery,
  type Deal,
  dealArt,
  demo,
  demoDeals,
  desktop,
  type InputRef,
  type MessageKey,
  money,
  navigateControls,
  navigateSpatial,
  type PartnerOffer,
  parseWishlist,
  queryError,
  type Shop,
  type StoreGame,
  serviceError,
  usd,
  useFeatureInput,
} from "../services";

const demoShops: Shop[] = [
  { storeID: "1", storeName: "Steam", isActive: 1 },
  { storeID: "7", storeName: "GOG", isActive: 1 },
];
type DealsPage = { deals: Deal[]; pages: number };
/** CheapShark's store id for Steam. */
const STEAM_STORE = "1";
type RegionalPrice = {
  currency: string;
  initial: number;
  final: number;
  discount: number;
};
export function Store({
  t,
  lang,
  region,
  input,
  onBack,
}: {
  t: Translate;
  lang: Lang;
  region: Region;
  input: InputRef;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"discover" | "wishlist">("discover");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const storageKey = demo ? "sofa.demo.wishlist" : "sofa.wishlist";
  const [wishlist, setWishlist] = useState(() =>
    parseWishlist(localStorage.getItem(storageKey)),
  );
  const [selected, setSelected] = useState<Deal | null>(null);
  // CheapShark pages of 48; a new search starts over.
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(wishlist));
  }, [wishlist, storageKey]);
  // Prices move slowly; revisiting the store or a game within 5 minutes reuses the cache.
  const dealsQuery = useQuery({
    queryKey: ["store_deals", search, page],
    queryFn: (): Promise<DealsPage> | DealsPage =>
      demo
        ? {
            deals: demoDeals.filter((d) =>
              d.title.toLowerCase().includes(search.toLowerCase()),
            ),
            pages: 1,
          }
        : desktop<DealsPage>("store_deals", { query: search, page }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const shopsQuery = useQuery({
    queryKey: ["store_shops"],
    queryFn: () => (demo ? demoShops : desktop<Shop[]>("store_shops")),
    staleTime: 60 * 60_000,
  });
  const deals = dealsQuery.data?.deals ?? [];
  const pages = dealsQuery.data?.pages ?? 1;
  const shops = shopsQuery.data ?? [];
  const loading = dealsQuery.isFetching || shopsQuery.isPending;
  const error = queryError(dealsQuery.error ?? shopsQuery.error);
  const refresh = () => {
    void dealsQuery.refetch();
    if (shopsQuery.error) void shopsQuery.refetch();
  };
  const compareQuery = useQuery({
    queryKey: ["store_game", selected?.gameID],
    queryFn: (): Promise<StoreGame> | StoreGame =>
      demo && selected
        ? {
            info: {
              title: selected.title,
              thumb: selected.thumb,
              steamAppID: selected.steamAppID,
            },
            cheapestPriceEver: { price: selected.salePrice, date: 0 },
            deals: [
              {
                storeID: selected.storeID,
                dealID: selected.dealID,
                price: selected.salePrice,
                retailPrice: selected.normalPrice,
                savings: selected.savings,
              },
            ],
          }
        : desktop<StoreGame>("store_game", { id: selected?.gameID }),
    enabled: !!selected,
    staleTime: 5 * 60_000,
  });
  const comparison = compareQuery.data ?? null;
  const compareError = queryError(compareQuery.error);
  // Partner offers are optional extras: failures just hide them.
  const partners =
    useQuery({
      ...commandQuery<PartnerOffer[]>("partner_offers", {
        steamAppId: selected?.steamAppID,
      }),
      enabled: !!selected?.steamAppID && !demo,
      staleTime: 60 * 60_000,
    }).data ?? [];
  const visible = useMemo(
    () =>
      tab === "discover"
        ? deals
        : wishlist.filter((d) =>
            d.title.toLowerCase().includes(query.toLowerCase()),
          ),
    [deals, wishlist, tab, query],
  );
  // CheapShark prices are US dollars; outside the US, Steam's price in the user's region
  // replaces them for every deal that has a Steam id.
  const steamIds = visible
    .map((d) => d.steamAppID)
    .filter((id): id is string => !!id)
    .sort()
    .join(",");
  const regionalQuery = useQuery({
    queryKey: ["steam_prices", region, steamIds],
    queryFn: () =>
      desktop<Record<string, RegionalPrice>>("steam_prices", {
        ids: steamIds.split(","),
        region,
      }),
    enabled: region !== "us" && !demo && steamIds !== "",
    staleTime: 5 * 60_000,
  });
  const regional = regionalQuery.data ?? {};
  // Every other price is in US dollars: shown converted (marked ≈) where a rate is known.
  const rate = useQuery({
    ...commandQuery<{ currency: string; per_usd: number | null }>("usd_rate", {
      region,
    }),
    enabled: region !== "us" && !demo,
    staleTime: 6 * 60 * 60_000,
  }).data;
  const price = (usdValue: string) => {
    const amount = Number(usdValue);
    if (!rate?.per_usd || rate.currency === "USD" || !Number.isFinite(amount))
      return usd(usdValue, lang);
    return (
      <span title={t("convertedFrom", { price: usd(usdValue, lang) })}>
        ≈ {money(Math.round(amount * rate.per_usd * 100), rate.currency, lang)}
      </span>
    );
  };
  /** Steam's own price in the region, for a Steam offer of the selected game. */
  const steamPrice = (d: Deal | null) =>
    d?.steamAppID ? regional[d.steamAppID] : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab or search starts at the first deal.
  useEffect(() => setFocus(0), [tab, search]);
  useEffect(() => {
    setFocus((f) => Math.min(f, Math.max(visible.length - 1, 0)));
  }, [visible.length]);
  useEffect(() => {
    grid.current?.children[focus]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [focus]);
  const toggle = (d: Deal) =>
    setWishlist((list) =>
      list.some((g) => g.gameID === d.gameID)
        ? list.filter((g) => g.gameID !== d.gameID)
        : [...list, d],
    );
  const buy = async (id: string) => {
    setStatus("");
    if (demo) {
      setStatus(t("demoPrices"));
      return;
    }
    try {
      await desktop("open_deal", { id });
    } catch (e) {
      setStatus(t(serviceError(e)));
    }
  };
  useFeatureInput(input, (a) => {
    if (a === "b") {
      if (selected) setSelected(null);
      else onBack();
      return;
    }
    if (selected) {
      navigateControls(a, document.querySelector("dialog[open]"));
      if (a === "x") toggle(selected);
      return;
    }
    if (a === "lb" || a === "rb") {
      setTab((s) => (s === "discover" ? "wishlist" : "discover"));
      return;
    }
    // The pager below the grid: DOWN from the last row reaches it, UP returns to the tiles.
    const pager = document.querySelector<HTMLElement>(".store-pager");
    if (pager?.contains(document.activeElement)) {
      if (a === "up") (document.activeElement as HTMLElement).blur();
      else navigateSpatial(a, pager);
      return;
    }
    if (a === "a" && visible[focus]) setSelected(visible[focus]);
    if (a === "x" && visible[focus]) toggle(visible[focus]);
    if (a === "y") refresh();
    const cols = grid.current
      ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length
      : 1;
    const delta =
      a === "left"
        ? -1
        : a === "right"
          ? 1
          : a === "up"
            ? -cols
            : a === "down"
              ? cols
              : 0;
    if (delta) {
      if (a === "down" && pager && focus + cols >= visible.length) {
        pager.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
        return;
      }
      (document.activeElement as HTMLElement)?.blur();
      setFocus((f) => Math.max(0, Math.min(visible.length - 1, f + delta)));
    }
  });
  const goToPage = (next: number) => {
    setPage(next);
    setFocus(0);
    (document.activeElement as HTMLElement)?.blur();
  };
  const name = (id: string) =>
    shops.find((s) => s.storeID === id)?.storeName ?? `${t("store")} ${id}`;
  return (
    <section className="feature-page store-page" id="content" tabIndex={-1}>
      <div className="feature-heading">
        <div>
          <p className="eyebrow">{t("store")}</p>
          <h1>{t("storeIntro")}</h1>
          <p className="feature-description">
            {t(demo ? "demoPrices" : "storeNote")}
          </p>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not form fields (<fieldset>). */}
        <div className="segmented" role="group" aria-label={t("store")}>
          <button
            aria-pressed={tab === "discover"}
            onClick={() => setTab("discover")}
          >
            {t("discover")}
          </button>
          <button
            aria-pressed={tab === "wishlist"}
            onClick={() => setTab("wishlist")}
          >
            <HeartIcon />
            {t("wishlist")}
            <span>{wishlist.length}</span>
          </button>
        </div>
      </div>
      <form
        className="feature-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
          setPage(0);
        }}
      >
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => {
            setQuery("");
            setSearch("");
            setPage(0);
          }}
          clearLabel={t("clearSearch")}
          placeholder={t("searchGames")}
          aria-label={t("searchGames")}
        />
        <button type="submit" aria-label={t("search")} title={t("search")}>
          <MagnifyingGlassIcon />
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          aria-label={t("refresh")}
        >
          <ArrowClockwiseIcon />
        </button>
      </form>
      {tab === "wishlist" && (
        <p className="inline-note">{t("wishlistPriceNote")}</p>
      )}
      {loading && tab === "discover" ? (
        <div
          className="store-grid skeleton-grid"
          aria-label={t("loadingOffers")}
          role="status"
        >
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed, identical loading placeholders.
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : error && tab === "discover" ? (
        <div className="feature-empty" role="alert">
          <h2>{t(error as MessageKey)}</h2>
          <button onClick={refresh}>{t("retry")}</button>
        </div>
      ) : !visible.length ? (
        <div className="feature-empty">
          <HeartIcon size={42} />
          <h2>{t(tab === "wishlist" ? "emptyWishlist" : "noMatches")}</h2>
        </div>
      ) : (
        <div className="store-grid" ref={grid}>
          {visible.map((d, i) => (
            <button
              className="deal-card"
              key={d.gameID}
              aria-current={i === focus}
              onFocus={() => setFocus(i)}
              onMouseEnter={() => setFocus(i)}
              onClick={() => setSelected(d)}
            >
              <div className="deal-art">
                <img
                  src={dealArt(d)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                {Number(d.savings) > 0 && (
                  <span className="discount">
                    −{Math.round(Number(d.savings))}%
                  </span>
                )}
                {wishlist.some((g) => g.gameID === d.gameID) && (
                  <HeartIcon
                    weight="fill"
                    className="saved-heart"
                    role="img"
                    aria-hidden={false}
                    aria-label={t("wishlist")}
                  />
                )}
              </div>
              <div className="deal-copy">
                <span className="deal-shop">{name(d.storeID)}</span>
                <h2>{d.title}</h2>
                {d.steamAppID && regional[d.steamAppID] ? (
                  <div className="price">
                    <strong>
                      {money(
                        regional[d.steamAppID].final,
                        regional[d.steamAppID].currency,
                        lang,
                      )}
                    </strong>
                    {regional[d.steamAppID].discount > 0 && (
                      <del>
                        {money(
                          regional[d.steamAppID].initial,
                          regional[d.steamAppID].currency,
                          lang,
                        )}
                      </del>
                    )}
                    <small>Steam</small>
                    <ArrowUpRightIcon />
                  </div>
                ) : (
                  <div className="price">
                    <strong>{price(d.salePrice)}</strong>
                    {Number(d.normalPrice) > Number(d.salePrice) && (
                      <del>{price(d.normalPrice)}</del>
                    )}
                    <ArrowUpRightIcon />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {tab === "discover" && !loading && pages > 1 && (
        <nav
          className="store-pager"
          aria-label={t("pageOf", {
            page: String(page + 1),
            pages: String(pages),
          })}
        >
          <button disabled={page === 0} onClick={() => goToPage(page - 1)}>
            <CaretLeftIcon weight="bold" />
            {t("previousPage")}
          </button>
          <span>
            {t("pageOf", { page: String(page + 1), pages: String(pages) })}
          </span>
          <button
            disabled={page + 1 >= pages}
            onClick={() => goToPage(page + 1)}
          >
            {t("nextPage")}
            <CaretRightIcon weight="bold" />
          </button>
        </nav>
      )}
      <p className="feature-status" role="status">
        {status}
      </p>
      {selected && (
        <DetailFrame
          label={`${t("compare")} · ${selected.title}`}
          art={dealArt(selected, true)}
          cover={
            <img
              src={dealArt(selected)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          }
          closeLabel={t("close")}
          onClose={() => setSelected(null)}
        >
          <p className="detail-meta">
            {t("compare")} · {name(selected.storeID)}
          </p>
          <h1>{selected.title}</h1>
          <div className="compare-summary">
            <p className="muted">{t(demo ? "demoPrices" : "storeNote")}</p>
            <button data-initial-focus onClick={() => toggle(selected)}>
              <HeartIcon
                weight={
                  wishlist.some((g) => g.gameID === selected.gameID)
                    ? "fill"
                    : "regular"
                }
              />
              {t(
                wishlist.some((g) => g.gameID === selected.gameID)
                  ? "removeWishlist"
                  : "addWishlist",
              )}
            </button>
          </div>
          {compareError ? (
            <div className="inline-error" role="alert">
              {t(compareError as MessageKey)}
              <button onClick={() => void compareQuery.refetch()}>
                {t("retry")}
              </button>
            </div>
          ) : !comparison ? (
            <div
              className="skeleton offer-skeleton"
              role="status"
              aria-label={t("loadingOffers")}
            />
          ) : (
            <>
              <div className="offer-list">
                {[...comparison.deals]
                  .sort((a, b) => Number(a.price) - Number(b.price))
                  .map((offer, i) => (
                    <div
                      className={`offer-row ${i === 0 ? "best-offer" : ""}`}
                      key={offer.dealID}
                    >
                      <span>{name(offer.storeID)}</span>
                      <strong>
                        {offer.storeID === STEAM_STORE && steamPrice(selected)
                          ? money(
                              steamPrice(selected)?.final ?? 0,
                              steamPrice(selected)?.currency ?? "USD",
                              lang,
                            )
                          : price(offer.price)}
                      </strong>
                      <button
                        className={i === 0 ? "accent" : ""}
                        onClick={() => void buy(offer.dealID)}
                      >
                        {t("buy")}
                        <ArrowUpRightIcon />
                      </button>
                    </div>
                  ))}
              </div>
              {!comparison.deals.length && <p>{t("noOffers")}</p>}
              {!demo && comparison.cheapestPriceEver && (
                <p className="muted">
                  {t("lowestPrice")}:{" "}
                  {price(comparison.cheapestPriceEver.price)}
                </p>
              )}
            </>
          )}
          {partners.length > 0 && (
            <section className="partner-offers">
              <h2>{t("partnerOffers")}</h2>
              <p className="muted">{t("affiliateDisclosure")}</p>
              {partners.map((offer) => (
                <div className="offer-row" key={offer.id}>
                  <span>{offer.shop}</span>
                  {offer.quote && offer.quote.expires_at > Date.now() / 1000 ? (
                    <strong>
                      {new Intl.NumberFormat(lang, {
                        style: "currency",
                        currency: offer.quote.currency,
                      }).format(Number(offer.quote.amount))}
                    </strong>
                  ) : (
                    <span className="muted">{t("checkPriceOnStore")}</span>
                  )}
                  <button
                    onClick={() => {
                      void desktop("open_partner_offer", {
                        id: offer.id,
                      }).catch((e) => setStatus(t(serviceError(e))));
                    }}
                  >
                    {t("buy")}
                    <ArrowUpRightIcon />
                  </button>
                </div>
              ))}
            </section>
          )}
          <p role="status">{status}</p>
        </DetailFrame>
      )}
    </section>
  );
}
