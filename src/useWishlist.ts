import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Region } from "./library";
import { commandQuery, demo, parseWishlist } from "./services";

/** A store's offer for a wishlist game today (CheapShark, US dollars). */
type Offer = {
  storeID: string;
  dealID: string;
  price: string;
  retailPrice: string;
  savings: string;
};
type FreeGame = {
  id: string;
  title: string;
  image: string | null;
  /** When the giveaway ends (ISO 8601). */
  ends: string;
};
const sixHours = 6 * 60 * 60_000;
const seenKey = "sofa.store.seen";
const parseSeen = (raw: string | null): string[] => {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(list)
      ? list.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * The wishlist with today's prices, and Epic's free games: what the Store's dot announces.
 * A game counts as dropped when it costs less than when it was saved. While `viewing` (the
 * Store is open), current news is marked seen.
 */
export function useWishlist(region: Region, lang: string, viewing: boolean) {
  const key = demo ? "sofa.demo.wishlist" : "sofa.wishlist";
  const [wishlist, setWishlist] = useState(() =>
    parseWishlist(localStorage.getItem(key)),
  );
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(wishlist));
  }, [wishlist, key]);
  const live = isTauri() && !demo;
  const ids = wishlist
    .map((d) => d.gameID)
    .sort()
    .join(",");
  const prices =
    useQuery({
      ...commandQuery<Record<string, Offer>>("wishlist_prices", {
        ids: ids.split(","),
      }),
      enabled: live && ids !== "",
      staleTime: sixHours,
      refetchInterval: sixHours,
    }).data ?? {};
  const free = (
    useQuery({
      ...commandQuery<FreeGame[]>("epic_free_games", { region, lang }),
      enabled: live,
      staleTime: 60 * 60_000,
      refetchInterval: sixHours,
    }).data ?? []
  ).filter((g) => Date.parse(g.ends) > Date.now());
  const dropped = new Set(
    wishlist
      .filter(
        (d) =>
          prices[d.gameID] &&
          Number(prices[d.gameID].price) < Number(d.salePrice) - 0.005,
      )
      .map((d) => d.gameID),
  );
  const news = [
    ...[...dropped].map((id) => `drop:${id}:${prices[id]?.price}`),
    ...free.map((g) => `free:${g.id}`),
  ].join("|");
  const [seen, setSeen] = useState(
    () => new Set(parseSeen(localStorage.getItem(seenKey))),
  );
  const unseen = news !== "" && news.split("|").some((n) => !seen.has(n));
  useEffect(() => {
    if (!viewing || !unseen) return;
    const current = news.split("|");
    setSeen(new Set(current));
    localStorage.setItem(seenKey, JSON.stringify(current));
  }, [viewing, unseen, news]);
  return { wishlist, setWishlist, prices, dropped, free, unseen };
}
export type Wishlist = ReturnType<typeof useWishlist>;
