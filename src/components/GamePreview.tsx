import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../i18n";
import type { Game } from "../library";
import { commandQuery, demo, useReducedMotion } from "../services";
import type { Gameplay, Media } from "./SteamMedia";

/** One decoder, only after selection settles; the image beneath remains the fallback. */
export function GamePreview({
  game,
  lang,
  paused,
}: {
  game: Game;
  lang: Lang;
  paused: boolean;
}) {
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () =>
      setActive(
        document.visibilityState === "visible" &&
          document.hasFocus() &&
          !document.querySelector("dialog[open]"),
      );
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("sofa-dialog-change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("sofa-dialog-change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(timer);
  }, []);
  const enabled = settled && active && !paused && !reduced;
  const media = useQuery({
    ...commandQuery<Media>("game_media", {
      id: game.id,
      title: game.title,
      lang,
    }),
    ...(demo
      ? {
          queryFn: async (): Promise<Media> => {
            const { demoGameplay } = await import("../demoGameplay");
            return {
              description: "",
              gallery: [],
              gameplay: demoGameplay[game.id],
              controller: null,
              deck: null,
              reviews: null,
              english_only: false,
            };
          },
        }
      : {}),
    enabled:
      enabled &&
      (demo || isTauri()) &&
      ["steam", "epic", "gog"].includes(game.source),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const clip = media.data?.gameplay;
  return clip && !reduced ? (
    <PreviewVideo key={clip.video} clip={clip} playing={enabled} />
  ) : null;
}

function PreviewVideo({ clip, playing }: { clip: Gameplay; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const src = clip.video;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element || failed) return;
    if (playing) {
      if (!element.getAttribute("src")) element.src = src;
      void element.play().catch((error: DOMException) => {
        // A policy denial keeps the still art; media errors are handled by onError.
        if (error.name === "NotAllowedError") setFailed(true);
      });
    } else element.pause();
  }, [playing, failed, src]);
  useEffect(() => {
    const element = video.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, []);
  return (
    <video
      ref={video}
      className="backdrop-preview"
      src={src}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      tabIndex={-1}
      data-ready={ready && !failed && playing}
      onLoadedMetadata={(event) => {
        const element = event.currentTarget;
        element.currentTime = Math.min(
          clip.start,
          Math.max(0, element.duration - 1),
        );
      }}
      onPlaying={(event) => {
        if (!event.currentTarget.seeking) setReady(true);
      }}
      onSeeked={() => setReady(true)}
      onTimeUpdate={(event) => {
        const element = event.currentTarget;
        if (
          !element.seeking &&
          (element.currentTime >= clip.end ||
            element.currentTime < clip.start - 0.5)
        )
          element.currentTime = Math.min(
            clip.start,
            Math.max(0, element.duration - 1),
          );
      }}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
