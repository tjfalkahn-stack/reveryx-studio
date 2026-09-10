"use client";

import { useEffect, useRef, useState } from "react";
import { encodeBwf24FromChannels, PRO_TOOLS_SAMPLE_RATE } from "./audio/bwf";
import { extractedAudioName, normalizeExtraction, trimPcmChannels, type PcmExtraction } from "./audio/extraction";
import { peaksFromSamples, titleFromFilename } from "./session/load-song";
import { useStudioSession } from "./session/studio-session";

type Extraction = PcmExtraction & {
  source: File;
  name: string;
  blob: Blob;
  url: string;
  peaks: number[];
  trimStart: number;
  trimEnd: number;
};

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function createWav(channels: Float32Array[], name: string) {
  return new Blob([
    encodeBwf24FromChannels(channels, PRO_TOOLS_SAMPLE_RATE, 0, `REVERYX extraction from ${name}`),
  ], { type: "audio/wav" });
}

export default function AudioExtractor({
  announce,
  openRecorder,
  openBeatLab,
}: {
  announce: (message: string) => void;
  openRecorder: () => void;
  openBeatLab: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const currentUrl = useRef("");
  const { setSessionBeat, queueBeatLabFile } = useStudioSession();
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [status, setStatus] = useState<"idle" | "extracting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  function replacePreviewUrl(blob: Blob) {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    const url = URL.createObjectURL(blob);
    currentUrl.current = url;
    return url;
  }

  async function extract(file?: File) {
    if (!file) return;
    setStatus("extracting");
    setError("");
    let context: AudioContext | null = null;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      context = new AudioContextClass();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, channel) => new Float32Array(decoded.getChannelData(channel)));
      const normalized = normalizeExtraction(channels, decoded.sampleRate);
      await context.close();
      context = null;
      if (!normalized.channels.length || !normalized.channels[0].length) throw new Error("No soundtrack was found in that file.");
      const name = extractedAudioName(file.name);
      const blob = createWav(normalized.channels, file.name);
      const url = replacePreviewUrl(blob);
      setExtraction({
        ...normalized,
        source: file,
        name,
        blob,
        url,
        peaks: peaksFromSamples(normalized.channels[0], 84),
        trimStart: 0,
        trimEnd: normalized.duration,
      });
      setTrimStart(0);
      setTrimEnd(normalized.duration);
      setStatus("ready");
      announce("Audio extracted. The original source was not changed.");
    } catch (cause) {
      const message = cause instanceof Error && cause.message.includes("No soundtrack")
        ? cause.message
        : "This browser could not read that soundtrack. Try MP4, MOV, WebM, M4A, WAV, or MP3.";
      setError(message);
      setStatus("error");
    } finally {
      if (context) await context.close().catch(() => undefined);
    }
  }

  function applyTrim() {
    if (!extraction) return;
    const channels = trimPcmChannels(extraction.channels, extraction.sampleRate, trimStart, trimEnd);
    const blob = createWav(channels, extraction.source.name);
    const url = replacePreviewUrl(blob);
    const duration = (channels[0]?.length || 0) / extraction.sampleRate;
    setExtraction({
      ...extraction,
      channels,
      duration,
      blob,
      url,
      peaks: peaksFromSamples(channels[0], 84),
      trimStart: extraction.trimStart + trimStart,
      trimEnd: extraction.trimStart + trimEnd,
    });
    setTrimStart(0);
    setTrimEnd(duration);
    announce(`Trim applied. ${formatTime(duration)} remains.`);
  }

  function addToSession() {
    if (!extraction) return;
    const url = URL.createObjectURL(extraction.blob);
    const track = {
      id: Date.now(),
      name: extraction.name,
      url,
      duration: extraction.duration,
      peaks: extraction.peaks,
      role: "EXTRACTED",
      format: "BWF WAV",
    };
    setSessionBeat((current) => current.importedTracks.length ? {
      ...current,
      importedTracks: [...current.importedTracks, track],
    } : {
      song: titleFromFilename(extraction.source.name),
      source: "Extracted Audio",
      beatUrl: url,
      importedTracks: [track],
      bpm: current.bpm,
      bpmDetected: false,
      sectionMarkers: [],
      beatRevision: current.beatRevision,
      beatSource: "file",
    });
    announce("Extracted audio added to the session at 0:00.");
    openRecorder();
  }

  function sendToBeatLab() {
    if (!extraction) return;
    queueBeatLabFile(new File([extraction.blob], extraction.name, { type: "audio/wav", lastModified: Date.now() }));
    openBeatLab();
  }

  const sourceLabel = extraction?.source.type.startsWith("video/") ? "VIDEO SOUNDTRACK" : "AUDIO SOURCE";

  return <div className="extractor-page">
    <header className="extractor-topbar">
      <div><small>REVERYX / AUDIO EXTRACTOR</small><h1>Pull the sound. Keep the quality.</h1></div>
      <span>DEVICE-LOCAL PROCESSING</span>
    </header>

    <section
      className={`extractor-drop ${dragging ? "dragging" : ""} ${status === "ready" ? "has-audio" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void extract(event.dataTransfer.files[0]);
      }}
    >
      <input ref={fileInput} className="file-input" type="file" accept="video/*,audio/*,.mp4,.mov,.m4v,.webm,.m4a,.wav,.mp3,.aif,.aiff,.ogg" onChange={(event) => { void extract(event.target.files?.[0]); event.target.value = ""; }} />
      {status === "idle" && <div className="extractor-empty">
        <div className="extractor-reel" aria-hidden="true"><i/><i/><i/><b/></div>
        <small>VIDEO OR AUDIO</small>
        <h2>Drop in the source.</h2>
        <p>REVERYX extracts the soundtrack on this device and prepares a studio-ready Broadcast WAV. Your original file stays untouched.</p>
        <button onClick={() => fileInput.current?.click()}>Choose source</button>
        <span>MP4 · MOV · WEBM · M4A · WAV · MP3</span>
      </div>}
      {status === "extracting" && <div className="extractor-progress" role="status"><div className="extractor-pulse"><i/><i/><i/><i/><i/></div><small>EXTRACTING AUDIO</small><h2>Preparing the studio file.</h2><p>Decoding, preserving channels, and converting to 48 kHz / 24-bit.</p></div>}
      {status === "error" && <div className="extractor-empty error" role="alert"><small>SOURCE NOT READABLE</small><h2>We could not extract this one.</h2><p>{error}</p><button onClick={() => fileInput.current?.click()}>Choose another source</button></div>}

      {status === "ready" && extraction && <div className="extractor-ready">
        <div className="extractor-source-head">
          <div className="extractor-file-icon"><span>{extraction.source.type.startsWith("video/") ? "VID" : "AUD"}</span></div>
          <div><small>{sourceLabel}</small><h2>{extraction.source.name}</h2><p>{formatBytes(extraction.source.size)} source · original preserved</p></div>
          <button onClick={() => fileInput.current?.click()}>Replace source</button>
        </div>

        <div className="extractor-wave-card">
          <div className="extractor-wave-meta"><span><small>EXTRACTED TRACK</small><strong>{extraction.name}</strong></span><span><small>DURATION</small><strong>{formatTime(extraction.duration)}</strong></span></div>
          <div className="extractor-wave" aria-label="Extracted audio waveform">{extraction.peaks.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
          <audio controls preload="metadata" src={extraction.url}>Your browser cannot preview this audio.</audio>
        </div>

        <div className="extractor-controls">
          <div className="extractor-trim">
            <div><span><small>START</small><strong>{formatTime(trimStart)}</strong></span><span><small>END</small><strong>{formatTime(trimEnd)}</strong></span></div>
            <label><span>Trim start</span><input type="range" min={0} max={Math.max(.1, trimEnd - .05)} step="0.05" value={trimStart} onChange={(event) => setTrimStart(Math.min(Number(event.target.value), trimEnd - .05))} /></label>
            <label><span>Trim end</span><input type="range" min={Math.min(extraction.duration, trimStart + .05)} max={extraction.duration} step="0.05" value={trimEnd} onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), trimStart + .05))} /></label>
            <button disabled={trimStart <= 0 && trimEnd >= extraction.duration} onClick={applyTrim}>Apply trim</button>
          </div>
          <aside className="extractor-format"><small>STUDIO OUTPUT</small><strong>Broadcast WAV</strong><dl><div><dt>Sample rate</dt><dd>48 kHz</dd></div><div><dt>Bit depth</dt><dd>24-bit</dd></div><div><dt>Channels</dt><dd>{extraction.channels.length === 1 ? "Mono" : "Stereo"}</dd></div><div><dt>Timeline</dt><dd>0:00 aligned</dd></div></dl></aside>
        </div>

        <div className="extractor-actions">
          <button className="extractor-session" onClick={addToSession}><span>01</span><strong>Add to session</strong><small>Place the audio at 0:00</small></button>
          <button onClick={sendToBeatLab}><span>02</span><strong>Send to Beat Lab</strong><small>Save it and start sampling</small></button>
          <a href={extraction.url} download={extraction.name}><span>03</span><strong>Download WAV</strong><small>48 kHz / 24-bit BWF</small></a>
        </div>
      </div>}
    </section>
  </div>;
}
