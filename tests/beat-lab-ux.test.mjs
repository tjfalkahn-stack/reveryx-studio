import assert from "node:assert/strict";
import test from "node:test";
import { PAD_KEY_LABELS, PAD_KEY_MAP, keyToPadIndex, padKeyLabel, resolvePadKeyDown, resolvePadKeyUp, shouldIgnorePadAutoRepeat, isTypingTarget } from "../app/beat-lab/input/pad-input.ts";
import { padsInBank, defaultPad } from "../app/beat-lab/core/pads.ts";
import { createEmptyProject, createStarterPads } from "../app/beat-lab/core/project-schema.ts";
import { BeatLabState } from "../app/beat-lab/core/state.ts";
import { addOrReplaceStep } from "../app/beat-lab/core/pattern.ts";
import {
  BEAT_LAB_MODE_LABEL,
  BEAT_LAB_MODES,
  canRecordToThisBeat,
  EMPTY_PAD_ACTION,
  inspectorPresentation,
  isGuideComplete,
  isUntouchedBeatLabProject,
  padDisplayName,
  padStateClass,
  parseGuideProgress,
  patternStripLabel,
  RECORD_TO_BEAT_DISABLED_REASON,
  recordToThisBeatDisabledReason,
  shouldShowFirstUseGuide,
  transportStatus,
} from "../app/beat-lab/core/ux.ts";

test("exact 16-key mapping is 1-4 QWER ASDF ZXCV", () => {
  assert.deepEqual([...PAD_KEY_LABELS], ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"]);
  assert.equal(PAD_KEY_MAP.length, 16);
  assert.equal(keyToPadIndex("1"), 0);
  assert.equal(keyToPadIndex("v"), 15);
  assert.equal(padKeyLabel(5), "W");
});

test("keyboard pad press and gate-mode release stay on physical pad index", () => {
  const down = resolvePadKeyDown({ key: "q", repeat: false, target: null }, false);
  const up = resolvePadKeyUp({ key: "q" });
  assert.equal(down?.type, "pad-on");
  assert.equal(down?.padIndex, 4);
  assert.equal(up?.type, "pad-off");
  assert.equal(up?.padIndex, 4);
});

test("shortcuts are ignored while typing and on auto-repeat unless note repeat is on", () => {
  const input = { tagName: "INPUT", isContentEditable: false };
  assert.equal(isTypingTarget(input), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: false, closest: (sel) => sel.includes("[role='dialog']") ? {} : null }), true);
  assert.equal(resolvePadKeyDown({ key: "q", repeat: false, target: input }, false), null);
  assert.equal(shouldIgnorePadAutoRepeat(true, false), true);
  assert.equal(shouldIgnorePadAutoRepeat(true, true), false);
  assert.equal(resolvePadKeyDown({ key: "q", repeat: true, target: null }, false), null);
  assert.equal(resolvePadKeyDown({ key: "q", repeat: true, target: null }, true)?.padIndex, 4);
});

test("shortcuts address the same grid position across banks A-D", () => {
  const pads = createStarterPads();
  for (const bank of ["A", "B", "C", "D"]) {
    const index = keyToPadIndex("s");
    assert.equal(index, 9);
    const pad = padsInBank(pads, bank)[index];
    assert.equal(pad.bank, bank);
    assert.equal(pad.index, 9);
  }
});

test("pattern strip selection uses existing pattern records", () => {
  const state = new BeatLabState(createEmptyProject());
  assert.equal(state.project.patterns.length, 8);
  assert.equal(patternStripLabel(0), "P1");
  const second = state.project.patterns[1].id;
  state.selectPattern(second);
  assert.equal(state.project.selectedPatternId, second);
  state.selectPattern(state.project.patterns[2].id, true);
  assert.equal(state.project.queuedPatternId, state.project.patterns[2].id);
  assert.equal(state.project.selectedPatternId, second);
});

test("Record to This Beat stays disabled until a playable pattern exists", () => {
  const empty = createEmptyProject();
  assert.equal(canRecordToThisBeat(empty), false);
  assert.equal(recordToThisBeatDisabledReason(empty), RECORD_TO_BEAT_DISABLED_REASON);
  const state = new BeatLabState(empty);
  state.update("Step", (project) => ({
    ...project,
    patterns: project.patterns.map((pattern, index) => index === 0 ? addOrReplaceStep(pattern, "A-01", 0, "1/16") : pattern),
  }));
  assert.equal(canRecordToThisBeat(state.project), true);
  assert.equal(recordToThisBeatDisabledReason(state.project), null);
});

test("undo and redo controls follow history availability", () => {
  const state = new BeatLabState(createEmptyProject());
  assert.equal(state.canUndo, false);
  assert.equal(state.canRedo, false);
  state.setTitle("Named");
  state.patchPad("A-01", { volume: 0.2 }, "Volume");
  assert.equal(state.canUndo, true);
  state.undo();
  assert.equal(state.canRedo, true);
  assert.equal(state.project.pads[0].volume, 0.9);
  state.redo();
  assert.equal(state.project.pads[0].volume, 0.2);
});

test("first-use guide dismisses after completion and stays dismissed", () => {
  const project = createEmptyProject();
  assert.equal(isUntouchedBeatLabProject(project), true);
  const fresh = parseGuideProgress(null);
  assert.equal(shouldShowFirstUseGuide(fresh, true), true);
  const done = { dismissed: false, choseSound: true, pressedRecord: true, playedPads: true };
  assert.equal(isGuideComplete(done), true);
  assert.equal(shouldShowFirstUseGuide(done, true), false);
  const stored = parseGuideProgress(JSON.stringify({ dismissed: true }));
  assert.equal(shouldShowFirstUseGuide(stored, true), false);
});

test("empty pads display Drop Sound and visual states are not color-only class names", () => {
  const empty = defaultPad("A", 8);
  assert.equal(padDisplayName(empty), EMPTY_PAD_ACTION);
  const named = defaultPad("A", 8, { name: "Chop" });
  assert.equal(padDisplayName(named), "Chop");
  const classes = padStateClass({ empty: true, selected: true, pressed: true, sounding: true, muted: true, soloed: true, choked: true, hasEvents: true, missing: false });
  assert.match(classes, /empty/);
  assert.match(classes, /pressed/);
  assert.match(classes, /has-events/);
  assert.match(classes, /choked/);
});

test("transport status names stopped playing recording and overdub", () => {
  assert.equal(transportStatus({ playing: false, recording: false, overdub: false, erase: false, inCountIn: false }), "Stopped");
  assert.equal(transportStatus({ playing: true, recording: false, overdub: false, erase: false, inCountIn: false }), "Playing");
  assert.equal(transportStatus({ playing: true, recording: true, overdub: true, erase: false, inCountIn: false }), "Recording · overdub");
  assert.equal(transportStatus({ playing: true, recording: true, overdub: false, erase: false, inCountIn: true }), "Count-in · recording");
});

test("PLAY SAMPLE SEQUENCE ARRANGE mode labels stay stable", () => {
  assert.deepEqual([...BEAT_LAB_MODES], ["play", "sample", "sequence", "arrange"]);
  assert.equal(BEAT_LAB_MODE_LABEL.play, "Play");
});

test("inspector presentation follows desktop tablet and mobile breakpoints", () => {
  assert.equal(inspectorPresentation(1440), "docked");
  assert.equal(inspectorPresentation(1200), "docked");
  assert.equal(inspectorPresentation(834), "overlay");
  assert.equal(inspectorPresentation(768), "overlay");
  assert.equal(inspectorPresentation(390), "sheet");
});
