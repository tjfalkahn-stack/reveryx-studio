"use client";

import { useSyncExternalStore } from "react";
import { selectedPad } from "../core/project-schema";
import { padsInBank } from "../core/pads";
import { useBeatLabRuntime } from "./runtime-context";

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
    <label>Volume
      <input type="range" min={0} max={100} value={Math.round(pad.volume * 100)} onChange={(event) => runtime.state.patchPad(pad.id, { volume: Number(event.target.value) / 100 }, "Volume")} />
    </label>
    <label>Pan
      <input type="range" min={-100} max={100} value={Math.round(pad.pan * 100)} onChange={(event) => runtime.state.patchPad(pad.id, { pan: Number(event.target.value) / 100 }, "Pan")} />
    </label>
    <label>Pitch (cents)
      <input type="range" min={-1200} max={1200} step={10} value={pad.pitchCents} onChange={(event) => runtime.state.patchPad(pad.id, { pitchCents: Number(event.target.value) }, "Pitch")} />
      <small>Pitch resampling also changes duration. Independent time-stretch is not in V1.</small>
    </label>
    <label>Start
      <input type="range" min={0} max={duration} step={0.001} value={pad.start} onChange={(event) => runtime.state.patchPad(pad.id, { start: Number(event.target.value) }, "Start")} />
    </label>
    <label>End
      <input type="range" min={0} max={duration} step={0.001} value={pad.end} onChange={(event) => runtime.state.patchPad(pad.id, { end: Number(event.target.value) }, "End")} />
    </label>
    <label>Attack
      <input type="range" min={0} max={0.4} step={0.001} value={pad.attack} onChange={(event) => runtime.state.patchPad(pad.id, { attack: Number(event.target.value) }, "Attack")} />
    </label>
    <label>Release
      <input type="range" min={0} max={1} step={0.001} value={pad.release} onChange={(event) => runtime.state.patchPad(pad.id, { release: Number(event.target.value) }, "Release")} />
    </label>
    <div className="bl-seg">
      <button type="button" className={pad.playMode === "one-shot" ? "active" : ""} onClick={() => runtime.state.patchPad(pad.id, { playMode: "one-shot" }, "One-shot")}>One-shot</button>
      <button type="button" className={pad.playMode === "gate" ? "active" : ""} onClick={() => runtime.state.patchPad(pad.id, { playMode: "gate" }, "Gate")}>Gate</button>
    </div>
    <label className="bl-toggle"><input type="checkbox" checked={pad.reverse} onChange={(event) => runtime.state.patchPad(pad.id, { reverse: event.target.checked }, "Reverse")} /> Reverse</label>
    <label className="bl-toggle"><input type="checkbox" checked={pad.mute} onChange={() => runtime.state.togglePadMute(pad.id)} /> Mute</label>
    <label className="bl-toggle"><input type="checkbox" checked={pad.solo} onChange={() => runtime.state.togglePadSolo(pad.id)} /> Solo</label>
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
      <button type="button" onClick={() => runtime.state.undo()}>Undo</button>
      <button type="button" onClick={() => runtime.state.redo()}>Redo</button>
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
