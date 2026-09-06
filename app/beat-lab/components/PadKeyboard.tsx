"use client";

import { useEffect } from "react";
import { padsInBank } from "../core/pads";
import { resolvePadKeyDown, resolvePadKeyUp } from "../input/pad-input";
import { useBeatLabRuntime } from "./runtime-context";

export function PadKeyboard({ onPlayedPad }: { onPlayedPad?: () => void }) {
  const runtime = useBeatLabRuntime();

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const action = resolvePadKeyDown(event, runtime.state.project.noteRepeat.enabled);
      if (!action) return;
      event.preventDefault();
      const pad = padsInBank(runtime.state.project.pads, runtime.state.project.selectedBank)[action.padIndex];
      if (!pad) return;
      void runtime.ensureContext();
      runtime.padOn(pad.id);
      onPlayedPad?.();
    };
    const up = (event: KeyboardEvent) => {
      const action = resolvePadKeyUp(event);
      if (!action) return;
      const pad = padsInBank(runtime.state.project.pads, runtime.state.project.selectedBank)[action.padIndex];
      if (pad) runtime.padOff(pad.id);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [runtime, onPlayedPad]);

  return null;
}
