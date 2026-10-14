import {
  GameControllerIcon,
  PlayIcon,
  SteamLogoIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Translate } from "../i18n";

/** A screenshot or trailer from a game's Steam page (`store_media`, `game_media`). */
type Shot = { image: string; video: string | null };
export type Media = {
  description: string;
  gallery: Shot[];
  controller: "full" | "partial" | null;
  /** Steam Deck compatibility: 1 unsupported, 2 playable, 3 verified. */
  deck: number | null;
  reviews: { positive: number; total: number } | null;
};
const deckLabels = {
  1: "deckUnsupported",
  2: "deckPlayable",
  3: "deckVerified",
} as const;
/** Steam's trailers are HLS streams: WebView2 plays them natively since Chromium 142. */
const playsHls =
  document
    .createElement("video")
    .canPlayType("application/vnd.apple.mpegurl") !== "";

/**
 * What a game is, before buying or installing it: what a controller player checks first
 * (controller support, Steam Deck, reviews), then Steam's short description and gallery.
 * Give it a `key` per game so the gallery starts over on the first shot.
 */
export function SteamMedia({
  media,
  loading,
  t,
  lang,
}: {
  media: Media | undefined;
  loading: boolean;
  t: Translate;
  lang: string;
}) {
  if (loading) return <div className="skeleton gallery-skeleton" aria-hidden />;
  const shots = (media?.gallery ?? []).filter((s) => playsHls || !s.video);
  const deck =
    media?.deck != null
      ? deckLabels[media.deck as keyof typeof deckLabels]
      : undefined;
  const reviews = media?.reviews;
  return (
    <>
      {(media?.controller || deck || reviews) && (
        <ul className="game-badges" aria-label={t("gameFacts")}>
          {media?.controller && (
            <li data-good={media.controller === "full" || undefined}>
              <GameControllerIcon aria-hidden />
              {t(
                media.controller === "full"
                  ? "controllerFull"
                  : "controllerPartial",
              )}
            </li>
          )}
          {deck && (
            <li
              data-good={deck === "deckVerified" || undefined}
              data-bad={deck === "deckUnsupported" || undefined}
            >
              <SteamLogoIcon aria-hidden />
              {t(deck)}
            </li>
          )}
          {reviews && (
            <li>
              <ThumbsUpIcon aria-hidden />
              {t("reviewsPositive", {
                percent: new Intl.NumberFormat(lang, {
                  style: "percent",
                }).format(reviews.positive / reviews.total),
                count: new Intl.NumberFormat(lang, {
                  notation: "compact",
                }).format(reviews.total),
              })}
            </li>
          )}
        </ul>
      )}
      {media?.description && <p className="game-about">{media.description}</p>}
      {shots.length > 0 && <Gallery shots={shots} t={t} />}
    </>
  );
}

/**
 * Steam's gallery: the picked shot large, thumbnails in a row below. Focusing or tapping a
 * thumbnail shows it; on a trailer, A (or a tap) plays it with sound and pauses it again.
 * Nothing streams until then, so moving across the strip stays light.
 */
function Gallery({ shots, t }: { shots: Shot[]; t: Translate }) {
  const [picked, setPicked] = useState(0);
  // The picked trailer's player is mounted only after A; moving on unmounts it.
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const shown = shots[picked] ?? shots[0];
  const label = (shot: Shot, i: number) =>
    t(shot.video ? "trailerN" : "screenshotN", {
      n: String(
        shots.slice(0, i + 1).filter((s) => !s.video === !shot.video).length,
      ),
    });
  const pick = (i: number) => {
    if (i === picked) return;
    setPicked(i);
    setPlaying(false);
  };
  const togglePlay = () => {
    const v = video.current;
    if (!playing || !v) setPlaying(true);
    else if (v.paused) void v.play();
    else v.pause();
  };
  // With sound when the webview allows it; muted rather than not at all.
  useEffect(() => {
    const v = video.current;
    if (!playing || !v) return;
    v.play().catch(() => {
      v.muted = true;
      void v.play();
    });
  }, [playing]);
  return (
    <section className="gallery" aria-label={t("gallery")}>
      <div className="gallery-stage">
        {shown.video && playing ? (
          // biome-ignore lint/a11y/useMediaCaption: Steam's trailers ship without caption files.
          <video
            key={shown.video}
            ref={video}
            src={shown.video}
            poster={shown.image}
            controls
            playsInline
          />
        ) : (
          <>
            <img
              key={shown.image}
              src={shown.image}
              alt={label(shown, picked)}
              width={600}
              height={338}
              decoding="async"
            />
            {shown.video && (
              <PlayIcon className="stage-play" weight="fill" aria-hidden />
            )}
          </>
        )}
      </div>
      <div className="gallery-strip">
        {shots.map((shot, i) => (
          <button
            key={shot.image}
            aria-label={label(shot, i)}
            aria-current={i === picked}
            onFocus={() => pick(i)}
            onClick={() => (shot.video ? togglePlay() : pick(i))}
          >
            <img
              src={shot.image}
              alt=""
              width={600}
              height={338}
              loading="lazy"
              decoding="async"
            />
            {shot.video && <PlayIcon weight="fill" aria-hidden />}
          </button>
        ))}
      </div>
    </section>
  );
}
