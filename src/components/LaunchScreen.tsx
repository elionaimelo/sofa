import type { Translate } from "../i18n";
import { type Game, hero } from "../library";
import { SofaIcon } from "./SofaIcon";

/**
 * Shown while a launcher starts the game: the game's art behind the Sofa icon that rumbles.
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
          <SofaIcon size={96} />
        </span>
        <h2>{game.title}</h2>
        <p>{t("launching", { title: game.title })}</p>
      </div>
    </div>
  );
}
