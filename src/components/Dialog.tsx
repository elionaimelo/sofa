import { createContext, type ReactNode, use, useEffect, useRef } from "react";

/**
 * The status line and button hints, drawn inside every open dialog: a modal dialog covers
 * the app's footer, so its messages and hints would go unseen there.
 */
export const DialogFooter = createContext<ReactNode>(null);

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
