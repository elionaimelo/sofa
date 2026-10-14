import { CheckIcon } from "@phosphor-icons/react";
import { Dialog } from "../components/Dialog";
import { SofaIcon } from "../components/SofaIcon";
import type { Translate } from "../i18n";
import { providers, type useLibrary } from "../useLibrary";
import { AccountSection } from "./Settings";

/**
 * First run with nothing found on the device: offer the store accounts, which bring in owned
 * games too. Shown once; Continue or B dismisses it for good (Settings → Library has the same
 * cards).
 */
export function Onboarding({
  t,
  library,
  onDone,
}: {
  t: Translate;
  library: ReturnType<typeof useLibrary>;
  onDone: () => void;
}) {
  return (
    <Dialog label={t("onboardingTitle")} onClose={onDone}>
      <div className="onboarding">
        <SofaIcon size={64} />
        <h1>{t("onboardingTitle")}</h1>
        <p className="muted">{t("onboardingNoGames")}</p>
        <div className="library-accounts">
          {providers.map((provider) => (
            <AccountSection
              key={provider}
              t={t}
              provider={provider}
              account={library.accounts[provider]}
            />
          ))}
        </div>
        <div className="detail-actions">
          <button className="accent" onClick={onDone}>
            <CheckIcon weight="bold" />
            {t("onboardingContinue")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
