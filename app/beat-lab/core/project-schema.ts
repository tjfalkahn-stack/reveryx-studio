import { createDefaultArrangement, type ArrangementSection, type SectionKind } from "./arrangement";
import { createId } from "./ids";
import { BANKS, createAllPads, defaultPad, type BankId, type Pad, type PadPlayMode, type StemBus } from "./pads";
import { createDefaultPatterns, type NoteEvent, type Pattern } from "./pattern";
import { starterVaultMeta, type SoundVaultMeta } from "./sound-vault";
import { STARTER_KIT } from "./starter-kit";
import type { CountInBars, PatternBars, QuantizeGrid } from "./timing";
import { clampBpm } from "./timing";

export const BEAT_LAB_SCHEMA_VERSION = 1;

export type SliceMarker = { id: string; time: number };

export type AudioAssetMeta = {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  mime: string;
  byteLength: number;
  provenance: SoundVaultMeta;
  sliceMarkers: SliceMarker[];
  missing: boolean;
};

export type VocalLock = {
  capturedAtBeatRevision: number | null;
  preserveRecordedTiming: boolean;
};

export type BeatLabProject = {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bpm: number;
  numerator: 4;
  denominator: 4;
  swing: number;
  quantize: QuantizeGrid;
  countInBars: CountInBars;
  metronome: boolean;
  noteRepeat: { enabled: boolean; grid: QuantizeGrid };
  pads: Pad[];
  selectedPadId: string;
  selectedBank: BankId;
  assets: AudioAssetMeta[];
  patterns: Pattern[];
  selectedPatternId: string;
  queuedPatternId: string | null;
  arrangement: ArrangementSection[];
  selectedSectionId: string;
  vocalLock: VocalLock;
  beatRevision: number;
  looping: boolean;
  saveGeneration: number;
};

export function createStarterPads(): Pad[] {
  const pads = createAllPads();
  STARTER_KIT.forEach((sound, index) => {
    const current = pads[index];
    pads[index] = defaultPad("A", index, {
      id: current.id,
      name: sound.name,
      color: sound.color,
      starterKey: sound.key,
      end: sound.end,
      chokeGroup: sound.chokeGroup,
      stemBus: sound.stem,
      playMode: sound.key === "ohh" ? "gate" : "one-shot",
    });
  });
  return pads;
}

export function createEmptyProject(title = "Untitled Beat"): BeatLabProject {
  const now = new Date().toISOString();
  const pads = createStarterPads();
  const patterns = createDefaultPatterns(8);
  const arrangement = createDefaultArrangement(patterns[0].id);
  return {
    schemaVersion: BEAT_LAB_SCHEMA_VERSION,
    id: createId("beat"),
    title,
    createdAt: now,
    updatedAt: now,
    bpm: 96,
    numerator: 4,
    denominator: 4,
    swing: 0,
    quantize: "1/16",
    countInBars: 1,
    metronome: true,
    noteRepeat: { enabled: false, grid: "1/16" },
    pads,
    selectedPadId: pads[0].id,
    selectedBank: "A",
    assets: [],
    patterns,
    selectedPatternId: patterns[0].id,
    queuedPatternId: null,
    arrangement,
    selectedSectionId: arrangement[0].id,
    vocalLock: { capturedAtBeatRevision: null, preserveRecordedTiming: true },
    beatRevision: 1,
    looping: true,
    saveGeneration: 0,
  };
}

export type ProjectWarning = { code: string; message: string };

export function migrateProject(input: unknown): { project: BeatLabProject; warnings: ProjectWarning[] } {
  const warnings: ProjectWarning[] = [];
  if (!input || typeof input !== "object") {
    warnings.push({ code: "invalid-json", message: "Beat Lab project was unreadable and a new starter project was created." });
    return { project: createEmptyProject(), warnings };
  }
  const raw = input as Record<string, unknown>;
  const version = Number(raw.schemaVersion || 0);
  if (version > BEAT_LAB_SCHEMA_VERSION) {
    warnings.push({ code: "future-schema", message: "This project was saved by a newer Beat Lab. Loaded with compatible fields only." });
  }
  if (version < 1) {
    warnings.push({ code: "legacy-schema", message: "Project had no schema version. Reveryx recording projects are unchanged; this was imported as Beat Lab v1." });
  }
  const base = createEmptyProject(typeof raw.title === "string" ? raw.title : "Untitled Beat");
  const pads = Array.isArray(raw.pads) ? (raw.pads as Pad[]).map(sanitizePad) : base.pads;
  const patterns = Array.isArray(raw.patterns) && (raw.patterns as Pattern[]).length
    ? (raw.patterns as Pattern[]).map(sanitizePattern)
    : base.patterns;
  while (patterns.length < 8) patterns.push(base.patterns[patterns.length] || { ...base.patterns[0], id: createId("pat"), name: `Pattern ${patterns.length + 1}`, events: [] });
  const assets = Array.isArray(raw.assets) ? (raw.assets as AudioAssetMeta[]).map(sanitizeAsset) : [];
  const missing = assets.filter((asset) => asset.missing);
  if (missing.length) {
    warnings.push({ code: "missing-media", message: `${missing.length} sample ${missing.length === 1 ? "asset is" : "assets are"} missing. Pads stay assigned and can be replaced.` });
  }
  const arrangement = Array.isArray(raw.arrangement) && (raw.arrangement as ArrangementSection[]).length
    ? (raw.arrangement as ArrangementSection[]).map((section) => sanitizeSection(section, patterns[0].id))
    : createDefaultArrangement(patterns[0].id);
  const project: BeatLabProject = {
    ...base,
    id: typeof raw.id === "string" ? raw.id : base.id,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
    bpm: clampBpm(Number(raw.bpm) || base.bpm),
    swing: Math.max(0, Math.min(1, Number(raw.swing) || 0)),
    quantize: sanitizeGrid(raw.quantize),
    countInBars: sanitizeCountIn(raw.countInBars),
    metronome: Boolean(raw.metronome ?? true),
    noteRepeat: {
      enabled: Boolean((raw.noteRepeat as { enabled?: boolean } | undefined)?.enabled),
      grid: sanitizeGrid((raw.noteRepeat as { grid?: unknown } | undefined)?.grid),
    },
    pads: pads.length === 64 ? pads : mergePads(base.pads, pads),
    selectedPadId: typeof raw.selectedPadId === "string" ? raw.selectedPadId : pads[0]?.id || base.selectedPadId,
    selectedBank: BANKS.includes(raw.selectedBank as BankId) ? raw.selectedBank as BankId : "A",
    assets,
    patterns,
    selectedPatternId: typeof raw.selectedPatternId === "string" ? raw.selectedPatternId : patterns[0].id,
    queuedPatternId: typeof raw.queuedPatternId === "string" ? raw.queuedPatternId : null,
    arrangement,
    selectedSectionId: typeof raw.selectedSectionId === "string" ? raw.selectedSectionId : arrangement[0].id,
    vocalLock: {
      capturedAtBeatRevision: Number((raw.vocalLock as VocalLock | undefined)?.capturedAtBeatRevision) || null,
      preserveRecordedTiming: (raw.vocalLock as VocalLock | undefined)?.preserveRecordedTiming !== false,
    },
    beatRevision: Math.max(1, Number(raw.beatRevision) || 1),
    looping: raw.looping !== false,
    saveGeneration: Math.max(0, Number(raw.saveGeneration) || 0),
  };
  return { project, warnings };
}

function mergePads(base: Pad[], incoming: Pad[]): Pad[] {
  const byId = new Map(incoming.map((pad) => [pad.id, pad]));
  return base.map((pad) => byId.get(pad.id) || pad);
}

function sanitizeGrid(value: unknown): QuantizeGrid {
  const allowed: QuantizeGrid[] = ["1/8", "1/8t", "1/16", "1/16t", "1/32", "1/32t"];
  return allowed.includes(value as QuantizeGrid) ? value as QuantizeGrid : "1/16";
}

function sanitizeCountIn(value: unknown): CountInBars {
  return value === 2 || value === 4 || value === 1 ? value : 1;
}

function sanitizePad(raw: Pad): Pad {
  const bank = BANKS.includes(raw.bank) ? raw.bank : "A";
  const index = Math.max(0, Math.min(15, Number(raw.index) || 0));
  return {
    ...defaultPad(bank, index),
    ...raw,
    id: raw.id || defaultPad(bank, index).id,
    bank,
    index,
    volume: clamp01(raw.volume, 0.9),
    pan: Math.max(-1, Math.min(1, Number(raw.pan) || 0)),
    pitchCents: Math.max(-1200, Math.min(1200, Number(raw.pitchCents) || 0)),
    start: Math.max(0, Number(raw.start) || 0),
    end: Math.max(0.01, Number(raw.end) || 1),
    attack: Math.max(0, Number(raw.attack) || 0.002),
    release: Math.max(0, Number(raw.release) || 0.04),
    fadeIn: Math.max(0, Number(raw.fadeIn) || 0),
    fadeOut: Math.max(0, Number(raw.fadeOut) || 0),
    normalizeGain: Math.max(0.1, Number(raw.normalizeGain) || 1),
    playMode: raw.playMode === "gate" ? "gate" : "one-shot" as PadPlayMode,
    chokeGroup: raw.chokeGroup == null ? null : Math.max(1, Math.min(8, Number(raw.chokeGroup))),
    stemBus: sanitizeStem(raw.stemBus),
  };
}

function sanitizeStem(value: unknown): StemBus {
  return value === "sample" || value === "bass" || value === "instrument" ? value : "drums";
}

function sanitizePattern(raw: Pattern): Pattern {
  const bars = ([1, 2, 4, 8, 16] as PatternBars[]).includes(raw.bars) ? raw.bars : 2;
  const events: NoteEvent[] = Array.isArray(raw.events)
    ? raw.events.map((event) => ({
        id: event.id || createId("nt"),
        padId: event.padId,
        startTicks: Math.max(0, Number(event.startTicks) || 0),
        durationTicks: Math.max(1, Number(event.durationTicks) || 24),
        velocity: Math.min(127, Math.max(1, Number(event.velocity) || 100)),
      }))
    : [];
  return {
    id: raw.id || createId("pat"),
    name: String(raw.name || "Pattern").slice(0, 40),
    bars,
    events,
    mutedPadIds: Array.isArray(raw.mutedPadIds) ? raw.mutedPadIds.map(String) : [],
  };
}

function sanitizeSection(raw: ArrangementSection, fallbackPatternId: string): ArrangementSection {
  const kinds: SectionKind[] = ["intro", "verse", "hook", "bridge", "outro", "custom"];
  return {
    id: raw.id || createId("sec"),
    kind: kinds.includes(raw.kind) ? raw.kind : "custom",
    name: String(raw.name || "Section").slice(0, 40),
    patternId: raw.patternId || fallbackPatternId,
    repeats: Math.min(16, Math.max(1, Number(raw.repeats) || 1)),
  };
}

function sanitizeAsset(raw: AudioAssetMeta): AudioAssetMeta {
  return {
    id: raw.id || createId("asset"),
    name: String(raw.name || "Sample"),
    duration: Math.max(0, Number(raw.duration) || 0),
    sampleRate: Math.max(0, Number(raw.sampleRate) || 0),
    channels: Math.max(1, Number(raw.channels) || 1),
    mime: String(raw.mime || "audio/wav"),
    byteLength: Math.max(0, Number(raw.byteLength) || 0),
    provenance: raw.provenance || starterVaultMeta("User sample", ["unknown"]),
    sliceMarkers: Array.isArray(raw.sliceMarkers) ? raw.sliceMarkers.map((marker) => ({ id: marker.id || createId("sl"), time: Math.max(0, Number(marker.time) || 0) })) : [],
    missing: Boolean(raw.missing),
  };
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function bumpBeatRevision(project: BeatLabProject): BeatLabProject {
  return { ...project, beatRevision: project.beatRevision + 1, updatedAt: new Date().toISOString() };
}

export function serializeProject(project: BeatLabProject): string {
  const json = {
    ...project,
    assets: project.assets.map(({ ...asset }) => asset),
  };
  return JSON.stringify(json);
}

export function parseProject(raw: string): { project: BeatLabProject; warnings: ProjectWarning[] } {
  try {
    return migrateProject(JSON.parse(raw));
  } catch {
    return migrateProject(null);
  }
}

export function selectedPattern(project: BeatLabProject): Pattern {
  return project.patterns.find((pattern) => pattern.id === project.selectedPatternId) || project.patterns[0];
}

export function selectedPad(project: BeatLabProject): Pad {
  return project.pads.find((pad) => pad.id === project.selectedPadId) || project.pads[0];
}

export function replacePattern(project: BeatLabProject, pattern: Pattern): BeatLabProject {
  return {
    ...project,
    patterns: project.patterns.map((item) => (item.id === pattern.id ? pattern : item)),
    updatedAt: new Date().toISOString(),
  };
}

export function markAssetsMissing(project: BeatLabProject, presentIds: Set<string>): { project: BeatLabProject; warnings: ProjectWarning[] } {
  const assets = project.assets.map((asset) => ({ ...asset, missing: !presentIds.has(asset.id) }));
  const missing = assets.filter((asset) => asset.missing);
  return {
    project: { ...project, assets },
    warnings: missing.length
      ? [{ code: "missing-media", message: `${missing.length} sample ${missing.length === 1 ? "file is" : "files are"} unavailable. Recording and pads remain usable.` }]
      : [],
  };
}
