"use client";

import { useCallback, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject } from "react";
import { BANKS, padsInBank } from "../core/pads";
import { selectedPattern } from "../core/project-schema";
import { EMPTY_PAD_ACTION, padDisplayName, padHasSound, padStateClass } from "../core/ux";
import { padKeyLabel } from "../input/pad-input";
import { useBeatLabRuntime } from "./runtime-context";

export function PadGrid({
  onEditPad,
  onPlayedPad,
  padRefs,
  compact = false,
}: {
  onEditPad?: (padId: string, node: HTMLButtonElement | null) => void;
  onPlayedPad?: () => void;
  padRefs?: MutableRefObject<Map<string, HTMLButtonElement>>;
  compact?: boolean;
}) {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const pads = padsInBank(project.pads, project.selectedBank);
  const pattern = selectedPattern(project);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const sounding = new Set(runtime.soundingPadIds());
  const held = new Set(runtime.heldPadIds());

  const on = useCallback((id: string, velocity = 1) => {
    setPressed((current) => new Set(current).add(id));
    runtime.padOn(id, velocity);
    onPlayedPad?.();
  }, [runtime, onPlayedPad]);

  const off = useCallback((id: string) => {
    setPressed((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    runtime.padOff(id);
  }, [runtime]);

  return <section className={`bl-pads${compact ? " compact" : ""}`} aria-label="Pad grid">
    <div className="bl-banks">
      {BANKS.map((bank) => (
        <button
          key={bank}
          type="button"
          className={project.selectedBank === bank ? "active" : ""}
          aria-pressed={project.selectedBank === bank}
          onClick={() => runtime.state.selectBank(bank)}
        >
          Bank {bank}
        </button>
      ))}
      <small className="bl-keyboard-hint">Keyboard enabled</small>
    </div>
    <div className="bl-pad-grid">
      {pads.map((pad, index) => {
        const assigned = padHasSound(pad);
        const missing = pad.assetId ? project.assets.find((asset) => asset.id === pad.assetId)?.missing : false;
        const hasEvents = pattern.events.some((event) => event.padId === pad.id);
        const keyLabel = padKeyLabel(index);
        const name = padDisplayName(pad);
        const isPressed = pressed.has(pad.id) || held.has(pad.id);
        const stateClass = padStateClass({
          empty: !assigned,
          selected: project.selectedPadId === pad.id,
          pressed: isPressed,
          sounding: sounding.has(pad.id),
          muted: pad.mute,
          soloed: pad.solo,
          choked: runtime.chokedPadId === pad.id,
          hasEvents,
          missing: Boolean(missing),
        });
        return <div key={pad.id} className="bl-pad-cell">
          <button
            ref={(node) => {
              if (!padRefs) return;
              if (node) padRefs.current.set(pad.id, node);
              else padRefs.current.delete(pad.id);
            }}
            type="button"
            className={stateClass}
            style={{ "--pad-color": pad.color } as CSSProperties}
            aria-label={`${name}, ${pad.id}, shortcut ${keyLabel}${assigned ? "" : ", empty"}${hasEvents ? ", has recorded events" : ""}${pad.mute ? ", muted" : ""}${pad.solo ? ", solo" : ""}`}
            aria-keyshortcuts={keyLabel}
            aria-pressed={isPressed}
            aria-current={project.selectedPadId === pad.id ? "true" : undefined}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest(".bl-pad-edit")) return;
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
            onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }}
            onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove("drop-target");
              const files = Array.from(event.dataTransfer?.files || []);
              if (files.length) void runtime.importFiles(files, pad.id);
            }}
          >
            <kbd className="bl-pad-key" aria-label={`Keyboard shortcut ${keyLabel}.`}>{keyLabel}</kbd>
            <small>{pad.id}</small>
            <strong>{name}</strong>
            <span className="bl-pad-meta">
              {assigned ? (missing ? "Missing sample" : pad.starterKey ? "Starter" : "Sample") : EMPTY_PAD_ACTION}
              {hasEvents ? " · Events" : ""}
              {pad.mute ? " · Mute" : ""}
              {pad.solo ? " · Solo" : ""}
              {sounding.has(pad.id) ? " · Playing" : ""}
              {runtime.chokedPadId === pad.id ? " · Choke" : ""}
            </span>
          </button>
          {onEditPad && <button
            type="button"
            className="bl-pad-edit"
            aria-label={`Edit ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              runtime.state.selectPad(pad.id);
              onEditPad(pad.id, padRefs?.current.get(pad.id) || null);
            }}
          >Edit</button>}
        </div>;
      })}
    </div>
  </section>;
}
