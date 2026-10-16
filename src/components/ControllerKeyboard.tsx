import {
  ArrowFatUpIcon,
  BackspaceIcon,
  CheckIcon,
  KeyboardIcon,
  RectangleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { initialLang, translator } from "../i18n";
import { keyboardInput, navigateSpatial, useFeatureInput } from "../services";
import { Dialog } from "./Dialog";

const letters = Array.from("1234567890qwertyuiopasdfghjklçzxcvbnmñ'-");
const symbols = Array.from('áéíóúàâêôãõü!?@#&+=()[]{}<>:;/\\.,_%€$*"');

function Keyboard({
  target,
  onClose,
}: {
  target: HTMLInputElement;
  onClose: () => void;
}) {
  const t = translator(initialLang());
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef({
    start: target.selectionStart ?? target.value.length,
    end: target.selectionEnd ?? target.value.length,
  });
  const [value, setValue] = useState(target.value);
  const [upper, setUpper] = useState(false);
  const [alternate, setAlternate] = useState(false);
  const write = (text: string | null) => {
    if (!target.isConnected) {
      onClose();
      return;
    }
    let { start, end } = caret.current;
    if (text === null && start === end)
      start = Math.max(
        0,
        start - (Array.from(value.slice(0, start)).pop()?.length ?? 0),
      );
    const room =
      target.maxLength < 0
        ? Number.POSITIVE_INFINITY
        : Math.max(0, target.maxLength - value.length + end - start);
    const inserted = (text ?? "").slice(0, room);
    const next = value.slice(0, start) + inserted + value.slice(end);
    const position = start + inserted.length;
    // Use the native setter so React's controlled field receives the same input event as typing.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(target, next);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.setSelectionRange(position, position);
    caret.current = { start: position, end: position };
    setValue(next);
  };
  const switchKeys = () => {
    root.current?.querySelector<HTMLElement>("[data-keyboard-mode]")?.focus();
    setAlternate((mode) => !mode);
  };
  useFeatureInput(keyboardInput, (action) => {
    if (action === "b") onClose();
    else if (action === "x") write(null);
    else if (action === "y") write(" ");
    else if (action === "lb") setUpper((state) => !state);
    else if (action === "rb") switchKeys();
    else navigateSpatial(action, root.current?.closest("dialog") ?? null);
  });
  return (
    <Dialog label={t("keyboardTitle")} onClose={onClose}>
      <div className="controller-keyboard" ref={root}>
        <h2>
          {target.getAttribute("aria-label") ||
            target.labels?.[0]?.textContent ||
            t("keyboardTitle")}
        </h2>
        <div className="keyboard-value" aria-live="polite">
          <span>{value.slice(0, caret.current.start)}</span>
          <span className="keyboard-caret" />
          <span>{value.slice(caret.current.end)}</span>
        </div>
        <div className="keyboard-keys">
          {(alternate ? symbols : letters).map((key, i) => (
            <button
              key={key}
              data-key={key}
              data-initial-focus={i === 0 || undefined}
              onClick={() => write(upper ? key.toUpperCase() : key)}
            >
              {upper ? key.toUpperCase() : key}
            </button>
          ))}
        </div>
        <div className="keyboard-actions">
          <button
            aria-label={t("keyboardShift")}
            aria-pressed={upper}
            onClick={() => setUpper((state) => !state)}
          >
            <ArrowFatUpIcon />
          </button>
          <button data-keyboard-mode onClick={switchKeys}>
            <KeyboardIcon />
            {t(alternate ? "keyboardLetters" : "keyboardSymbols")}
          </button>
          <button onClick={() => write(" ")}>
            <RectangleIcon />
            {t("keyboardSpace")}
          </button>
          <button aria-label={t("keyboardErase")} onClick={() => write(null)}>
            <BackspaceIcon />
          </button>
          <button className="accent" onClick={onClose}>
            <CheckIcon />
            {t("keyboardDone")}
          </button>
        </div>
      </div>
      <div className="dialog-footer keyboard-hints">
        <span>
          <kbd>X</kbd> {t("keyboardErase")}
        </span>
        <span>
          <kbd>Y</kbd> {t("keyboardSpace")}
        </span>
        <span>
          <kbd>B</kbd> {t("close")}
        </span>
      </div>
    </Dialog>
  );
}

/** Shared by the launcher and HUD, including game search and category filters. */
export function ControllerKeyboard() {
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const input = (event as CustomEvent<unknown>).detail;
      if (
        input instanceof HTMLInputElement &&
        !input.disabled &&
        !input.readOnly
      )
        setTarget(input);
    };
    window.addEventListener("sofa-text-entry", open);
    return () => window.removeEventListener("sofa-text-entry", open);
  }, []);
  return target && <Keyboard target={target} onClose={() => setTarget(null)} />;
}
