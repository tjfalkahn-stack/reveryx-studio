"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { selectedPad } from "../core/project-schema";
import { padsInBank } from "../core/pads";
import { formatCents, formatPan, formatSeconds, formatVolume, PAD_VALUE_DEFAULTS } from "../core/ux";
import { ToggleButton } from "./ToggleButton";
import { useBeatLabRuntime } from "./runtime-context";

function ValueRow({
  label,
  value,
  unit,
  children,
  onReset,
}: {
  label: string;
  value: string;
  unit?: string;
  children: ReactNode;
  onReset?: () => void;
}) {
  return <label className="bl-value-row">
    <span>{label}</span>
    {children}
    <b>{value}{unit ? ` ${unit}` : ""}</b>
    {onReset && <button type="button" className="bl-reset" onClick={(event) => { event.preventDefault(); onReset(); }} aria-label={`Reset ${label}`}>Reset</button>}
  </label>;
}

export function PadEditor() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const pad = selectedPad(project);
  const bankPads = padsInBank(project.pads, pad.bank);
  const duration = runtime.padBuffer(pad)?.duration || Math.max(pad.end, 1);

  return <section className="bl-pad-editor" aria-label="Selected pad">
    <header>
      <small>Selected pad {pad.id}</small>
      <input value={pad.name} onChange={(event) => runtime.state.patchPad(pad.id, { name: event.target.value.slice(0, 24) }, "Pad name")} aria-label="Pad name" />
    </header>
    <label>Color
      <input type="color" value={pad.color} onChange={(event) => runtime.state.patchPad(pad.id, { color: event.target.value }, "Pad color")} />
    </label>
    <ValueRow label="Volume" value={formatVolume(pad.volume)} onReset={() => runtime.state.patchPad(pad.id, { volume: PAD_VALUE_DEFAULTS.volume }, "Reset volume")}>
      <input type="range" min={0} max={100} value={Math.round(pad.volume * 100)} onChange={(event) => runtime.state.patchPad(pad.id, { volume: Number(event.target.value) / 100 }, "Volume")} aria-valuetext={formatVolume(pad.volume)} />
    </ValueRow>
    <ValueRow label="Pan" value={formatPan(pad.pan)} onReset={() => runtime.state.patchPad(pad.id, { pan: PAD_VALUE_DEFAULTS.pan }, "Reset pan")}>
      <input type="range" min={-100} max={100} value={Math.round(pad.pan * 100)} onChange={(event) => runtime.state.patchPad(pad.id, { pan: Number(event.target.value) / 100 }, "Pan")} aria-valuetext={formatPan(pad.pan)} />
    </ValueRow>
    <ValueRow label="Pitch" value={formatCents(pad.pitchCents)} onReset={() => runtime.state.patchPad(pad.id, { pitchCents: PAD_VALUE_DEFAULTS.pitchCents }, "Reset pitch")}>
      <input type="range" min={-1200} max={1200} step={10} value={pad.pitchCents} onChange={(event) => runtime.state.patchPad(pad.id, { pitchCents: Number(event.target.value) }, "Pitch")} aria-valuetext={formatCents(pad.pitchCents)} />
    </ValueRow>
    <p className="bl-kit-note">Pitch resampling also changes duration. Independent time-stretch is not in V1.</p>
    <ValueRow label="Start" value={formatSeconds(pad.start)}>
      <input type="range" min={0} max={duration} step={0.001} value={pad.start} onChange={(event) => runtime.state.patchPad(pad.id, { start: Number(event.target.value) }, "Start")} aria-valuetext={formatSeconds(pad.start)} />
    </ValueRow>
    <ValueRow label="End" value={formatSeconds(pad.end)}>
      <input type="range" min={0} max={duration} step={0.001} value={pad.end} onChange={(event) => runtime.state.patchPad(pad.id, { end: Number(event.target.value) }, "End")} aria-valuetext={formatSeconds(pad.end)} />
    </ValueRow>
    <ValueRow label="Attack" value={formatSeconds(pad.attack)} onReset={() => runtime.state.patchPad(pad.id, { attack: PAD_VALUE_DEFAULTS.attack }, "Reset attack")}>
      <input type="range" min={0} max={0.4} step={0.001} value={pad.attack} onChange={(event) => runtime.state.patchPad(pad.id, { attack: Number(event.target.value) }, "Attack")} aria-valuetext={formatSeconds(pad.attack)} />
    </ValueRow>
    <ValueRow label="Release" value={formatSeconds(pad.release)} onReset={() => runtime.state.patchPad(pad.id, { release: PAD_VALUE_DEFAULTS.release }, "Reset release")}>
      <input type="range" min={0} max={1} step={0.001} value={pad.release} onChange={(event) => runtime.state.patchPad(pad.id, { release: Number(event.target.value) }, "Release")} aria-valuetext={formatSeconds(pad.release)} />
    </ValueRow>
    <div className="bl-seg" role="group" aria-label="Play mode">
      <button type="button" className={pad.playMode === "one-shot" ? "active" : ""} aria-pressed={pad.playMode === "one-shot"} onClick={() => runtime.state.patchPad(pad.id, { playMode: "one-shot" }, "One-shot")}>One-shot</button>
      <button type="button" className={pad.playMode === "gate" ? "active" : ""} aria-pressed={pad.playMode === "gate"} onClick={() => runtime.state.patchPad(pad.id, { playMode: "gate" }, "Gate")}>Gate</button>
    </div>
    <ToggleButton pressed={pad.reverse} onPressedChange={(next) => runtime.state.patchPad(pad.id, { reverse: next }, "Reverse")}>Reverse</ToggleButton>
    <ToggleButton pressed={pad.mute} onPressedChange={() => runtime.state.togglePadMute(pad.id)}>Mute</ToggleButton>
    <ToggleButton pressed={pad.solo} onPressedChange={() => runtime.state.togglePadSolo(pad.id)}>Solo</ToggleButton>
    <label>Choke group
      <select value={pad.chokeGroup ?? 0} onChange={(event) => runtime.state.patchPad(pad.id, { chokeGroup: Number(event.target.value) || null }, "Choke")}>
        <option value={0}>Off</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((group) => <option key={group} value={group}>{group}</option>)}
      </select>
    </label>
    <label>Stem
      <select value={pad.stemBus} onChange={(event) => runtime.state.patchPad(pad.id, { stemBus: event.target.value as typeof pad.stemBus }, "Stem")}>
        <option value="drums">Drums</option>
        <option value="sample">Sample</option>
        <option value="bass">Bass</option>
        <option value="instrument">Instrument</option>
      </select>
    </label>
    <div className="bl-pad-actions">
      <button type="button" onClick={() => runtime.state.resetSelectedPadValues()}>Reset mix</button>
      <label>Duplicate to
        <select defaultValue="" onChange={(event) => { if (event.target.value) runtime.state.duplicateSelectedPadTo(event.target.value); event.target.value = ""; }}>
          <option value="">Choose pad</option>
          {bankPads.filter((item) => item.id !== pad.id).map((item) => <option key={item.id} value={item.id}>{item.id} {item.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => runtime.state.clearSelectedPad()}>Clear</button>
    </div>
  </section>;
}
