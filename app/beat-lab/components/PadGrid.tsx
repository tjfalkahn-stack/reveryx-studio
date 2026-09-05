"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { BANKS, padsInBank } from "../core/pads";
import { keyToPadIndex, isTypingTarget } from "../input/pad-input";
import { useBeatLabRuntime } from "./runtime-context";

export function PadGrid() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const pads = padsInBank(project.pads, project.selectedBank);
  const [pressed, setPressed] = useState<Set<string>>(new Set());

  const on = useCallback((id: string, velocity = 1) => {
    setPressed((current) => new Set(current).add(id));
    runtime.padOn(id, velocity);
  }, [runtime]);

  const off = useCallback((id: string) => {
    setPressed((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    runtime.padOff(id);
  }, [runtime]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      const index = keyToPadIndex(event.key);
      if (index == null) return;
      event.preventDefault();
      const pad = padsInBank(runtime.state.project.pads, runtime.state.project.selectedBank)[index];
      if (pad) on(pad.id);
    };
    const up = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const index = keyToPadIndex(event.key);
      if (index == null) return;
      const pad = padsInBank(runtime.state.project.pads, runtime.state.project.selectedBank)[index];
      if (pad) off(pad.id);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [on, off, runtime]);

  return <section className="bl-pads" aria-label="Pad grid">
    <div className="bl-banks">
      {BANKS.map((bank) => (
        <button key={bank} type="button" className={project.selectedBank === bank ? "active" : ""} onClick={() => runtime.state.selectBank(bank)}>Bank {bank}</button>
      ))}
    </div>
    <div className="bl-pad-grid">
      {pads.map((pad) => {
        const assigned = Boolean(pad.assetId || pad.starterKey);
        const missing = pad.assetId ? project.assets.find((asset) => asset.id === pad.assetId)?.missing : false;
        return <button
          key={pad.id}
          type="button"
          className={`bl-pad ${project.selectedPadId === pad.id ? "selected" : ""} ${pressed.has(pad.id) ? "pressed" : ""} ${pad.mute ? "muted" : ""} ${pad.solo ? "solo" : ""} ${missing ? "missing" : ""}`}
          style={{ "--pad-color": pad.color } as CSSProperties}
          aria-label={`${pad.name}${assigned ? "" : " empty"}`}
          onPointerDown={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
            runtime.state.selectPad(pad.id);
            void runtime.ensureContext();
            on(pad.id, event.pressure > 0.1 ? event.pressure : 1);
          }}
          onPointerUp={() => off(pad.id)}
          onPointerCancel={() => off(pad.id)}
          onPointerLeave={(event) => { if (event.buttons) off(pad.id); }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <small>{pad.id}</small>
          <strong>{pad.name}</strong>
          <span>{assigned ? (missing ? "Missing sample" : pad.starterKey ? "Starter" : "Sample") : "Empty"}</span>
        </button>;
      })}
    </div>
    <p className="bl-pad-help">Computer keys 1-4, Q-R, A-F, Z-V play this bank. Keys are ignored while typing in a field.</p>
  </section>;
}
