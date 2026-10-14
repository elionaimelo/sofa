import { useState } from "react";
import type { Game } from "../library";

/**
 * Steam's portrait art is missing for some titles and, for newer ones, so is the header on
 * the legacy CDN (their assets moved to hashed paths); the hero banner is the last resort.
 */
export function coverSources(game: Game): string[] {
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
export function CoverImage({ game }: { game: Game }) {
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

/** A library tile's content: art, title and the store badge. */
export function Cover({ game }: { game: Game }) {
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
