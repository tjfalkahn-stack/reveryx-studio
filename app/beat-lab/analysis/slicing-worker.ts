import { detectTransients } from "../core/slicing";

self.onmessage = (event: MessageEvent<{ samples: ArrayBuffer; sampleRate: number }>) => {
  try {
    const samples = new Float32Array(event.data.samples);
    const markers = detectTransients(samples, event.data.sampleRate);
    (self as DedicatedWorkerGlobalScope).postMessage({ markers });
  } catch (error) {
    (self as DedicatedWorkerGlobalScope).postMessage({ error: error instanceof Error ? error.message : "Analysis failed" });
  }
};
