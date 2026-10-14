import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { CoverImage } from "../components/Cover";
import type { Translate } from "../i18n";
import { formatSize, type Game } from "../library";

export type Download = {
  game: Game;
  downloaded: number;
  total: number;
  percent: number;
};

/** Steam-style downloads strip: every install Sofa requested, with its bar and bytes. */
export function Downloads({
  t,
  downloads,
}: {
  t: Translate;
  downloads: Download[];
}) {
  if (!downloads.length) return null;
  return (
    <section className="downloads" aria-label={t("downloads")}>
      <h2>
        <DownloadSimpleIcon weight="bold" />
        {t("downloads")}
      </h2>
      <ul>
        {downloads.map((d) => (
          <li key={d.game.id}>
            <span className="download-cover" aria-hidden>
              <CoverImage game={d.game} />
            </span>
            <span className="download-copy">
              <strong>{d.game.title}</strong>
              <small>
                {t("downloadOf", {
                  done: formatSize(d.downloaded),
                  total: formatSize(d.total),
                })}{" "}
                · {d.percent}%
              </small>
              <span
                className="download-bar"
                role="progressbar"
                aria-valuenow={d.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={d.game.title}
              >
                <span style={{ width: `${d.percent}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
