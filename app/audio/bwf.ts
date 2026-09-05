export const PRO_TOOLS_SAMPLE_RATE = 48000;

function writeAscii(view: DataView, offset: number, value: string, length: number) {
  for (let index = 0; index < length; index++) {
    view.setUint8(offset + index, index < value.length ? value.charCodeAt(index) & 255 : 0);
  }
}

export function encodeBwf24FromChannels(
  channels: Float32Array[],
  sampleRate: number,
  timeReferenceSamples: number,
  description: string,
): ArrayBuffer {
  const outputChannels = Math.min(2, Math.max(1, channels.length));
  const frames = channels[0]?.length || 0;
  const bytesPerSample = 3;
  const dataBytes = frames * outputChannels * bytesPerSample;
  const dataPad = dataBytes % 2;
  const bextBytes = 602;
  const total = 12 + (8 + bextBytes) + (8 + 16) + (8 + dataBytes + dataPad);
  const output = new ArrayBuffer(total);
  const view = new DataView(output);
  let offset = 0;
  writeAscii(view, offset, "RIFF", 4); offset += 4;
  view.setUint32(offset, total - 8, true); offset += 4;
  writeAscii(view, offset, "WAVE", 4); offset += 4;
  writeAscii(view, offset, "bext", 4); offset += 4;
  view.setUint32(offset, bextBytes, true); offset += 4;
  const now = new Date();
  writeAscii(view, offset, description.slice(0, 255), 256); offset += 256;
  writeAscii(view, offset, "REVERYX", 32); offset += 32;
  writeAscii(view, offset, `REVERYX-${now.getTime()}`, 32); offset += 32;
  writeAscii(view, offset, now.toISOString().slice(0, 10), 10); offset += 10;
  writeAscii(view, offset, now.toISOString().slice(11, 19), 8); offset += 8;
  const time = Math.max(0, Math.round(timeReferenceSamples));
  view.setUint32(offset, time >>> 0, true); offset += 4;
  view.setUint32(offset, Math.floor(time / 4294967296), true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  offset += 64;
  offset += 190;
  writeAscii(view, offset, "fmt ", 4); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, outputChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * outputChannels * bytesPerSample, true); offset += 4;
  view.setUint16(offset, outputChannels * bytesPerSample, true); offset += 2;
  view.setUint16(offset, 24, true); offset += 2;
  writeAscii(view, offset, "data", 4); offset += 4;
  view.setUint32(offset, dataBytes, true); offset += 4;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < outputChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] || 0));
      let value = sample < 0 ? Math.round(sample * 8388608) : Math.round(sample * 8388607);
      if (value < 0) value += 16777216;
      view.setUint8(offset++, value & 255);
      view.setUint8(offset++, (value >>> 8) & 255);
      view.setUint8(offset++, (value >>> 16) & 255);
    }
  }
  return output;
}

export function readBwfTimeReference(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  return view.getUint32(12 + 8 + 256 + 32 + 32 + 10 + 8, true);
}

export function wavDataLength(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return size;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

export function encodeBwf24(buffer: AudioBuffer, timeReferenceSamples: number, description: string): Blob {
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) => buffer.getChannelData(channel));
  return new Blob([encodeBwf24FromChannels(channels, buffer.sampleRate, timeReferenceSamples, description)], { type: "audio/wav" });
}

export async function decodeAt48k(url: string): Promise<AudioBuffer> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
  await context.close();
  if (decoded.sampleRate === PRO_TOOLS_SAMPLE_RATE) return decoded;
  const offline = new OfflineAudioContext(
    decoded.numberOfChannels,
    Math.max(1, Math.ceil(decoded.duration * PRO_TOOLS_SAMPLE_RATE)),
    PRO_TOOLS_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

export function resampleTo(channels: Float32Array[], fromRate: number, toRate: number): Float32Array[] {
  if (fromRate === toRate) return channels.map((channel) => channel.slice());
  const ratio = toRate / fromRate;
  return channels.map((channel) => {
    const length = Math.max(1, Math.round(channel.length * ratio));
    const next = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const src = index / ratio;
      const left = Math.floor(src);
      const frac = src - left;
      const a = channel[left] || 0;
      const b = channel[Math.min(channel.length - 1, left + 1)] || 0;
      next[index] = a + (b - a) * frac;
    }
    return next;
  });
}
