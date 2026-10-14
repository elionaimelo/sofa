import sofaIcon from "../../src-tauri/icons/128x128@2x.png";

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
