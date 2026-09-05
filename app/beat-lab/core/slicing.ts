export type SliceOptions = {
  frameMs?: number;
  hopMs?: number;
  threshold?: number;
  minDistanceSec?: number;
  maxSlices?: number;
};

function frameRms(samples: Float32Array, start: number, size: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + size);
  const count = Math.max(1, end - start);
  for (let index = start; index < end; index++) {
    const sample = samples[index] || 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

/**
 * Deterministic transient detection from PCM. Uses half-wave-rectified energy flux
 * with an adaptive mean+std threshold. No randomness and no simulated markers.
 */
export function detectTransients(samples: Float32Array, sampleRate: number, options: SliceOptions = {}): number[] {
  if (!samples.length || sampleRate <= 0) return [0];
  const duration = samples.length / sampleRate;
  const frame = Math.max(32, Math.round(sampleRate * ((options.frameMs ?? 8) / 1000)));
  const hop = Math.max(8, Math.round(sampleRate * ((options.hopMs ?? 2) / 1000)));
  const minDistanceSec = options.minDistanceSec ?? 0.045;
  const maxSlices = options.maxSlices ?? 32;
  const energies: number[] = [];
  for (let offset = 0; offset + frame < samples.length; offset += hop) {
    energies.push(frameRms(samples, offset, frame));
  }
  if (energies.length < 4) return [0];

  const flux: number[] = [0];
  for (let index = 1; index < energies.length; index++) {
    flux.push(Math.max(0, energies[index] - energies[index - 1]));
  }
  const mean = flux.reduce((sum, value) => sum + value, 0) / flux.length;
  let variance = 0;
  for (const value of flux) variance += (value - mean) ** 2;
  const std = Math.sqrt(variance / flux.length);
  const cutoff = mean + (options.threshold ?? 1.35) * Math.max(std, mean * 0.25, 1e-6);
  const minDist = Math.max(1, Math.round(minDistanceSec * sampleRate / hop));
  const times: number[] = [0];
  let last = -minDist;
  for (let index = 1; index < flux.length - 1; index++) {
    const peak = flux[index] >= cutoff && flux[index] >= flux[index - 1] && flux[index] >= flux[index + 1];
    if (!peak || index - last < minDist) continue;
    const time = (index * hop) / sampleRate;
    if (time > 0.008 && time < duration - 0.01) {
      times.push(Number(time.toFixed(5)));
      last = index;
    }
    if (times.length >= maxSlices) break;
  }
  return times;
}

export function equalSliceTimes(duration: number, count: 2 | 4 | 8 | 16): number[] {
  const slices = Math.max(2, count);
  const safeDuration = Math.max(0, duration);
  return Array.from({ length: slices }, (_, index) => Number(((index * safeDuration) / slices).toFixed(5)));
}

export function moveSliceMarker(times: number[], index: number, nextTime: number, duration: number): number[] {
  if (index < 0 || index >= times.length) return times.slice();
  const min = index === 0 ? 0 : times[index - 1] + 0.005;
  const max = index === times.length - 1 ? Math.max(min, duration) : times[index + 1] - 0.005;
  const clamped = Math.min(max, Math.max(min, nextTime));
  const next = times.slice();
  next[index] = Number(clamped.toFixed(5));
  return next;
}

export function addSliceMarker(times: number[], time: number, duration: number): number[] {
  const clamped = Math.min(Math.max(0, time), Math.max(0, duration));
  const next = [...times, Number(clamped.toFixed(5))].sort((a, b) => a - b);
  return next.filter((value, index) => index === 0 || value - next[index - 1] > 0.004);
}

export type SliceRegion = { index: number; start: number; end: number };

export function regionsFromMarkers(times: number[], duration: number): SliceRegion[] {
  const starts = [...times].sort((a, b) => a - b);
  if (!starts.length || starts[0] > 0.0001) starts.unshift(0);
  const regions: SliceRegion[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : duration;
    if (end - start < 0.004) continue;
    regions.push({ index: regions.length, start, end });
  }
  return regions;
}
