"use client";

import type { ReactNode } from "react";

export function ToggleButton({
  pressed,
  onPressedChange,
  children,
  label,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  children: ReactNode;
  label?: string;
}) {
  return <button
    type="button"
    className={pressed ? "bl-toggle-btn on" : "bl-toggle-btn"}
    aria-pressed={pressed}
    aria-label={label}
    onClick={() => onPressedChange(!pressed)}
  >
    <i aria-hidden="true" />
    <span>{children}</span>
  </button>;
}
