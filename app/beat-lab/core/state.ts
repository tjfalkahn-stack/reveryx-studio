import { addSliceMarker, equalSliceTimes, moveSliceMarker, regionsFromMarkers } from "./slicing";
import {
  insertSection,
  duplicateSection as duplicateArrangementSection,
  moveSection,
  removeSection,
  renameSection,
  setSectionRepeats,
  type SectionKind,
} from "./arrangement";
import { ProjectHistory } from "./history";
import {
  createEmptyProject,
  replacePattern,
  selectedPad,
  selectedPattern,
  type AudioAssetMeta,
  type BeatLabProject,
  type ProjectWarning,
} from "./project-schema";
import {
  addOrReplaceStep,
  clearPattern,
  duplicatePattern,
  erasePadEvents,
  quantizePattern,
  recordLiveNote,
  renamePattern,
  setPatternBars,
  togglePadMute,
  updateEvent,
} from "./pattern";
import {
  assignSliceRegions,
  clearPad,
  duplicatePad,
  findPad,
  replacePad,
  type BankId,
  type Pad,
} from "./pads";
import { computeNormalizeGain } from "./mix";
import { createId } from "./ids";
import type { CountInBars, PatternBars, QuantizeGrid } from "./timing";
import { clampBpm } from "./timing";
import { createSection } from "./arrangement";

export class BeatLabState {
  project: BeatLabProject;
  warnings: ProjectWarning[] = [];
  history = new ProjectHistory();
  private listeners = new Set<() => void>();
  dirty = false;

  constructor(project: BeatLabProject = createEmptyProject()) {
    this.project = project;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.project;

  notify() {
    for (const listener of this.listeners) listener();
  }

  commit(label: string, next: BeatLabProject, recordHistory = true) {
    if (recordHistory) this.history.snapshot(label, this.project);
    this.project = { ...next, updatedAt: new Date().toISOString(), saveGeneration: this.project.saveGeneration + 1 };
    this.dirty = true;
    this.notify();
  }

  update(label: string, recipe: (project: BeatLabProject) => BeatLabProject, recordHistory = true) {
    this.commit(label, recipe(this.project), recordHistory);
  }

  setTitle(title: string) {
    this.update("Rename project", (project) => ({ ...project, title: title.slice(0, 80) || project.title }), false);
  }

  setBpm(bpm: number) {
    this.update("Tempo", (project) => ({ ...project, bpm: clampBpm(bpm) }));
  }

  setSwing(swing: number) {
    this.update("Swing", (project) => ({ ...project, swing: Math.max(0, Math.min(1, swing)) }), false);
  }

  setQuantize(quantize: QuantizeGrid) {
    this.update("Quantize", (project) => ({ ...project, quantize }), false);
  }

  setCountIn(countInBars: CountInBars) {
    this.update("Count-in", (project) => ({ ...project, countInBars }), false);
  }

  setMetronome(metronome: boolean) {
    this.update("Metronome", (project) => ({ ...project, metronome }), false);
  }

  setLooping(looping: boolean) {
    this.update("Loop", (project) => ({ ...project, looping }), false);
  }

  setNoteRepeat(enabled: boolean, grid?: QuantizeGrid) {
    this.update("Note repeat", (project) => ({
      ...project,
      noteRepeat: { enabled, grid: grid || project.noteRepeat.grid },
    }), false);
  }

  selectBank(bank: BankId) {
    const first = this.project.pads.find((pad) => pad.bank === bank);
    this.update("Select bank", (project) => ({ ...project, selectedBank: bank, selectedPadId: first?.id || project.selectedPadId }), false);
  }

  selectPad(id: string) {
    const pad = findPad(this.project.pads, id);
    if (!pad) return;
    this.update("Select pad", (project) => ({ ...project, selectedPadId: id, selectedBank: pad.bank }), false);
  }

  patchPad(id: string, patch: Partial<Pad>, label = "Pad edit") {
    this.update(label, (project) => ({ ...project, pads: replacePad(project.pads, id, patch) }));
  }

  duplicateSelectedPadTo(targetId: string) {
    this.update("Duplicate pad", (project) => ({ ...project, pads: duplicatePad(project.pads, project.selectedPadId, targetId) }));
  }

  clearSelectedPad() {
    this.update("Clear pad", (project) => ({ ...project, pads: clearPad(project.pads, project.selectedPadId) }));
  }

  resetSelectedPadValues() {
    this.update("Reset pad", (project) => ({
      ...project,
      pads: replacePad(project.pads, project.selectedPadId, {
        volume: 0.9,
        pan: 0,
        pitchCents: 0,
        attack: 0.002,
        release: 0.04,
      }),
    }));
  }

  selectPattern(id: string, playing = false) {
    if (playing && id !== this.project.selectedPatternId) {
      this.update("Queue pattern", (project) => ({ ...project, queuedPatternId: id }), false);
      return;
    }
    this.update("Select pattern", (project) => ({ ...project, selectedPatternId: id, queuedPatternId: null }), false);
  }

  consumeQueuedPattern() {
    if (!this.project.queuedPatternId) return;
    const id = this.project.queuedPatternId;
    this.update("Pattern change", (project) => ({ ...project, selectedPatternId: id, queuedPatternId: null }), false);
  }

  setPatternLength(bars: PatternBars) {
    const pattern = selectedPattern(this.project);
    this.update("Pattern length", (project) => replacePattern(project, setPatternBars(pattern, bars)));
  }

  duplicateSelectedPattern() {
    const pattern = duplicatePattern(selectedPattern(this.project));
    this.update("Duplicate pattern", (project) => ({
      ...project,
      patterns: [...project.patterns, pattern],
      selectedPatternId: pattern.id,
    }));
  }

  renameSelectedPattern(name: string) {
    this.update("Rename pattern", (project) => replacePattern(project, renamePattern(selectedPattern(project), name)));
  }

  clearSelectedPattern() {
    this.update("Clear pattern", (project) => replacePattern(project, clearPattern(selectedPattern(project))));
  }

  quantizeSelectedPattern() {
    this.update("Quantize pattern", (project) => replacePattern(project, quantizePattern(selectedPattern(project), project.quantize)));
  }

  toggleTrackMute(padId: string) {
    this.update("Track mute", (project) => replacePattern(project, togglePadMute(selectedPattern(project), padId)), false);
  }

  togglePadSolo(padId: string) {
    this.update("Pad solo", (project) => {
      const pad = findPad(project.pads, padId);
      if (!pad) return project;
      return { ...project, pads: replacePad(project.pads, padId, { solo: !pad.solo }) };
    }, false);
  }

  togglePadMute(padId: string) {
    this.update("Pad mute", (project) => {
      const pad = findPad(project.pads, padId);
      if (!pad) return project;
      return { ...project, pads: replacePad(project.pads, padId, { mute: !pad.mute }) };
    }, false);
  }

  toggleStep(padId: string, startTicks: number) {
    this.update("Step edit", (project) => replacePattern(project, addOrReplaceStep(selectedPattern(project), padId, startTicks, project.quantize)));
  }

  setEventVelocity(eventId: string, velocity: number) {
    this.update("Velocity", (project) => replacePattern(project, updateEvent(selectedPattern(project), eventId, { velocity })));
  }

  recordNote(padId: string, ticks: number, velocity: number, quantizeEnabled: boolean, overdub = true) {
    this.update("Recorded note", (project) => replacePattern(
      project,
      recordLiveNote(selectedPattern(project), padId, ticks, quantizeEnabled ? project.quantize : "off", velocity, 24, overdub),
    ), false);
  }

  erasePadFromPattern(padId: string) {
    this.update("Erase pad", (project) => replacePattern(project, erasePadEvents(selectedPattern(project), padId)));
  }

  addSection(kind: SectionKind) {
    this.update("Insert section", (project) => ({
      ...project,
      arrangement: insertSection(project.arrangement, project.selectedSectionId, kind, project.selectedPatternId),
    }));
  }

  selectSection(id: string) {
    const section = this.project.arrangement.find((item) => item.id === id);
    this.update("Select section", (project) => ({
      ...project,
      selectedSectionId: id,
      selectedPatternId: section?.patternId || project.selectedPatternId,
    }), false);
  }

  moveSelectedSection(direction: -1 | 1) {
    this.update("Reorder section", (project) => ({ ...project, arrangement: moveSection(project.arrangement, project.selectedSectionId, direction) }));
  }

  duplicateSelectedSection() {
    this.update("Duplicate section", (project) => ({ ...project, arrangement: duplicateArrangementSection(project.arrangement, project.selectedSectionId) }));
  }

  renameSelectedSection(name: string) {
    this.update("Rename section", (project) => ({ ...project, arrangement: renameSection(project.arrangement, project.selectedSectionId, name) }));
  }

  setSelectedRepeats(repeats: number) {
    this.update("Section repeats", (project) => ({ ...project, arrangement: setSectionRepeats(project.arrangement, project.selectedSectionId, repeats) }));
  }

  removeSelectedSection() {
    this.update("Remove section", (project) => ({ ...project, arrangement: removeSection(project.arrangement, project.selectedSectionId) }));
  }

  assignSectionPattern(patternId: string) {
    this.update("Section pattern", (project) => ({
      ...project,
      arrangement: project.arrangement.map((section) => section.id === project.selectedSectionId ? { ...section, patternId } : section),
    }));
  }

  addAsset(asset: AudioAssetMeta, assignToSelected = true) {
    this.update("Import sample", (project) => {
      const pad = selectedPad(project);
      return {
        ...project,
        assets: [...project.assets, asset],
        pads: assignToSelected
          ? replacePad(project.pads, pad.id, {
              assetId: asset.id,
              starterKey: null,
              name: asset.name.replace(/\.[^.]+$/, "").slice(0, 24) || pad.name,
              start: 0,
              end: Math.max(0.05, asset.duration),
              stemBus: "sample",
            })
          : project.pads,
      };
    });
  }

  markAssetMissing(id: string) {
    this.project = {
      ...this.project,
      assets: this.project.assets.map((asset) => asset.id === id ? { ...asset, missing: true } : asset),
    };
    this.warnings = [{ code: "missing-media", message: "A sample is missing. The pad assignment was kept so it can be replaced." }];
    this.notify();
  }

  setSliceMarkers(assetId: string, times: number[]) {
    this.update("Slice markers", (project) => ({
      ...project,
      assets: project.assets.map((asset) => asset.id === assetId
        ? { ...asset, sliceMarkers: times.map((time) => ({ id: createId("sl"), time })) }
        : asset),
    }));
  }

  addManualSlice(assetId: string, time: number) {
    const asset = this.project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    this.setSliceMarkers(assetId, addSliceMarker(asset.sliceMarkers.map((marker) => marker.time), time, asset.duration));
  }

  moveSlice(assetId: string, index: number, time: number) {
    const asset = this.project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    this.setSliceMarkers(assetId, moveSliceMarker(asset.sliceMarkers.map((marker) => marker.time), index, time, asset.duration));
  }

  equalSlices(assetId: string, count: 2 | 4 | 8 | 16) {
    const asset = this.project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    this.setSliceMarkers(assetId, equalSliceTimes(asset.duration, count));
  }

  assignSlicesToPads(assetId: string) {
    const asset = this.project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const times = asset.sliceMarkers.length ? asset.sliceMarkers.map((marker) => marker.time) : [0];
    const regions = regionsFromMarkers(times, asset.duration);
    this.update("Assign slices", (project) => ({
      ...project,
      pads: assignSliceRegions(project.pads, project.selectedPadId, assetId, regions, asset.name.replace(/\.[^.]+$/, "") || "Slice"),
    }));
  }

  normalizeSelectedPad(samples: Float32Array) {
    const gain = computeNormalizeGain(samples);
    this.patchPad(this.project.selectedPadId, { normalizeGain: gain }, "Normalize");
  }

  get canUndo() {
    return this.history.canUndo;
  }

  get canRedo() {
    return this.history.canRedo;
  }

  get undoLabel() {
    return this.history.undoLabel;
  }

  get redoLabel() {
    return this.history.redoLabel;
  }

  undo() {
    const result = this.history.undo(this.project);
    if (!result) return;
    this.project = result.project;
    this.dirty = true;
    this.notify();
  }

  redo() {
    const result = this.history.redo(this.project);
    if (!result) return;
    this.project = result.project;
    this.dirty = true;
    this.notify();
  }

  bumpRevision() {
    this.project = { ...this.project, beatRevision: this.project.beatRevision + 1 };
  }

  lockVocalsIfUnset() {
    if (this.project.vocalLock.capturedAtBeatRevision != null) return;
    this.project = {
      ...this.project,
      vocalLock: { capturedAtBeatRevision: this.project.beatRevision, preserveRecordedTiming: true },
    };
    this.notify();
  }

  ensureArrangementPattern(patternId: string) {
    if (this.project.arrangement.some((section) => section.patternId === patternId)) return;
    this.update("Link pattern", (project) => ({
      ...project,
      arrangement: [...project.arrangement, createSection("custom", patternId, 1, selectedPattern({ ...project, selectedPatternId: patternId }).name)],
    }), false);
  }
}
