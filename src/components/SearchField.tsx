import { XIcon } from "@phosphor-icons/react";
import type { InputHTMLAttributes } from "react";
import { keyboardOnActivate } from "../services";

/** A search box with a clear button the controller can reach; the keyboard isn't needed. */
export function SearchField({
  value,
  onClear,
  clearLabel,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  value: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <span className={`search-field${className ? ` ${className}` : ""}`}>
      <input
        {...keyboardOnActivate}
        type="search"
        autoComplete="off"
        value={value}
        {...rest}
      />
      {value && (
        <button
          type="button"
          className="clear-field"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <XIcon />
        </button>
      )}
    </span>
  );
}
