import {
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  HeartIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import { CoverImage } from "../components/Cover";
import { DetailFrame } from "../components/DetailFrame";
import { type Media, SteamMedia } from "../components/SteamMedia";
import type { Lang, Translate } from "../i18n";
import {
  type CategoryMap,
  type Game,
  gameMeta,
  hero,
  type Preferences,
} from "../library";
import { commandQuery } from "../services";
import { CategoryEditor } from "./Categories";
import { Uninstall } from "./Uninstall";

/** The game dialog: facts, categories, the primary action and the secondary ones. */
export function GameDetails({
  game,
  t,
  lang,
  prefs,
  setPrefs,
  catalog,
  sizeEstimate,
  launching,
  onPlay,
  onInstall,
  onToggleFavorite,
  onToggleHidden,
  onUninstalled,
  onClose,
}: {
  game: Game;
  t: Translate;
  lang: Lang;
  prefs: Preferences;
  setPrefs: Dispatch<SetStateAction<Preferences>>;
  catalog: CategoryMap;
  sizeEstimate: number | null | undefined;
  launching: boolean;
  onPlay: (game: Game) => void;
  onInstall: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onToggleHidden: (game: Game) => void;
  onUninstalled: (id: string) => void;
  onClose: () => void;
}) {
  const favorite = prefs.favorites.includes(game.id);
  const hidden = prefs.hidden.includes(game.id);
  // What an uninstalled game is, from its Steam page, to help decide on installing it.
  const media = useQuery({
    ...commandQuery<Media>("game_media", {
      id: game.id,
      title: game.title,
      lang,
    }),
    enabled: !game.installed && isTauri(),
    // Store pages barely change; Rust keeps them on disk for 30 days.
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <DetailFrame
      label={`${t("details")} · ${game.title}`}
      art={hero(game) ?? ""}
      cover={<CoverImage key={game.id} game={game} />}
      closeLabel={t("close")}
      onClose={onClose}
    >
      <p className="detail-meta">
        {game.source.toUpperCase()} ·{" "}
        {t(game.installed ? "installed" : "availableToInstall")}
      </p>
      <h1>{game.title}</h1>
      <p className="detail-meta-line">
        {gameMeta(
          game,
          t,
          lang,
          prefs.recent[game.id],
          game.installed ? undefined : (sizeEstimate ?? undefined),
        )}
      </p>
      <CategoryEditor
        key={game.id}
        game={game}
        prefs={prefs}
        catalog={catalog}
        t={t}
        lang={lang}
        onChange={(labels) =>
          setPrefs((p) => ({
            ...p,
            categories: { ...p.categories, [game.id]: labels },
          }))
        }
      />
      <p className="muted">
        {t(game.installed ? "launchHint" : "installHint")}
      </p>
      <div className="detail-actions">
        <button
          data-initial-focus
          className="accent"
          aria-disabled={game.installed && launching}
          aria-busy={game.installed && launching}
          onClick={() => (game.installed ? onPlay(game) : onInstall(game))}
        >
          {game.installed ? (
            <PlayIcon weight="fill" />
          ) : (
            <DownloadSimpleIcon weight="bold" />
          )}
          {t(game.installed ? "play" : "installGame")}
        </button>
        <button onClick={() => onToggleFavorite(game)}>
          <HeartIcon weight={favorite ? "fill" : "regular"} />
          {t(favorite ? "removeFavorite" : "addFavorite")}
        </button>
        <button onClick={() => onToggleHidden(game)}>
          {hidden ? <EyeIcon /> : <EyeSlashIcon />}
          {t(hidden ? "restoreGame" : "hideGame")}
        </button>
      </div>
      {!game.installed && (
        <SteamMedia
          key={game.id}
          media={media.data}
          loading={media.isLoading}
          t={t}
          lang={lang}
        />
      )}
      {game.installed && (
        <Uninstall
          key={game.id}
          game={game}
          t={t}
          onUninstalled={onUninstalled}
        />
      )}
    </DetailFrame>
  );
}
