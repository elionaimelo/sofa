import { PlayIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { Translate } from "../i18n";

/** A screenshot or trailer from a game's Steam page (`store_media`, `game_media`). */
type Shot = { image: string; video: string | null };
export type Media = { description: string; gallery: Shot[] };
/** Steam's trailers are HLS streams: WebView2 plays them natively since Chromium 142. */
const playsHls =
  document
    .createElement("video")
    .canPlayType("application/vnd.apple.mpegurl") !== "";

/**
 * What a game is, before buying or installing it: Steam's short description and gallery.
 * Give it a `key` per game so the gallery starts over on the first shot.
 */
export function SteamMedia({
  media,
  loading,
  t,
}: {
  media: Media | undefined;
  loading: boolean;
  t: Translate;
}) {
  if (loading) return <div className="skeleton gallery-skeleton" aria-hidden />;
  const shots = (media?.gallery ?? []).filter((s) => playsHls || !s.video);
  return (
    <>
      {media?.description && <p className="game-about">{media.description}</p>}
      {shots.length > 0 && <Gallery shots={shots} t={t} />}
    </>
  );
}

/**
 * Steam's gallery: the picked shot large, thumbnails in a row below. Focusing or tapping a
 * thumbnail picks it; a trailer plays muted, and A (or a tap) on it turns the sound on or off.
 */
function Gallery({ shots, t }: { shots: Shot[]; t: Translate }) {
  const [picked, setPicked] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const shown = shots[picked] ?? shots[0];
  const label = (shot: Shot, i: number) =>
    t(shot.video ? "trailerN" : "screenshotN", {
      n: String(
        shots.slice(0, i + 1).filter((s) => !s.video === !shot.video).length,
      ),
    });
  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (v.paused) void v.play();
  };
  return (
    <section className="gallery" aria-label={t("gallery")}>
      <div className="gallery-stage">
        {shown.video ? (
          <video
            key={shown.video}
            ref={video}
            src={shown.video}
            poster={shown.image}
            controls
            muted
            playsInline
            autoPlay={!matchMedia("(prefers-reduced-motion: reduce)").matches}
          />
        ) : (
          <img
            key={shown.image}
            src={shown.image}
            alt={label(shown, picked)}
            width={600}
            height={338}
            decoding="async"
          />
        )}
      </div>
      <div className="gallery-strip">
        {shots.map((shot, i) => (
          <button
            key={shot.image}
            aria-label={label(shot, i)}
            aria-current={i === picked}
            onFocus={() => setPicked(i)}
            onClick={() =>
              i === picked && shot.video ? toggleSound() : setPicked(i)
            }
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
