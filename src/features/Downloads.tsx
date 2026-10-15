import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { CoverImage } from "../components/Cover";
import type { Translate } from "../i18n";
import { formatSize, type Game } from "../library";

type Download = {
  game: Game;
  downloaded?: number;
  total?: number;
  percent?: number;
};

/** Steam-style downloads strip: every install Sofa requested, with its bar and bytes. */
export function Downloads({
  t,
  lang,
  downloads,
  onStopTracking,
}: {
  t: Translate;
  lang: string;
  downloads: Download[];
  onStopTracking: (id: string) => void;
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
                {d.percent == null || d.downloaded == null || d.total == null
                  ? t("waitingForLauncher")
                  : `${t("downloadOf", {
                      done: formatSize(d.downloaded, lang),
                      total: formatSize(d.total, lang),
                    })} · ${d.percent}%`}
              </small>
              {d.percent != null && (
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
              )}
            </span>
            <button
              type="button"
              aria-label={`${t("stopTrackingDownload")}: ${d.game.title}`}
              title={t("stopTrackingDownload")}
              onClick={() => onStopTracking(d.game.id)}
            >
              <XIcon />
              {t("stopTrackingDownload")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
