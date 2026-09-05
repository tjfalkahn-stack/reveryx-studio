"use client";

import { useSyncExternalStore } from "react";
import { SECTION_KINDS, placeArrangement } from "../core/arrangement";
import { PlayheadLane } from "./TransportBar";
import { useBeatLabRuntime } from "./runtime-context";

export function ArrangementView() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const placed = placeArrangement(project.arrangement, project.patterns, project.bpm);
  const duration = placed.at(-1)?.endSeconds || 1;

  return <section className="bl-arrange" aria-label="Arrangement">
    <header>
      <small>Arrangement</small>
      <div>
        {SECTION_KINDS.map((kind) => (
          <button key={kind.id} type="button" onClick={() => runtime.state.addSection(kind.id)}>{kind.name}</button>
        ))}
      </div>
      <button type="button" className={runtime.playMode === "arrangement" ? "active" : ""} onClick={() => runtime.playFromSelectedSection()}>Play from section</button>
    </header>
    <div className="bl-arrange-lane">
      <PlayheadLane lengthSeconds={duration} />
      {placed.map((section) => (
        <button
          key={section.id}
          type="button"
          className={`bl-section ${project.selectedSectionId === section.id ? "selected" : ""} kind-${section.kind}`}
          style={{ flexGrow: Math.max(1, section.durationSeconds) }}
          onClick={() => runtime.state.selectSection(section.id)}
        >
          <small>{section.kind}</small>
          <strong>{section.name}</strong>
          <span>{section.repeats}x · {project.patterns.find((pattern) => pattern.id === section.patternId)?.name}</span>
        </button>
      ))}
    </div>
    <div className="bl-arrange-edit">
      <input value={project.arrangement.find((section) => section.id === project.selectedSectionId)?.name || ""} onChange={(event) => runtime.state.renameSelectedSection(event.target.value)} aria-label="Section name" />
      <select value={project.arrangement.find((section) => section.id === project.selectedSectionId)?.patternId || ""} onChange={(event) => runtime.state.assignSectionPattern(event.target.value)} aria-label="Section pattern">
        {project.patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}
      </select>
      <label>Repeats
        <input type="number" min={1} max={16} value={project.arrangement.find((section) => section.id === project.selectedSectionId)?.repeats || 1} onChange={(event) => runtime.state.setSelectedRepeats(Number(event.target.value))} />
      </label>
      <button type="button" onClick={() => runtime.state.moveSelectedSection(-1)}>Up</button>
      <button type="button" onClick={() => runtime.state.moveSelectedSection(1)}>Down</button>
      <button type="button" onClick={() => runtime.state.duplicateSelectedSection()}>Duplicate</button>
      <button type="button" onClick={() => runtime.state.removeSelectedSection()}>Remove</button>
    </div>
  </section>;
}
