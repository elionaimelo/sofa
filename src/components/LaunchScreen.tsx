import { GameControllerIcon } from "@phosphor-icons/react";
import type { Translate } from "../i18n";
import { type Game, hero } from "../library";

/**
 * Shown while a launcher starts the game: the game's art behind a controller that rumbles.
 * Dismissed by App when the game takes focus, after a timeout, or with B.
 */
export function LaunchScreen({ game, t }: { game: Game; t: Translate }) {
  const art = hero(game);
  return (
    <div className="launch-screen" role="status">
      {art && (
        <div
          className="launch-art"
          style={{ backgroundImage: `url("${art}")` }}
        />
      )}
      <div className="launch-content">
        <span className="launch-icon">
          <GameControllerIcon weight="duotone" />
        </span>
        <h2>{game.title}</h2>
        <p>{t("launching", { title: game.title })}</p>
      </div>
    </div>
  );
}
