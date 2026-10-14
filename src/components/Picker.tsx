import { CaretDownIcon } from "@phosphor-icons/react";
import { type Ref, useEffect, useRef, useState } from "react";
import { navigateControls, pickerInput, useFeatureInput } from "../services";

export type PickerOption<V extends string> = { value: V; label: string };

/**
 * A choice the controller can make: A opens the list, up/down move, A picks, B closes.
 * Native <select> can't open its list from a gamepad click (no user activation).
 */
export function Picker<V extends string>({
  value,
  options,
  onChange,
  label,
  ref,
}: {
  value: V;
  options: PickerOption<V>[];
  onChange: (value: V) => void;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="picker">
      <button
        ref={(element) => {
          trigger.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current.label}
        <CaretDownIcon aria-hidden />
      </button>
      {open && (
        <PickerList
          value={value}
          options={options}
          label={label}
          onPick={(picked) => {
            onChange(picked);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

function PickerList<V extends string>({
  value,
  options,
  label,
  onPick,
  onClose,
}: {
  value: V;
  options: PickerOption<V>[];
  label: string;
  onPick: (value: V) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
  }, []);
  // While open, the controller talks only to the list (App routes through pickerInput).
  useFeatureInput(pickerInput, (a) => {
    if (a === "b") onClose();
    else navigateControls(a, root.current);
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: a listbox of option buttons; <select> can't open from the controller.
    <div
      ref={root}
      role="listbox"
      aria-label={label}
      className="picker-list"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Also keeps a surrounding <dialog> from treating it as its own cancel.
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
