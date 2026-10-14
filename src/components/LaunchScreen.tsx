import type { Translate } from "../i18n";
import { type Game, hero } from "../library";
import { SofaLoadingIcon } from "./SofaLoadingIcon";

/**
 * Shown while a launcher starts the game: the game's art behind the animated Sofa.
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
          <SofaLoadingIcon size={96} />
        </span>
        <h2>{game.title}</h2>
        <p>{t("launchingGame")}</p>
      </div>
    </div>
  );
}
