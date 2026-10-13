import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MutableRefObject } from "react";
import { useEffect, useState } from "react";
import type { Translate } from "./i18n";
import type { Action } from "./useInput";
export type MessageKey = Parameters<Translate>[0];
export const demo =
  import.meta.env?.DEV &&
  !isTauri() &&
  new URLSearchParams(location.search).has("demo");
export type InputRef = MutableRefObject<((a: Action) => void) | null>;
export function useFeatureInput(ref: InputRef, handler: (a: Action) => void) {
  useEffect(() => {
    ref.current = handler;
    return () => {
      ref.current = null;
    };
  });
}
export function navigateControls(a: Action, root: Element | null): boolean {
  if (!root) return false;
  const controls = [
    ...root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input, select, a[href]",
    ),
  ];
  const current = document.activeElement as HTMLElement;
  if (["up", "down", "left", "right"].includes(a)) {
    const i = controls.indexOf(current);
    controls[
      (i + (["up", "left"].includes(a) ? -1 : 1) + controls.length) %
        controls.length
    ]?.focus();
    return true;
  }
  if (
    a === "a" &&
    (current instanceof HTMLButtonElement ||
      current instanceof HTMLAnchorElement ||
      (current instanceof HTMLInputElement && current.type === "checkbox"))
  ) {
    current.click();
    return true;
  }
  if ((a === "lb" || a === "rb") && current instanceof HTMLSelectElement) {
    current.selectedIndex =
      (current.selectedIndex + (a === "lb" ? -1 : 1) + current.options.length) %
      current.options.length;
    current.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}
const focusableSelector =
  "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]";

export function navigateSpatial(a: Action, root: Element | null, initial?: HTMLElement | null): boolean {
  if (!root) return false;
  const controls = [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.closest("[inert], [hidden]") &&
      getComputedStyle(element).visibility !== "hidden" &&
      element.getClientRects().length > 0,
  );
  const current = document.activeElement as HTMLElement;
  if (a === "a") {
    if (controls.includes(current)) {
      current.click();
      return true;
    }
    if (initial && controls.includes(initial)) {
      initial.focus();
      initial.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    }
    return false;
  }
  if ((a === "lb" || a === "rb") && current instanceof HTMLSelectElement && controls.includes(current)) {
    current.selectedIndex =
      (current.selectedIndex + (a === "lb" ? -1 : 1) + current.options.length) % current.options.length;
    current.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (!["up", "down", "left", "right"].includes(a) || !controls.length) return false;
  if (!controls.includes(current)) {
    const target = initial && controls.includes(initial) ? initial : controls[0];
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const vertical = a === "up" || a === "down";
  const direction = a === "up" || a === "left" ? -1 : 1;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const candidate of controls) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const primary = (vertical ? y - cy : x - cx) * direction;
    if (primary <= 1) continue;
    const secondary = Math.abs(vertical ? x - cx : y - cy);
    const overlap = vertical
      ? Math.min(from.right, rect.right) > Math.max(from.left, rect.left)
      : Math.min(from.bottom, rect.bottom) > Math.max(from.top, rect.top);
    const score = primary + secondary * (overlap ? 0.35 : 2.5);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  return true;
}
const serviceErrors: MessageKey[] = [
  "network",
  "rateLimit",
  "authFailed",
  "accessDenied",
  "serviceUnavailable",
  "invalidResponse",
  "invalidInput",
  "notConnected",
  "openFailed",
  "desktopRequired",
  "batteryUnavailable",
  "powerFailed",
  "powerUnavailable",
  "powerControlUnavailable",
  "hibernateUnavailable",
  "confirmationRequired",
  "affiliateNotConfigured",
  "installUnavailable",
  "steamLoginCancelled",
  "steamSessionExpired",
  "settingUnavailable",
];
/** Message key for a backend error; anything else (URLs, OS text) becomes serviceUnavailable. */
export const serviceError = (error: unknown, known: MessageKey[] = []): MessageKey => {
  const key = String(error) as MessageKey;
  return serviceErrors.includes(key) || known.includes(key) ? key : "serviceUnavailable";
};
/** Runs `read` now and every `ms` while mounted; each caller polls one fixed command. */
export function usePoll<T>(read: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<MessageKey | "">("");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const value = await read();
        if (alive) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setData(null);
          setError(serviceError(e));
        }
      }
      if (alive) timer = setTimeout(() => void tick(), ms);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return { data, error };
}
export async function desktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) throw "desktopRequired";
  return invoke<T>(command, args);
}
export type Deal = {
  gameID: string;
  dealID: string;
  storeID: string;
  title: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  thumb: string;
  steamAppID: string | null;
};
export type Shop = { storeID: string; storeName: string; isActive: number };
export type StoreGame = {
  info: { title: string; thumb: string; steamAppID: string | null };
  cheapestPriceEver: { price: string; date: number };
  deals: {
    storeID: string;
    dealID: string;
    price: string;
    retailPrice: string;
    savings: string;
  }[];
};
export function parseWishlist(raw: string | null): Deal[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.filter((item): item is Deal => {
      if (!item || typeof item !== "object") return false;
      const d = item as Deal;
      if (
        ![
          d.gameID,
          d.dealID,
          d.storeID,
          d.title,
          d.salePrice,
          d.normalPrice,
          d.savings,
          d.thumb,
        ].every((v) => typeof v === "string") ||
        !/^\d{1,16}$/.test(d.gameID) ||
        seen.has(d.gameID) ||
        (d.steamAppID !== null && typeof d.steamAppID !== "string")
      )
        return false;
      seen.add(d.gameID);
      return true;
    });
  } catch {
    return [];
  }
}
export function usd(value: string, lang: string) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(lang, {
        style: "currency",
        currency: "USD",
      }).format(n)
    : "—";
}
export const demoDeals: Deal[] = [
  {
    gameID: "1",
    dealID: "demo",
    storeID: "1",
    title: "Cyberpunk 2077",
    salePrice: "20.99",
    normalPrice: "59.99",
    savings: "65",
    steamAppID: "1091500",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg",
  },
  {
    gameID: "2",
    dealID: "demo",
    storeID: "7",
    title: "ELDEN RING",
    salePrice: "35.99",
    normalPrice: "59.99",
    savings: "40",
    steamAppID: "1245620",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg",
  },
  {
    gameID: "3",
    dealID: "demo",
    storeID: "1",
    title: "Hades",
    salePrice: "8.49",
    normalPrice: "24.99",
    savings: "66",
    steamAppID: "1145360",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg",
  },
  {
    gameID: "4",
    dealID: "demo",
    storeID: "1",
    title: "Baldur's Gate 3",
    salePrice: "44.99",
    normalPrice: "59.99",
    savings: "25",
    steamAppID: "1086940",
    thumb:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/header.jpg",
  },
];
export const dealArt = (
  d: { steamAppID: string | null; thumb: string },
  wide = false,
) =>
  d.steamAppID && /^\d+$/.test(d.steamAppID)
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${d.steamAppID}/${wide ? "library_hero" : "library_600x900"}.jpg`
    : d.thumb;

export type PartnerOffer = {
  id: string;
  shop: string;
  quote: { amount: string; currency: string; expires_at: number } | null;
};
