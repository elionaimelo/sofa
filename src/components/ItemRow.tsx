import type { ReactNode } from "react";

/** One row of a settings list: a name on the left, its actions on the right. */
export function ItemRow({
  name,
  children,
}: {
  name: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <span>{name}</span>
      <span className="detail-actions">{children}</span>
    </li>
  );
}
