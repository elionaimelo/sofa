import { SofaLoadingIcon } from "./SofaLoadingIcon";

/** Every wait shares the animated Sofa and one line saying what for. */
export function Loading({
  label,
  size = 72,
}: {
  label: string;
  size?: number;
}) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span
        className="launch-icon"
        style={{ width: size * 1.35, height: size * 1.35 }}
      >
        <SofaLoadingIcon size={size} />
      </span>
      <p>{label}</p>
    </div>
  );
}
