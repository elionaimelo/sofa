import { XIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { Dialog } from "./Dialog";

/**
 * The fixed-size frame game details and the store comparison share: the art blurred
 * behind, the cover fixed on the left, scrolling content on the right.
 */
export function DetailFrame({
  label,
  art,
  cover,
  closeLabel,
  onClose,
  children,
}: {
  label: string;
  /** Wide art for the blurred background. */
  art: string;
  cover: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog label={label} onClose={onClose}>
      <div
        className="detail-layout"
        style={{ "--art": `url("${art}")` } as CSSProperties}
      >
        <button className="close" onClick={onClose} aria-label={closeLabel}>
          <XIcon />
        </button>
        <div className="detail-cover" aria-hidden>
          {cover}
        </div>
        <div className="detail-body">{children}</div>
      </div>
    </Dialog>
  );
}
