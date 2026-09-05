/**
 * Procedural REVERYX starter kit.
 * All sounds are synthesized from math + noise. No third-party PCM is embedded.
 */
export type StarterKey = "kick" | "snare" | "clap" | "chh" | "ohh" | "perc" | "bass808" | "tone";

export const STARTER_KIT: { key: StarterKey; name: string; category: string; tags: string[]; color: string; stem: "drums" | "bass" | "instrument"; chokeGroup: number | null; end: number }[] = [
  { key: "kick", name: "RX Kick", category: "Kick", tags: ["kick", "starter"], color: "#ff5f6d", stem: "drums", chokeGroup: null, end: 0.55 },
  { key: "snare", name: "RX Snare", category: "Snare", tags: ["snare", "starter"], color: "#43e7ff", stem: "drums", chokeGroup: null, end: 0.32 },
  { key: "clap", name: "RX Clap", category: "Clap", tags: ["clap", "starter"], color: "#ffc36b", stem: "drums", chokeGroup: null, end: 0.28 },
  { key: "chh", name: "RX Closed Hat", category: "Hi-hat", tags: ["hat", "closed", "starter"], color: "#d9ff48", stem: "drums", chokeGroup: 1, end: 0.08 },
  { key: "ohh", name: "RX Open Hat", category: "Hi-hat", tags: ["hat", "open", "starter"], color: "#62e6b0", stem: "drums", chokeGroup: 1, end: 0.42 },
  { key: "perc", name: "RX Perc", category: "Percussion", tags: ["perc", "starter"], color: "#a47dff", stem: "drums", chokeGroup: null, end: 0.22 },
  { key: "bass808", name: "RX 808", category: "808 bass", tags: ["808", "bass", "starter"], color: "#75a9ff", stem: "bass", chokeGroup: null, end: 1.6 },
  { key: "tone", name: "RX Tone", category: "Tonal one-shot", tags: ["tonal", "stab", "starter"], color: "#f080bb", stem: "instrument", chokeGroup: null, end: 0.7 },
];

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let result = Math.imul(t ^ (t >>> 15), 1 | t);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function write(samples: Float32Array, index: number, value: number) {
  if (index < 0 || index >= samples.length) return;
  samples[index] = Math.max(-1, Math.min(1, (samples[index] || 0) + value));
}

export function renderStarterSample(key: StarterKey, sampleRate: number): Float32Array {
  const rate = Math.max(8000, sampleRate);
  switch (key) {
    case "kick":
      return renderKick(rate);
    case "snare":
      return renderSnare(rate);
    case "clap":
      return renderClap(rate);
    case "chh":
      return renderHat(rate, 0.07, 6000);
    case "ohh":
      return renderHat(rate, 0.38, 4200);
    case "perc":
      return renderPerc(rate);
    case "bass808":
      return render808(rate);
    case "tone":
      return renderTone(rate);
    default:
      return new Float32Array(1);
  }
}

function renderKick(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.55);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * 6.4);
    const freq = 48 + 110 * Math.exp(-t * 28);
    const body = Math.sin(2 * Math.PI * freq * t) * env;
    const click = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90) * 0.28;
    samples[index] = Math.max(-1, Math.min(1, body * 0.95 + click));
  }
  return samples;
}

function renderSnare(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.32);
  const samples = new Float32Array(length);
  const rand = mulberry32(0x5E4A1);
  let noise = 0;
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * 14);
    noise = noise * 0.65 + (rand() * 2 - 1) * 0.35;
    const tone = Math.sin(2 * Math.PI * 186 * t) * Math.exp(-t * 18) * 0.35;
    samples[index] = Math.max(-1, Math.min(1, noise * env * 0.72 + tone));
  }
  return samples;
}

function renderClap(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.28);
  const samples = new Float32Array(length);
  const rand = mulberry32(0xC1A9);
  const bursts = [0, 0.012, 0.023, 0.041];
  for (const offset of bursts) {
    const start = Math.round(offset * sampleRate);
    for (let index = 0; index < Math.round(0.07 * sampleRate); index++) {
      const t = index / sampleRate;
      const env = Math.exp(-t * 48);
      write(samples, start + index, (rand() * 2 - 1) * env * 0.55);
    }
  }
  return samples;
}

function renderHat(sampleRate: number, seconds: number, hp: number): Float32Array {
  const length = Math.round(sampleRate * seconds);
  const samples = new Float32Array(length);
  const rand = mulberry32(Math.round(hp * 13));
  let prev = 0;
  const rc = 1 / (2 * Math.PI * hp);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * (seconds < 0.15 ? 48 : 9));
    const white = rand() * 2 - 1;
    const high = alpha * (prev + white - (samples[index - 1] || 0));
    prev = white;
    samples[index] = Math.max(-1, Math.min(1, high * env * 0.7));
  }
  return samples;
}

function renderPerc(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.22);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * 16);
    const freq = 420 + 90 * Math.exp(-t * 40);
    samples[index] = Math.sin(2 * Math.PI * freq * t) * env * 0.7;
  }
  return samples;
}

function render808(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 1.6);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * 2.1);
    const freq = 41 + 28 * Math.exp(-t * 9);
    const wave = Math.sin(2 * Math.PI * freq * t);
    const saturation = Math.tanh(wave * 1.8);
    samples[index] = Math.max(-1, Math.min(1, saturation * env * 0.92));
  }
  return samples;
}

function renderTone(sampleRate: number): Float32Array {
  const length = Math.round(sampleRate * 0.7);
  const samples = new Float32Array(length);
  const freqs = [261.63, 311.13];
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const env = Math.exp(-t * 5.5) * (t < 0.01 ? t / 0.01 : 1);
    let mix = 0;
    for (const freq of freqs) mix += Math.sin(2 * Math.PI * freq * t);
    samples[index] = Math.max(-1, Math.min(1, (mix / freqs.length) * env * 0.7));
  }
  return samples;
}

export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index] || 0));
  return peak;
}

export function normalizeSamples(samples: Float32Array, target = 0.89): { samples: Float32Array; gain: number } {
  const peak = peakAmplitude(samples);
  const gain = peak > 0 ? target / peak : 1;
  const next = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index++) next[index] = (samples[index] || 0) * gain;
  return { samples: next, gain };
}

export function reverseSamples(samples: Float32Array): Float32Array {
  const next = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index++) next[index] = samples[samples.length - 1 - index] || 0;
  return next;
}

export function applyFades(samples: Float32Array, sampleRate: number, fadeInSec: number, fadeOutSec: number): Float32Array {
  const next = new Float32Array(samples.length);
  const fadeIn = Math.max(0, Math.round(fadeInSec * sampleRate));
  const fadeOut = Math.max(0, Math.round(fadeOutSec * sampleRate));
  for (let index = 0; index < samples.length; index++) {
    let gain = 1;
    if (fadeIn > 0 && index < fadeIn) gain *= index / fadeIn;
    if (fadeOut > 0 && index > samples.length - fadeOut) gain *= (samples.length - index) / fadeOut;
    next[index] = (samples[index] || 0) * gain;
  }
  return next;
}

export function extractRegion(samples: Float32Array, sampleRate: number, start: number, end: number): Float32Array {
  const from = Math.max(0, Math.min(samples.length, Math.round(start * sampleRate)));
  const to = Math.max(from + 1, Math.min(samples.length, Math.round(end * sampleRate)));
  return samples.slice(from, to);
}

export function resamplePitch(samples: Float32Array, cents: number): Float32Array {
  const ratio = 2 ** (cents / 1200);
  if (Math.abs(ratio - 1) < 0.0001) return samples.slice();
  const length = Math.max(1, Math.round(samples.length / ratio));
  const next = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const src = index * ratio;
    const left = Math.floor(src);
    const frac = src - left;
    const a = samples[left] || 0;
    const b = samples[Math.min(samples.length - 1, left + 1)] || 0;
    next[index] = a + (b - a) * frac;
  }
  return next;
}
