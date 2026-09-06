"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BeatLabMode } from "../core/ux";
import { COUNT_IN_OPTIONS, QUANTIZE_OPTIONS } from "../core/timing";
import { canRecordToThisBeat, recordToThisBeatDisabledReason, transportStatus } from "../core/ux";
import { ToggleButton } from "./ToggleButton";
import { useBeatLabRuntime } from "./runtime-context";

const RECORD_TO_BEAT_LABEL_DISABLED = "Record to this beat, disabled. Record a pattern first";

export function TransportBar({
  mode,
  onRecordToBeat,
  onArmedRecord,
}: {
  mode: BeatLabMode;
  onRecordToBeat: () => void;
  onArmedRecord?: () => void;
}) {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const playhead = useSyncExternalStore(runtime.subscribePlayhead, () => runtime.playheadVersion, () => 0);
  void playhead;
  const clock = runtime.barBeat();
  const saveLabel = runtime.saveStatus === "saved" ? "Saved" : runtime.saveStatus === "saving" ? "Saving" : runtime.saveStatus === "error" ? "Save failed" : "Unsaved";
  const handoffReady = canRecordToThisBeat(project);
  const handoffReason = recordToThisBeatDisabledReason(project);
  const status = transportStatus({
    playing: runtime.playing,
    recording: runtime.recording,
    overdub: runtime.overdub,
    erase: runtime.erase,
    inCountIn: runtime.inCountIn(),
  });
  const showSequence = mode === "sequence";
  const showHandoff = mode === "arrange" || mode === "play";

  return <section className={`bl-transport sticky mode-${mode}`} aria-label="Beat Lab transport">
    <div className="bl-clock" aria-live="polite">
      <small>BAR / BEAT</small>
      <strong>{clock.text}</strong>
      <span>{project.bpm} BPM · 4/4</span>
    </div>
    <p className="bl-status" role="status">{status}{runtime.inCountIn() ? ` · ${project.countInBars} bar count-in` : ""}</p>
    <div className="bl-transport-controls">
      <button type="button" onClick={() => runtime.returnToStart()} aria-label="Go to start">Go to Start</button>
      <button type="button" className={runtime.playing ? "active" : ""} onClick={() => runtime.playing ? runtime.pause() : void runtime.play(0, runtime.playMode)} aria-label={runtime.playing ? "Pause" : "Play"}>{runtime.playing ? "Pause" : "Play"}</button>
      <button type="button" onClick={() => runtime.stop()} aria-label="Stop">Stop</button>
      <button
        type="button"
        className={runtime.recording ? "record active" : "record-idle"}
        aria-pressed={runtime.recording}
        onClick={() => {
          const arming = !runtime.recording;
          if (arming && !runtime.playing) void runtime.play();
          runtime.toggleRecording();
          if (arming) onArmedRecord?.();
        }}
      >
        {runtime.recording ? "Recording" : "Record"}
      </button>
      <button type="button" className={runtime.overdub ? "overdub on" : "overdub"} aria-pressed={runtime.overdub} onClick={() => runtime.toggleOverdub()}>Overdub</button>
      <button type="button" className={runtime.erase ? "erase armed" : "erase"} aria-pressed={runtime.erase} onClick={() => runtime.toggleErase()}>Erase</button>
    </div>
    <label className="bl-bpm">
      <span>BPM</span>
      <input type="number" min={40} max={300} value={project.bpm} onChange={(event) => runtime.state.setBpm(Number(event.target.value))} />
    </label>
    <ToggleButton pressed={project.metronome} onPressedChange={(next) => runtime.state.setMetronome(next)}>Metronome</ToggleButton>
    <label>
      <span>Count-in</span>
      <select value={project.countInBars} onChange={(event) => runtime.state.setCountIn(Number(event.target.value) as typeof project.countInBars)}>
        {COUNT_IN_OPTIONS.map((bars) => <option key={bars} value={bars}>{bars === 0 ? "Off" : bars === 1 ? "1 bar" : `${bars} bars`}</option>)}
      </select>
    </label>
    {showSequence && <>
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
      <ToggleButton pressed={project.noteRepeat.enabled} onPressedChange={(next) => runtime.state.setNoteRepeat(next)}>Note Repeat</ToggleButton>
    </>}
    <ToggleButton pressed={project.looping} onPressedChange={(next) => runtime.state.setLooping(next)}>Loop</ToggleButton>
    <div className="bl-history">
      <button
        type="button"
        disabled={!runtime.state.canUndo}
        title={runtime.state.canUndo ? `Undo ${runtime.state.undoLabel}` : "Nothing to undo"}
        aria-label={runtime.state.canUndo ? `Undo ${runtime.state.undoLabel}` : "Undo unavailable. Nothing to undo"}
        onClick={() => runtime.state.undo()}
      >Undo</button>
      <button
        type="button"
        disabled={!runtime.state.canRedo}
        title={runtime.state.canRedo ? `Redo ${runtime.state.redoLabel}` : "Nothing to redo"}
        aria-label={runtime.state.canRedo ? `Redo ${runtime.state.redoLabel}` : "Redo unavailable. Nothing to redo"}
        onClick={() => runtime.state.redo()}
      >Redo</button>
      {(!runtime.state.canUndo || !runtime.state.canRedo) && (
        <small className="bl-history-hint">
          {[!runtime.state.canUndo ? "Nothing to undo" : null, !runtime.state.canRedo ? "Nothing to redo" : null].filter(Boolean).join(" · ")}
        </small>
      )}
    </div>
    <div className="bl-save"><i className={runtime.saveStatus} /><span>{saveLabel}</span></div>
    {showHandoff && <button
      type="button"
      className="bl-record-beat"
      disabled={!handoffReady}
      title={handoffReason || "Render this arrangement into the vocal recorder"}
      aria-label={handoffReady ? "Record to this beat" : RECORD_TO_BEAT_LABEL_DISABLED}
      onClick={onRecordToBeat}
    >
      RECORD TO THIS BEAT
      {!handoffReady && <small>{handoffReason}</small>}
    </button>}
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
