import type { Gameplay } from "./components/SteamMedia";

/** Real publisher footage for the dev-only library; production resolves it through Rust. */
export const demoGameplay: Record<string, Gameplay | undefined> = {
  // What is Control Video ENG ESRB — https://store.steampowered.com/app/870780/
  "epic:demo-control": {
    video:
      "https://video.akamai.steamstatic.com/store_trailers/870780/303729/fbcaf2833ae6864cd53fde6a9d43a545fe691a19/1750591967/hls_264_master.m3u8?t=1597237267",
    start: 64,
    end: 96,
  },
  // 062_BuildVideos_Ninja_EN UK_PEGI 18_16x9_1080__Burned in Subs — https://store.steampowered.com/app/1091500/
  "steam:1091500": {
    video:
      "https://video.akamai.steamstatic.com/store_trailers/1091500/617916/4fdc027db5638ca8f0b760d9efe5650f4a8d1b0f/1750617322/hls_264_master.m3u8?t=1697117125",
    start: 10,
    end: 40,
  },
  // ELDEN RING Official Gameplay Trailer - UNRATED — https://store.steampowered.com/app/1245620/
  "steam:1245620": {
    video:
      "https://video.akamai.steamstatic.com/store_trailers/1245620/385999/944b71682fb4887ce28f8f281529d7f712a02bf9/1750649922/hls_264_master.m3u8?t=1641422481",
    start: 70,
    end: 100,
  },
  // Hades - v1.0 Gameplay Showcase — https://store.steampowered.com/app/1145360/
  "steam:1145360": {
    video:
      "https://video.akamai.steamstatic.com/store_trailers/1145360/312747/37b96035b5c9c7b12455eadc7bbc7d2b3afbd2fd/1750627553/hls_264_master.m3u8?t=1600353474",
    start: 136,
    end: 148,
  },
};
