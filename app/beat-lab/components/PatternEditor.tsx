"use client";

import { useSyncExternalStore } from "react";
import { audibleEvents, eventsBeyondLength } from "../core/pattern";
import { selectedPattern } from "../core/project-schema";
import { PATTERN_BAR_OPTIONS, QUANTIZE_TICKS, patternLengthTicks } from "../core/timing";
import { PlayheadLane } from "./TransportBar";
import { useBeatLabRuntime } from "./runtime-context";

export function PatternEditor() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const pattern = selectedPattern(project);
  const step = QUANTIZE_TICKS[project.quantize];
  const length = patternLengthTicks(pattern.bars);
  const steps = Math.max(1, Math.round(length / step));
  const overflow = eventsBeyondLength(pattern);
  const selectedEvents = pattern.events.filter((event) => event.padId === project.selectedPadId).sort((a, b) => a.startTicks - b.startTicks);

  return <section className="bl-pattern" aria-label="Pattern editor">
    <header>
      <div className="bl-pattern-select">
        {project.patterns.map((item) => (
          <button key={item.id} type="button" className={item.id === pattern.id ? "active" : ""} onClick={() => runtime.state.selectPattern(item.id, runtime.playing)}>
            {item.name}{project.queuedPatternId === item.id ? " queued" : ""}
          </button>
        ))}
      </div>
      <input value={pattern.name} onChange={(event) => runtime.state.renameSelectedPattern(event.target.value)} aria-label="Pattern name" />
      <select value={pattern.bars} onChange={(event) => runtime.state.setPatternLength(Number(event.target.value) as typeof pattern.bars)} aria-label="Pattern length">
        {PATTERN_BAR_OPTIONS.map((bars) => <option key={bars} value={bars}>{bars} bars</option>)}
      </select>
      <button type="button" onClick={() => runtime.state.duplicateSelectedPattern()}>Duplicate</button>
      <button type="button" onClick={() => runtime.state.clearSelectedPattern()}>Clear</button>
      <button type="button" onClick={() => runtime.state.quantizeSelectedPattern()}>Quantize</button>
      <button type="button" className={runtime.playMode === "pattern" ? "active" : ""} onClick={() => { runtime.setPlayMode("pattern"); void runtime.play(0, "pattern"); }}>Play pattern</button>
    </header>
    {overflow.length > 0 && <p className="bl-warning">{overflow.length} recorded {overflow.length === 1 ? "event sits" : "events sit"} beyond this length and will return if you restore bars. Nothing was deleted.</p>}
    <div className="bl-step-wrap">
      <PlayheadLane lengthSeconds={(pattern.bars * 4 * 60) / project.bpm} />
      <div className="bl-steps" style={{ gridTemplateColumns: `repeat(${steps}, minmax(18px, 1fr))` }}>
        {Array.from({ length: steps }, (_, index) => {
          const startTicks = index * step;
          const on = audibleEvents(pattern).some((event) => event.padId === project.selectedPadId && event.startTicks === startTicks);
          return <button key={startTicks} type="button" className={`bl-step ${on ? "on" : ""} ${index % 4 === 0 ? "beat" : ""}`} onClick={() => runtime.state.toggleStep(project.selectedPadId, startTicks)} aria-label={`Step ${index + 1}`} />;
        })}
      </div>
    </div>
    <div className="bl-events">
      <small>Events · selected pad</small>
      {selectedEvents.length === 0 && <p>No notes for this pad. Tap a step or record live.</p>}
      {selectedEvents.map((event) => (
        <label key={event.id}>
          <span>{(event.startTicks / 96).toFixed(2)} beats</span>
          <input type="range" min={1} max={127} value={event.velocity} onChange={(eventInput) => runtime.state.setEventVelocity(event.id, Number(eventInput.target.value))} aria-label="Velocity" />
          <b>{event.velocity}</b>
        </label>
      ))}
    </div>
  </section>;
}
