export function detectBpmFromFilename(name: string): number | null {
  const match = name.match(/(?:^|\D)(\d{2,3})\s*bpm(?:\D|$)/i);
  if (!match) return null;
  const bpm = Number(match[1]);
  if (bpm < 40 || bpm > 300) return null;
  return bpm;
}

export function detectTrackRole(name: string, index: number): string {
  const lower = name.toLowerCase();
  if (lower.includes("drum")) return "DRUMS";
  if (lower.includes("bass") || lower.includes("808")) return "BASS";
  if (lower.includes("vocal")) return "VOCAL";
  if (lower.includes("music") || lower.includes("inst")) return "MUSIC";
  if (index === 0) return "BEAT";
  return "STEM";
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^/.]+$/, "") || "Untitled Session";
}

export type HandoffTrack = {
  id: number;
  name: string;
  url: string;
  duration: number;
  peaks: number[];
  role: string;
  format: string;
};

export function peaksFromSamples(samples: Float32Array, buckets = 48): number[] {
  if (!samples.length) return Array.from({ length: buckets }, () => 12);
  const size = Math.max(1, Math.floor(samples.length / buckets));
  return Array.from({ length: buckets }, (_, bucket) => {
    let max = 0;
    const start = bucket * size;
    const step = Math.max(1, Math.floor(size / 160));
    for (let cursor = start; cursor < Math.min(start + size, samples.length); cursor += step) {
      max = Math.max(max, Math.abs(samples[cursor] || 0));
    }
    return Math.max(12, Math.round(max * 100));
  });
}

export function buildBeatHandoffTrack(input: {
  name: string;
  url: string;
  duration: number;
  peaks: number[];
  role?: string;
}): HandoffTrack {
  return {
    id: Date.now(),
    name: input.name,
    url: input.url,
    duration: input.duration,
    peaks: input.peaks.length ? input.peaks : Array.from({ length: 48 }, () => 24),
    role: input.role || "BEAT",
    format: "WAV",
  };
}

export type BeatToRecorderHandoff = {
  projectId: string;
  title: string;
  bpm: number;
  beatUrl: string;
  duration: number;
  peaks: number[];
  sectionMarkers: { id: string; name: string; kind: string; startSeconds: number; endSeconds: number }[];
  beatRevision: number;
  preserveVocalTiming: true;
  source: "beat-lab";
};

export function shouldWarnVocalAlignment(input: {
  hasVocals: boolean;
  lockedRevision: number | null;
  beatRevision: number;
  preserveVocalTiming: boolean;
}): { warn: boolean; message: string } {
  if (!input.hasVocals || input.lockedRevision == null) {
    return { warn: false, message: "" };
  }
  if (input.beatRevision === input.lockedRevision) {
    return { warn: false, message: "" };
  }
  if (input.preserveVocalTiming) {
    return {
      warn: true,
      message: "Beat Lab changed after vocals were recorded. Recorded audio timing is preserved. Conforming vocals to the new BPM or arrangement is an explicit choice and is not applied automatically.",
    };
  }
  return {
    warn: true,
    message: "A later Beat Lab revision is available. Confirm before changing vocal alignment.",
  };
}
