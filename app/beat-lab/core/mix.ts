import { applySwing, ticksToSeconds, type QuantizeGrid } from "./timing";
import { audibleEvents, type Pattern } from "./pattern";
import type { Pad, StemBus } from "./pads";
import { padIsAudible } from "./pads";
import { applyFades, extractRegion, normalizeSamples, resamplePitch, reverseSamples } from "./starter-kit";

export type MixVoice = {
  padId: string;
  stem: StemBus;
  startSeconds: number;
  samples: Float32Array;
  gain: number;
  pan: number;
};

export type ScheduledNote = {
  padId: string;
  startSeconds: number;
  durationSeconds: number;
  velocity: number;
  stem: StemBus;
};

export function schedulePatternNotes(
  pattern: Pattern,
  pads: Pad[],
  bpm: number,
  swing: number,
  timeOffset = 0,
  repeats = 1,
): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  const length = ticksToSeconds(pattern.bars * 4 * 96, bpm);
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const event of audibleEvents(pattern)) {
      const pad = pads.find((item) => item.id === event.padId);
      if (!pad || !padIsAudible(pad, pads)) continue;
      notes.push({
        padId: pad.id,
        startSeconds: timeOffset + repeat * length + ticksToSeconds(applySwing(event.startTicks, swing), bpm),
        durationSeconds: ticksToSeconds(event.durationTicks, bpm),
        velocity: event.velocity / 127,
        stem: pad.stemBus,
      });
    }
  }
  return notes;
}

export function renderPadPcm(
  source: Float32Array,
  sampleRate: number,
  pad: Pad,
): Float32Array {
  let samples = extractRegion(source, sampleRate, pad.start, Math.max(pad.start + 0.01, pad.end));
  if (pad.reverse) samples = reverseSamples(samples);
  if (Math.abs(pad.pitchCents) > 0.1) samples = resamplePitch(samples, pad.pitchCents);
  if (pad.fadeIn > 0 || pad.fadeOut > 0) samples = applyFades(samples, sampleRate, pad.fadeIn, pad.fadeOut);
  if (pad.normalizeGain && pad.normalizeGain !== 1) {
    const scaled = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index++) scaled[index] = samples[index] * pad.normalizeGain;
    samples = scaled;
  }
  return samples;
}

export function mixVoices(
  voices: MixVoice[],
  sampleRate: number,
  durationSeconds: number,
  bus: StemBus | "master" = "master",
): { left: Float32Array; right: Float32Array } {
  const frames = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (const voice of voices) {
    if (bus !== "master" && voice.stem !== bus) continue;
    const start = Math.round(voice.startSeconds * sampleRate);
    const pan = Math.max(-1, Math.min(1, voice.pan));
    const leftGain = voice.gain * Math.min(1, 1 - pan) * Math.SQRT1_2 * 1.414;
    const rightGain = voice.gain * Math.min(1, 1 + pan) * Math.SQRT1_2 * 1.414;
    for (let index = 0; index < voice.samples.length; index++) {
      const dest = start + index;
      if (dest < 0 || dest >= frames) continue;
      const sample = voice.samples[index] || 0;
      left[dest] = clampSample(left[dest] + sample * leftGain);
      right[dest] = clampSample(right[dest] + sample * rightGain);
    }
  }
  return { left, right };
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) peak = Math.max(peak, Math.abs(channel[index] || 0));
  }
  return peak;
}

export function normalizeChannels(channels: Float32Array[], target = 0.89): Float32Array[] {
  const peak = peakOf(channels);
  if (peak <= 0 || peak <= target) return channels.map((channel) => channel.slice());
  const gain = target / peak;
  return channels.map((channel) => {
    const next = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index++) next[index] = channel[index] * gain;
    return next;
  });
}

export function computeNormalizeGain(samples: Float32Array, target = 0.89): number {
  return normalizeSamples(samples, target).gain;
}

export type QuantizeSetting = QuantizeGrid | "off";
