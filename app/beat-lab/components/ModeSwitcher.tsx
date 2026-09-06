"use client";

import { BEAT_LAB_MODES, BEAT_LAB_MODE_LABEL, type BeatLabMode } from "../core/ux";

export function ModeSwitcher({ mode, onMode }: { mode: BeatLabMode; onMode: (mode: BeatLabMode) => void }) {
  return <nav className="bl-modes" aria-label="Beat Lab modes">
    {BEAT_LAB_MODES.map((item) => (
      <button
        key={item}
        type="button"
        className={mode === item ? "active" : ""}
        aria-current={mode === item ? "page" : undefined}
        onClick={() => onMode(item)}
      >
        {BEAT_LAB_MODE_LABEL[item]}
      </button>
    ))}
  </nav>;
}
