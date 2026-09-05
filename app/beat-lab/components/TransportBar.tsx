"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { COUNT_IN_OPTIONS, QUANTIZE_OPTIONS } from "../core/timing";
import { useBeatLabRuntime } from "./runtime-context";

export function TransportBar({ onRecordToBeat }: { onRecordToBeat: () => void }) {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const playhead = useSyncExternalStore(runtime.subscribePlayhead, () => runtime.playheadVersion, () => 0);
  void playhead;
  const clock = runtime.barBeat();
  const saveLabel = runtime.saveStatus === "saved" ? "Saved" : runtime.saveStatus === "saving" ? "Saving" : runtime.saveStatus === "error" ? "Save failed" : "Unsaved";

  return <section className="bl-transport" aria-label="Beat Lab transport">
    <div className="bl-clock" aria-live="polite">
      <small>BAR / BEAT</small>
      <strong>{clock.text}</strong>
      <span>{project.bpm} BPM · 4/4</span>
    </div>
    <div className="bl-transport-controls">
      <button type="button" onClick={() => runtime.returnToStart()} aria-label="Return to start">Return</button>
      <button type="button" className={runtime.playing ? "active" : ""} onClick={() => runtime.playing ? runtime.pause() : void runtime.play(0, runtime.playMode)} aria-label={runtime.playing ? "Pause" : "Play"}>{runtime.playing ? "Pause" : "Play"}</button>
      <button type="button" onClick={() => runtime.stop()} aria-label="Stop">Stop</button>
      <button type="button" className={runtime.recording ? "record active" : "record"} onClick={() => { if (!runtime.playing) void runtime.play(); runtime.toggleRecording(); }}>{runtime.recording ? "Recording" : "Record"}</button>
      <button type="button" className={runtime.erase ? "active" : ""} onClick={() => runtime.toggleErase()} aria-pressed={runtime.erase}>Erase</button>
    </div>
    <label className="bl-bpm">
      <span>BPM</span>
      <input type="number" min={40} max={300} value={project.bpm} onChange={(event) => runtime.state.setBpm(Number(event.target.value))} />
    </label>
    <label className="bl-toggle">
      <input type="checkbox" checked={project.metronome} onChange={(event) => runtime.state.setMetronome(event.target.checked)} />
      Metronome
    </label>
    <label>
      <span>Count-in</span>
      <select value={project.countInBars} onChange={(event) => runtime.state.setCountIn(Number(event.target.value) as 1 | 2 | 4)}>
        {COUNT_IN_OPTIONS.map((bars) => <option key={bars} value={bars}>{bars} bar</option>)}
      </select>
    </label>
    <label>
      <span>Quantize</span>
      <select value={project.quantize} onChange={(event) => runtime.state.setQuantize(event.target.value as typeof project.quantize)}>
        {QUANTIZE_OPTIONS.map((grid) => <option key={grid} value={grid}>{grid}</option>)}
      </select>
    </label>
    <label className="bl-swing">
      <span>Swing {Math.round(project.swing * 100)}%</span>
      <input type="range" min={0} max={100} value={Math.round(project.swing * 100)} onChange={(event) => runtime.state.setSwing(Number(event.target.value) / 100)} />
    </label>
    <label className="bl-toggle">
      <input type="checkbox" checked={project.noteRepeat.enabled} onChange={(event) => runtime.state.setNoteRepeat(event.target.checked)} />
      Note Repeat
    </label>
    <label className="bl-toggle">
      <input type="checkbox" checked={project.looping} onChange={(event) => runtime.state.setLooping(event.target.checked)} />
      Loop
    </label>
    <div className="bl-save"><i className={runtime.saveStatus} /><span>{saveLabel}</span></div>
    <button type="button" className="bl-record-beat" onClick={onRecordToBeat}>Record to this beat</button>
  </section>;
}

export function PlayheadLane({ lengthSeconds }: { lengthSeconds: number }) {
  const runtime = useBeatLabRuntime();
  const [, setTick] = useState(0);
  useEffect(() => runtime.subscribePlayhead(() => setTick((value) => value + 1)), [runtime]);
  const seconds = runtime.playheadSeconds();
  const left = lengthSeconds > 0 ? Math.min(100, Math.max(0, (seconds / lengthSeconds) * 100)) : 0;
  return <span className="bl-playhead" style={{ left: `${left}%` }} aria-hidden="true" />;
}
