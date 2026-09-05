import { detectTransients } from "../core/slicing";

export function analyzeTransientsOffline(samples: Float32Array, sampleRate: number) {
  return detectTransients(samples, sampleRate);
}

export async function analyzeTransients(samples: Float32Array, sampleRate: number): Promise<number[]> {
  if (typeof Worker === "undefined") return detectTransients(samples, sampleRate);
  try {
    const worker = new Worker(new URL("./slicing-worker.ts", import.meta.url), { type: "module" });
    return await new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(detectTransients(samples, sampleRate));
      }, 8000);
      worker.onmessage = (event: MessageEvent<{ markers?: number[]; error?: string }>) => {
        clearTimeout(timer);
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.markers || []);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(detectTransients(samples, sampleRate));
      };
      const copy = samples.slice();
      worker.postMessage({ samples: copy.buffer, sampleRate }, [copy.buffer]);
    });
  } catch {
    return detectTransients(samples, sampleRate);
  }
}
