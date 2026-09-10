import { PRO_TOOLS_SAMPLE_RATE, resampleTo } from "./bwf";

export type PcmExtraction = {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
};

export function extractedAudioName(sourceName: string): string {
  const stem = sourceName.replace(/\.[^/.]+$/, "").trim() || "Untitled";
  return `${stem} - extracted audio.wav`;
}

export function trimPcmChannels(
  channels: Float32Array[],
  sampleRate: number,
  startSeconds: number,
  endSeconds: number,
): Float32Array[] {
  const frames = channels[0]?.length || 0;
  const start = Math.max(0, Math.min(frames, Math.floor(startSeconds * sampleRate)));
  const end = Math.max(start + 1, Math.min(frames, Math.ceil(endSeconds * sampleRate)));
  return channels.map((channel) => channel.slice(start, end));
}

export function normalizeExtraction(
  channels: Float32Array[],
  sampleRate: number,
  targetSampleRate = PRO_TOOLS_SAMPLE_RATE,
): PcmExtraction {
  const normalized = resampleTo(channels.slice(0, 2), sampleRate, targetSampleRate);
  return {
    channels: normalized,
    sampleRate: targetSampleRate,
    duration: (normalized[0]?.length || 0) / targetSampleRate,
  };
}
