import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  SteamLogoIcon,
  TrendDownIcon,
} from "@phosphor-icons/react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cover, CoverImage } from "../components/Cover";
import { DetailFrame } from "../components/DetailFrame";
import { SearchField } from "../components/SearchField";
import { type Media, SteamMedia } from "../components/SteamMedia";
import type { Lang, Translate } from "../i18n";
import {
  byTaste,
  type Game,
  type Region,
  type Similar,
  type TagWeights,
  tasteProfile,
} from "../library";
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
  queryError,
  type Shop,
  type StoreGame,
  serviceError,
  usd,
  useFeatureInput,
} from "../services";
import type { Wishlist } from "../useWishlist";

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
/** A Steam title the store only knows by id: the comparison resolves it on open. */
const fromSimilar = (s: Similar): Deal => ({
  gameID: "",
  dealID: "",
  storeID: STEAM_STORE,
  title: s.name,
  salePrice: "",
  normalPrice: "",
  savings: "0",
  thumb: "",
  steamAppID: s.appId,
});
const tabs = ["discover", "wishlist"] as const;
/** A store item as a library game, so its art gets the same fallbacks as library covers. */
const asGame = (d: Pick<Deal, "steamAppID" | "thumb" | "title">): Game => ({
  id: d.steamAppID ? `steam:${d.steamAppID}` : `deal:${d.title}`,
  title: d.title,
  source: "steam",
  launch: "",
  installed: false,
  cover: dealArt(d),
});
export function Store({
  t,
  lang,
  region,
  owned,
  taste,
  saved,
  steamConnected,
  input,
  onBack,
}: {
  t: Translate;
  lang: Lang;
  region: Region;
  /** Steam app ids the player already has, never recommended. */
  owned: Set<string>;
  /** The player's Steam titles and how much each says about their taste (`tasteWeights`). */
  taste: { appId: string; weight: number }[];
  /** The wishlist with today's prices and Epic's free games (`useWishlist`). */
  saved: Wishlist;
  steamConnected: boolean;
  input: InputRef;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("discover");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { wishlist, setWishlist } = saved;
  const [selected, setSelected] = useState<Deal | null>(null);
  // CheapShark pages of 48; a new search starts over.
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
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
  const pageDeals = dealsQuery.data?.deals ?? [];
  const pages = dealsQuery.data?.pages ?? 1;
  const shops = shopsQuery.data ?? [];
  // Each page is ordered by the player's taste: Steam tags of their games, weighted by hours,
  // recent sessions and favourites, against each deal's tags. Unrelated deals keep their
  // order behind; without play history the order doesn't change.
  const tasteTags = useQuery({
    ...commandQuery<TagWeights>("steam_tags", {
      ids: taste.map((g) => g.appId),
    }),
    enabled: !demo && taste.length > 0,
    staleTime: 60 * 60_000,
  }).data;
  const profile = useMemo(
    () => tasteProfile(taste, tasteTags ?? {}),
    [taste, tasteTags],
  );
  const dealIds = [
    ...new Set(
      pageDeals.map((d) => d.steamAppID).filter((id): id is string => !!id),
    ),
  ];
  const dealTagsQuery = useQuery({
    ...commandQuery<TagWeights>("steam_tags", { ids: dealIds }),
    enabled: !demo && profile.size > 0 && dealIds.length > 0,
    staleTime: 60 * 60_000,
  });
  const deals = useMemo(
    () => byTaste(pageDeals, profile, dealTagsQuery.data ?? {}),
    [pageDeals, profile, dealTagsQuery.data],
  );
  // Wait for the tags before showing a page, so the grid doesn't reorder under the cursor.
  const loading =
    dealsQuery.isFetching ||
    shopsQuery.isPending ||
    (profile.size > 0 && dealIds.length > 0 && dealTagsQuery.isPending);
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
        : wishlist
            .filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
            // Saved games show today's cheapest offer, not the one from when they were saved.
            .map((d) => {
              const today = saved.prices[d.gameID];
              return today
                ? {
                    ...d,
                    storeID: today.storeID,
                    dealID: today.dealID,
                    salePrice: today.price,
                    normalPrice: today.retailPrice,
                    savings: today.savings,
                  }
                : d;
            }),
    [deals, wishlist, tab, query, saved.prices],
  );
  // The connected Steam account's wishlist, added to Sofa's; Rust paces the lookups.
  const importSteam = useMutation({
    mutationFn: () => desktop<Deal[]>("import_steam_wishlist"),
    onMutate: () => setStatus(t("importingWishlist")),
    onSuccess: (imported) => {
      const fresh = imported.filter(
        (d) => !wishlist.some((g) => g.gameID === d.gameID),
      );
      setWishlist((list) => [
        ...list,
        ...fresh.filter((d) => !list.some((g) => g.gameID === d.gameID)),
      ]);
      setStatus(t("wishlistImported", { count: String(fresh.length) }));
    },
    onError: (e) => setStatus(t(serviceError(e))),
  });
  // Steam's own price in the region, for Steam offers and the selected game.
  const steamIds = [
    ...new Set(
      [...visible, ...(selected ? [selected] : [])]
        .map((d) => d.steamAppID)
        .filter((id): id is string => !!id),
    ),
  ]
    .sort()
    .slice(0, 60)
    .join(",");
  const regionalQuery = useQuery({
    queryKey: ["steam_prices", region, steamIds],
    queryFn: () =>
      desktop<Record<string, RegionalPrice>>("steam_prices", {
        ids: steamIds.split(","),
        region,
      }),
    enabled: !demo && steamIds !== "",
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
  /** The deal's own discount, or Steam's for Steam offers. */
  const discount = (d: Deal) =>
    d.storeID === STEAM_STORE && steamPrice(d)
      ? (steamPrice(d)?.discount ?? 0)
      : Math.round(Number(d.savings) || 0);
  // "You may also like" under the comparison: Steam's similar titles the player doesn't own.
  const alsoLike = (
    useQuery({
      ...commandQuery<Similar[]>("store_similar", {
        appId: selected?.steamAppID,
      }),
      enabled: !!selected?.steamAppID && !demo,
      staleTime: 60 * 60_000,
    }).data ?? []
  )
    .filter((s) => !owned.has(s.appId))
    .slice(0, 6);
  // Steam's description and gallery, to show what the game is before the prices.
  const media = useQuery({
    ...commandQuery<Media>("store_media", {
      appId: selected?.steamAppID,
      lang,
    }),
    enabled: !!selected?.steamAppID && !demo,
    // Store pages barely change; Rust keeps them on disk for 30 days.
    staleTime: Number.POSITIVE_INFINITY,
  });
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
  /** A recommendation only has a Steam id; CheapShark's entry gives it offers to compare. */
  const resolve = async (d: Deal): Promise<Deal | null> => {
    if (d.gameID || !d.steamAppID) return d;
    try {
      // Through the query cache: opening the same recommendation again doesn't refetch.
      const found = await queryClient.fetchQuery({
        ...commandQuery<Deal | null>("store_lookup", { appId: d.steamAppID }),
        staleTime: 60 * 60_000,
      });
      if (!found) setStatus(t("noOffers"));
      return found;
    } catch (e) {
      setStatus(t(serviceError(e)));
      return null;
    }
  };
  const open = (d: Deal) =>
    void resolve(d).then((found) => found && setSelected(found));
  const toggle = (d: Deal) =>
    void resolve(d).then(
      (found) =>
        found &&
        setWishlist((list) =>
          list.some((g) => g.gameID === found.gameID)
            ? list.filter((g) => g.gameID !== found.gameID)
            : [...list, found],
        ),
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
      setTab(
        (s) =>
          tabs[
            (tabs.indexOf(s) + (a === "lb" ? -1 : 1) + tabs.length) %
              tabs.length
          ],
      );
      return;
    }
    // The pager below the grid: DOWN from the last row reaches it, UP returns to the tiles.
    const pager = document.querySelector<HTMLElement>(".store-pager");
    if (pager?.contains(document.activeElement)) {
      if (a === "up") (document.activeElement as HTMLElement).blur();
      else navigateSpatial(a, pager);
      return;
    }
    if (a === "a" && visible[focus]) open(visible[focus]);
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
        <div className="wishlist-bar">
          <p className="inline-note">{t("wishlistPriceNote")}</p>
          {steamConnected && !demo && (
            <button
              aria-busy={importSteam.isPending}
              onClick={() => !importSteam.isPending && importSteam.mutate()}
            >
              <SteamLogoIcon />
              {t(
                importSteam.isPending
                  ? "importingWishlist"
                  : "importSteamWishlist",
              )}
            </button>
          )}
        </div>
      )}
      {tab === "discover" && !search && page === 0 && saved.free.length > 0 && (
        <section className="free-games" aria-label={t("freeOnEpic")}>
          <h2>{t("freeOnEpic")}</h2>
          <div className="free-row">
            {saved.free.map((g) => (
              <button
                key={g.id}
                className="free-card"
                onClick={() =>
                  void desktop("open_epic_free", { id: g.id }).catch((e) =>
                    setStatus(t(serviceError(e))),
                  )
                }
              >
                {g.image && (
                  <img
                    src={g.image}
                    alt=""
                    width={640}
                    height={360}
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <span>
                  <strong>{g.title}</strong>
                  <small>
                    {t("freeUntil", {
                      date: new Intl.DateTimeFormat(lang, {
                        dateStyle: "medium",
                      }).format(new Date(g.ends)),
                    })}
                  </small>
                </span>
                <ArrowUpRightIcon />
              </button>
            ))}
          </div>
        </section>
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
              key={d.gameID || `steam:${d.steamAppID}`}
              aria-current={i === focus}
              onFocus={() => setFocus(i)}
              onMouseEnter={() => setFocus(i)}
              onClick={() => open(d)}
            >
              <div className="deal-art">
                <CoverImage game={asGame(d)} />
                {discount(d) > 0 && (
                  <span className="discount">−{discount(d)}%</span>
                )}
                {tab === "wishlist" && saved.dropped.has(d.gameID) && (
                  <span className="price-drop">
                    <TrendDownIcon weight="bold" />
                    {t("priceDropped")}
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
                {d.storeID === STEAM_STORE &&
                d.steamAppID &&
                regional[d.steamAppID] ? (
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
          cover={<CoverImage key={selected.gameID} game={asGame(selected)} />}
          closeLabel={t("close")}
          onClose={() => setSelected(null)}
        >
          <p className="detail-meta">
            {t("compare")}
            {selected.storeID ? ` · ${name(selected.storeID)}` : ""}
          </p>
          <h1>{selected.title}</h1>
          <SteamMedia
            key={selected.steamAppID}
            media={media.data}
            loading={media.isLoading}
            t={t}
            lang={lang}
          />
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
          {alsoLike.length > 0 && (
            <section className="also-like" aria-label={t("alsoLike")}>
              <h2>{t("alsoLike")}</h2>
              <div className="also-like-row">
                {alsoLike.map((s) => (
                  <button
                    key={s.appId}
                    className="tile"
                    aria-label={s.name}
                    title={s.name}
                    onClick={() => open(fromSimilar(s))}
                  >
                    <Cover
                      game={asGame({
                        steamAppID: s.appId,
                        thumb: "",
                        title: s.name,
                      })}
                    />
                  </button>
                ))}
              </div>
            </section>
          )}
          <p role="status">{status}</p>
        </DetailFrame>
      )}
    </section>
  );
}
