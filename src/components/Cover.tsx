import { useState } from "react";
import type { Game } from "../library";

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

/** The current art source for a game, moving to the next one each time an image fails. */
function useCoverSource(game: Game) {
  const [failed, setFailed] = useState(0);
  return {
    src: coverSources(game)[failed] as string | undefined,
    fallback: failed > 0,
    next: () => setFailed((n) => n + 1),
  };
}

/** The art alone, trying each source in turn; nothing when all fail. */
export function CoverImage({ game }: { game: Game }) {
  const { src, fallback, next } = useCoverSource(game);
  return (
    src && (
      <img
        src={src}
        alt=""
        loading="lazy"
        data-fallback={fallback || undefined}
        onError={next}
      />
    )
  );
}

/**
 * A tile's content, console style: the art carries the tile. The name shows only where it is
 * needed (the focused tile in the library, or a game without any art); the tile's aria-label
 * always names it.
 */
export function Cover({ game }: { game: Game }) {
  const { src, fallback, next } = useCoverSource(game);
  return (
    <>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          data-fallback={fallback || undefined}
          onError={next}
        />
      )}
      <span className="title" data-always={!src || undefined}>
        <span>{game.title}</span>
      </span>
    </>
  );
}
