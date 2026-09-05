import assert from "node:assert/strict";
import test from "node:test";
import { applySwing, clampBpm, lookAheadWindow, patternLengthTicks, quantizeTicks, secondsPerBeat, secondsToTicks, ticksToSeconds } from "../app/beat-lab/core/timing.ts";
import { addOrReplaceStep, audibleEvents, createDefaultPatterns, createPattern, eventsBeyondLength, quantizePattern, recordLiveNote, setPatternBars } from "../app/beat-lab/core/pattern.ts";
import { createDefaultArrangement, insertSection, moveSection, placeArrangement } from "../app/beat-lab/core/arrangement.ts";
import { assignSliceRegions, clearPad, createAllPads, duplicatePad, padIsAudible } from "../app/beat-lab/core/pads.ts";
import { createEmptyProject, createStarterPads, markAssetsMissing, migrateProject, parseProject, serializeProject } from "../app/beat-lab/core/project-schema.ts";
import { detectTransients, equalSliceTimes, regionsFromMarkers } from "../app/beat-lab/core/slicing.ts";
import { mixVoices, schedulePatternNotes } from "../app/beat-lab/core/mix.ts";
import { BeatLabState } from "../app/beat-lab/core/state.ts";
import { encodeBwf24FromChannels, readBwfTimeReference, wavDataLength } from "../app/audio/bwf.ts";
import { detectBpmFromFilename, detectTrackRole, shouldWarnVocalAlignment } from "../app/session/load-song.ts";
import { renderStarterSample, STARTER_KIT } from "../app/beat-lab/core/starter-kit.ts";
import { BEAT_LAB_EXTENSIONS } from "../app/beat-lab/extensions.ts";

test("quantize snaps to 16th and triplet grids", () => {
  assert.equal(quantizeTicks(10, "1/16"), 0);
  assert.equal(quantizeTicks(13, "1/16"), 24);
  assert.equal(quantizeTicks(16, "1/16t"), 16);
  assert.equal(quantizeTicks(20, "1/32"), 24);
});

test("swing delays only offbeat 16ths", () => {
  assert.equal(applySwing(0, 1), 0);
  assert.equal(applySwing(24, 0), 24);
  assert.ok(applySwing(24, 1) > 24);
  assert.equal(Number(applySwing(24, 1).toFixed(4)), Number((24 + 16).toFixed(4)));
});

test("transport scheduling math is deterministic", () => {
  assert.equal(secondsPerBeat(120), 0.5);
  assert.equal(ticksToSeconds(96, 120), 0.5);
  assert.equal(secondsToTicks(0.5, 120), 96);
  const window = lookAheadWindow(1.12, 1, 0.12, 120, 2, true);
  assert.equal(typeof window.fromTicks, "number");
  assert.equal(clampBpm(12), 40);
  assert.equal(clampBpm(400), 300);
});

test("pattern length changes do not destroy events", () => {
  let pattern = createPattern("Verse", 4);
  pattern = recordLiveNote(pattern, "A-01", 900, "off", 110);
  pattern = setPatternBars(pattern, 1);
  assert.equal(pattern.events.length, 1);
  assert.equal(eventsBeyondLength(pattern).length, 1);
  assert.equal(audibleEvents(pattern).length, 0);
  pattern = setPatternBars(pattern, 8);
  assert.equal(audibleEvents(pattern).length, 1);
});

test("pattern create, step edit, quantize and mute", () => {
  const patterns = createDefaultPatterns(8);
  assert.equal(patterns.length, 8);
  let pattern = addOrReplaceStep(patterns[0], "A-01", 10, "1/16", 100);
  assert.equal(pattern.events.length, 1);
  pattern = addOrReplaceStep(pattern, "A-01", 10, "1/16", 100);
  assert.equal(pattern.events.length, 0);
  pattern = recordLiveNote(patterns[0], "A-01", 11, "off", 90);
  pattern = quantizePattern(pattern, "1/16");
  assert.equal(pattern.events[0].startTicks, 0);
});

test("overdub stacks notes while replace mode overwrites the same step", () => {
  let pattern = createPattern("Take", 2);
  pattern = recordLiveNote(pattern, "A-01", 0, "1/16", 90, 24, true);
  pattern = recordLiveNote(pattern, "A-01", 0, "1/16", 110, 24, true);
  assert.equal(pattern.events.length, 2);
  pattern = recordLiveNote(pattern, "A-01", 0, "1/16", 80, 24, false);
  assert.equal(pattern.events.length, 1);
  assert.equal(pattern.events[0].velocity, 80);
});

test("arrangement ordering and section markers", () => {
  const patterns = createDefaultPatterns(8);
  let sections = createDefaultArrangement(patterns[0].id);
  sections = insertSection(sections, sections[0].id, "hook", patterns[1].id);
  sections = moveSection(sections, sections[1].id, -1);
  assert.equal(sections[0].kind, "hook");
  const placed = placeArrangement(sections, patterns, 96);
  assert.ok(placed[1].startSeconds > placed[0].startSeconds);
  assert.equal(placed[0].startSeconds, 0);
});

test("pad banks duplicate clear and solo", () => {
  const pads = createStarterPads();
  assert.equal(pads.length, 64);
  const next = duplicatePad(pads, "A-01", "A-16");
  assert.equal(next[15].name.includes("copy"), true);
  const cleared = clearPad(next, "A-16");
  assert.equal(cleared[15].starterKey, null);
  const sliced = assignSliceRegions(pads, "A-09", "asset-1", [{ start: 0, end: 0.2 }, { start: 0.2, end: 0.4 }], "Flip");
  assert.equal(sliced[8].assetId, "asset-1");
  assert.equal(sliced[9].start, 0.2);
  assert.equal(padIsAudible(pads[0], pads), true);
  assert.equal(createAllPads().length, 64);
});

test("schema compatibility, serialization and missing media recovery", () => {
  const project = createEmptyProject("Test Beat");
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.patterns.length, 8);
  const json = serializeProject(project);
  const parsed = parseProject(json);
  assert.equal(parsed.project.title, "Test Beat");
  const migrated = migrateProject({ title: "Old", bpm: 90, pads: [] });
  assert.equal(migrated.project.pads.length, 64);
  const withAsset = { ...project, assets: [{ id: "gone", name: "lost.wav", duration: 1, sampleRate: 48000, channels: 1, mime: "audio/wav", byteLength: 10, provenance: project.assets[0]?.provenance || { pack: "User Library", creator: "x", version: "1", category: "sample", tags: [], bpm: null, key: null, license: "User-supplied audio. REVERYX does not grant a license for this file.", source: "test" }, sliceMarkers: [], missing: false }] };
  const marked = markAssetsMissing(withAsset, new Set());
  assert.equal(marked.project.assets[0].missing, true);
  assert.equal(marked.warnings[0].code, "missing-media");
  const invalid = migrateProject(null);
  assert.ok(invalid.warnings.length >= 1);
});

test("deterministic transient slicing analyzes audio", () => {
  const sampleRate = 44100;
  const samples = new Float32Array(sampleRate);
  for (let index = 0; index < 80; index++) samples[Math.round(0.2 * sampleRate) + index] = index % 2 ? 0.9 : -0.9;
  for (let index = 0; index < 80; index++) samples[Math.round(0.55 * sampleRate) + index] = index % 2 ? 0.85 : -0.85;
  const first = detectTransients(samples, sampleRate);
  const second = detectTransients(samples, sampleRate);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 2);
  assert.ok(first[1] > 0.1 && first[1] < 0.3);
  const equal = equalSliceTimes(2, 8);
  assert.equal(equal.length, 8);
  assert.equal(regionsFromMarkers(equal, 2).length, 8);
});

test("export stems share origin and length", () => {
  const click = new Float32Array(48000);
  click[0] = 0.5;
  const voices = [
    { padId: "a", stem: "drums", startSeconds: 0, samples: click, gain: 1, pan: 0 },
    { padId: "b", stem: "bass", startSeconds: 0, samples: click, gain: 1, pan: 0 },
  ];
  const drums = mixVoices(voices, 48000, 1, "drums");
  const bass = mixVoices(voices, 48000, 1, "bass");
  assert.equal(drums.left.length, bass.left.length);
  const drumWav = encodeBwf24FromChannels([drums.left, drums.right], 48000, 0, "drums");
  const bassWav = encodeBwf24FromChannels([bass.left, bass.right], 48000, 0, "bass");
  assert.equal(readBwfTimeReference(drumWav), 0);
  assert.equal(readBwfTimeReference(bassWav), 0);
  assert.equal(wavDataLength(drumWav), wavDataLength(bassWav));
});

test("beat-to-recorder handoff preserves vocal timing by default", () => {
  const warning = shouldWarnVocalAlignment({ hasVocals: true, lockedRevision: 1, beatRevision: 2, preserveVocalTiming: true });
  assert.equal(warning.warn, true);
  assert.match(warning.message, /preserved/i);
  const quiet = shouldWarnVocalAlignment({ hasVocals: true, lockedRevision: 2, beatRevision: 2, preserveVocalTiming: true });
  assert.equal(quiet.warn, false);
});

test("existing session import helpers still detect bpm and roles", () => {
  assert.equal(detectBpmFromFilename("hook-128bpm.wav"), 128);
  assert.equal(detectTrackRole("drums_left.wav", 1), "DRUMS");
  assert.equal(detectTrackRole("lead-vocal.wav", 3), "VOCAL");
  assert.equal(detectTrackRole("song.wav", 0), "BEAT");
});

test("starter kit is original synthesis and non-silent", () => {
  for (const sound of STARTER_KIT) {
    const pcm = renderStarterSample(sound.key, 22050);
    const energy = pcm.reduce((sum, sample) => sum + sample * sample, 0);
    assert.ok(energy > 0.01, `${sound.key} should not be silent`);
  }
  assert.equal(BEAT_LAB_EXTENSIONS.independentTimeStretch, false);
  assert.equal(BEAT_LAB_EXTENSIONS.webMidiInput, false);
});

test("scheduled pattern notes honor swing and loop offset", () => {
  const state = new BeatLabState(createEmptyProject());
  state.toggleStep("A-01", 24);
  const pattern = state.project.patterns[0];
  const straight = schedulePatternNotes(pattern, state.project.pads, 120, 0);
  const swung = schedulePatternNotes(pattern, state.project.pads, 120, 1);
  assert.ok(straight.length >= 1);
  assert.ok(swung[0].startSeconds > straight[0].startSeconds);
  assert.ok(patternLengthTicks(2) > patternLengthTicks(1));
});
