// The sofa alone, no tile behind it (the app icon keeps its tile for the OS).
import sofaIcon from "../assets/sofa.svg";

export function SofaIcon({
  size = 44,
  dragRegion,
}: {
  size?: number;
  dragRegion?: boolean;
}) {
  return (
    <img
      className="sofa-icon"
      src={sofaIcon}
      alt=""
      width={size}
      height={size}
      draggable={false}
      data-tauri-drag-region={dragRegion || undefined}
    />
  );
}
