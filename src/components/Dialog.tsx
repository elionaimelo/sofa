import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * The status line and button hints, drawn inside every open dialog: a modal dialog covers
 * the app's footer, so its messages and hints would go unseen there.
 */
export const DialogFooter = createContext<ReactNode>(null);

/**
 * React removes a closed dialog at once, so an inert copy plays the exit: it fades (and,
 * unless reduced motion is on, sinks a little) over a fading shade, then goes away.
 */
function fadeOut(dialog: HTMLDialogElement) {
  const rect = dialog.getBoundingClientRect();
  const ghost = dialog.cloneNode(true) as HTMLDialogElement;
  ghost.inert = true;
  ghost.removeAttribute("aria-label");
  ghost.classList.add("dialog-ghost");
  // A playing trailer would start downloading again in the copy; its poster is enough.
  for (const video of ghost.querySelectorAll("video"))
    video.removeAttribute("src");
  Object.assign(ghost.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const shade = document.createElement("div");
  shade.className = "dialog-ghost-shade";
  // Scrolled panels keep their position in the copy, so nothing jumps while it fades.
  const scrolled = [...dialog.querySelectorAll("*")].flatMap((el, i) =>
    el.scrollTop ? [[i, el.scrollTop] as const] : [],
  );
  // Only a dialog React really removed plays the exit (StrictMode's rehearsal keeps it).
  queueMicrotask(() => {
    if (dialog.isConnected) return;
    document.body.append(shade, ghost);
    const copies = ghost.querySelectorAll("*");
    for (const [i, top] of scrolled) copies[i].scrollTop = top;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timing = {
      duration: 170,
      easing: "ease-in",
      fill: "forwards",
    } as const;
    void Promise.all([
      ghost.animate(
        still
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: "translateY(12px) scale(0.97)" },
            ],
        timing,
      ).finished,
      shade.animate([{ opacity: 1 }, { opacity: 0 }], timing).finished,
    ]).finally(() => {
      ghost.remove();
      shade.remove();
    });
  });
}

/** First focus when a dialog opens: its `data-initial-focus`, else anything but a close X. */
const firstFocus =
  "[data-initial-focus], :is(button, input, select, [tabindex='0']):not(:disabled):not(.close):not(.settings-head button)";

export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const footer = use(DialogFooter);
  // Runs before React detaches the dialog, while it is still open and on screen.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) fadeOut(dialog);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>(firstFocus)?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only closes on the backdrop; Escape fires the dialog's cancel event.
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      {children}
      {footer}
    </dialog>
  );
}
