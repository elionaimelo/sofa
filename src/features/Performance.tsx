import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CpuIcon,
  MemoryIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Translate } from "../i18n";
import {
  desktop,
  navigateControls,
  serviceError,
  useFeatureInput,
  type InputRef,
} from "../services";
import { useInput } from "../useInput";
import { BatteryPanels, type PowerStatus } from "./Power";
import { initialLang, translator } from "../i18n";
type Metrics = {
  cpu: number | null;
  used_memory: number;
  total_memory: number;
};
function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      try {
        const value = await desktop<Metrics>("system_metrics");
        if (alive) {
          setMetrics(value);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setMetrics(null);
          setError(
            String(e) === "desktopRequired"
              ? "desktopRequired"
              : serviceError(e),
          );
        }
      }
      if (alive) timer = setTimeout(() => void sample(), 2000);
    };
    void sample();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return { metrics, error };
}
function Readings({ t, metrics }: { t: Translate; metrics: Metrics | null }) {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  return (
    <div className="metric-grid">
      <article>
        <CpuIcon size={24} />
        <span>{t("cpuUsage")}</span>
        <strong>
          {metrics?.cpu != null ? `${metrics.cpu.toFixed(0)}%` : "—"}
        </strong>
        <p>{metrics?.cpu == null ? t("sampling") : "CPU"}</p>
      </article>
      <article>
        <MemoryIcon size={24} />
        <span>{t("memory")}</span>
        <strong>
          {metrics ? gb(metrics.used_memory) : "—"}
          <small> GB</small>
        </strong>
        <p>
          {metrics
            ? t("ofMemory", { total: gb(metrics.total_memory) })
            : t("sampling")}
        </p>
      </article>
    </div>
  );
}
export function Performance({
  t,
  input,
  onBack,
  power,
  powerError,
}: {
  t: Translate;
  input: InputRef;
  onBack: () => void;
  power: PowerStatus | null;
  powerError: string;
}) {
  const { metrics, error } = useMetrics();
  const [status, setStatus] = useState("");
  const root = useRef<HTMLElement>(null);
  useFeatureInput(input, (a) => {
    if (a === "b") {
      onBack();
      return;
    }
    navigateControls(a, root.current);
  });
  return (
    <section
      className="feature-page performance-page"
      ref={root}
      id="content"
      tabIndex={-1}
    >
      <div className="feature-heading">
        <div>
          <p className="eyebrow">{t("hud")}</p>
          <h1>{t("performanceIntro")}</h1>
          <p className="feature-description">{t("hudNote")}</p>
        </div>
        <button
          className="accent"
          onClick={() => {
            void desktop("open_hud").catch((e) =>
              setStatus(
                t(
                  String(e) === "desktopRequired"
                    ? "desktopRequired"
                    : (serviceError(e) as Parameters<Translate>[0]),
                ),
              ),
            );
          }}
        >
          <SquaresFourIcon />
          {t("openHud")}
        </button>
      </div>
      <Readings t={t} metrics={metrics} />
      <BatteryPanels t={t} data={power} error={powerError} />
      <p className="inline-note">{t("hardwareScope")}</p>
      {error && (
        <p className="inline-error" role="alert">
          {t(error as Parameters<Translate>[0])}
        </p>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
export function Hud() {
  const t = translator(initialLang());
  const { metrics, error } = useMetrics();
  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };
  useInput((a) => {
    if (a === "b") close();
  });
  return (
    <main className="floating-hud">
      <header data-tauri-drag-region>
        <span data-tauri-drag-region>Sofa HUD</span>
        <button onClick={close} aria-label={t("close")}>
          <XIcon />
        </button>
      </header>
      <Readings t={t} metrics={metrics} />
      {error && <p role="alert">{t(error as Parameters<Translate>[0])}</p>}
    </main>
  );
}
