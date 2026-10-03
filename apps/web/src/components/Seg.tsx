import { useRef } from "react";
import type { KeyboardEvent } from "react";

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  const radioGroupRef = useRef<HTMLDivElement>(null);

  const selectOptionFromKey = (keyboardEvent: KeyboardEvent<HTMLButtonElement>, optionIndex: number) => {
    const nextOptionIndex = getOptionIndexForKey(keyboardEvent.key, optionIndex, options.length);

    if (nextOptionIndex === null) return;

    keyboardEvent.preventDefault();

    const nextOption = options[nextOptionIndex];

    if (!nextOption) return;

    onChange(nextOption[0]);
    radioGroupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextOptionIndex]?.focus();
  };

  return (
    <div ref={radioGroupRef} className="seg" role="radiogroup" aria-label={label}>
      {options.map(([optionValue, optionLabel], optionIndex) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-checked={value === optionValue}
          tabIndex={value === optionValue ? 0 : -1}
          onClick={() => onChange(optionValue)}
          onKeyDown={(keyboardEvent) => selectOptionFromKey(keyboardEvent, optionIndex)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function getOptionIndexForKey(key: string, optionIndex: number, optionCount: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (optionIndex + 1) % optionCount;
    case "ArrowLeft":
    case "ArrowUp":
      return (optionIndex - 1 + optionCount) % optionCount;
    case "Home":
      return 0;
    case "End":
      return optionCount - 1;
    default:
      return null;
  }
}
