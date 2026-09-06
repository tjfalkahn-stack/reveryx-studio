"use client";

import { useSyncExternalStore } from "react";
import { selectedPattern } from "../core/project-schema";
import { patternHasEvents, patternStripLabel } from "../core/ux";
import { useBeatLabRuntime } from "./runtime-context";

export function PatternStrip() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const current = selectedPattern(project);

  return <div className="bl-pattern-strip" role="toolbar" aria-label="Patterns">
    {project.patterns.map((pattern, index) => {
      const selected = pattern.id === current.id;
      const queued = project.queuedPatternId === pattern.id;
      const filled = patternHasEvents(pattern);
      return <button
        key={pattern.id}
        type="button"
        className={`bl-pattern-chip ${selected ? "selected" : ""} ${queued ? "queued" : ""} ${filled ? "filled" : "empty"}`}
        aria-pressed={selected}
        aria-label={`${patternStripLabel(index)} ${pattern.name}${filled ? ", has events" : ", empty"}${queued ? ", queued" : ""}`}
        title={runtime.playing && !selected ? "Queues at the next loop boundary" : pattern.name}
        onClick={() => runtime.state.selectPattern(pattern.id, runtime.playing)}
      >
        <strong>{patternStripLabel(index)}</strong>
        {filled ? <i className="bl-pattern-dot" aria-hidden="true" /> : <span className="bl-pattern-empty">Empty</span>}
      </button>;
    })}
  </div>;
}
