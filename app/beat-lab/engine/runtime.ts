import { encodeBwf24FromChannels, PRO_TOOLS_SAMPLE_RATE, resampleTo } from "../../audio/bwf";
import { analyzeTransients } from "../analysis/analyze";
import { arrangementDurationSeconds, placeArrangement, sectionMarkersForHandoff } from "../core/arrangement";
import { createId } from "../core/ids";
import { mixVoices, renderPadPcm, schedulePatternNotes, type MixVoice } from "../core/mix";
import { findPad, padsInBank, padIsAudible, type Pad } from "../core/pads";
import { selectedPad, selectedPattern, type AudioAssetMeta, type BeatLabProject } from "../core/project-schema";
import { recordedVaultMeta, resampledVaultMeta, userUploadVaultMeta } from "../core/sound-vault";
import { STARTER_KIT, renderStarterSample, type StarterKey } from "../core/starter-kit";
import { BeatLabState } from "../core/state";
import {
  countInSeconds,
  patternLengthSeconds,
  QUANTIZE_TICKS,
  secondsPerBeat,
  secondsToTicks,
  ticksToSeconds,
  wrapPatternTicks,
} from "../core/timing";
import { loadActiveProject, loadAssetRecord, listAssetIds, saveAssetRecord, saveProjectRecord } from "../persistence/media-store";
import { markAssetsMissing } from "../core/project-schema";
import { peaksFromSamples, type BeatToRecorderHandoff } from "../../session/load-song";

type Voice = {
  padId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  chokeGroup: number | null;
};

type PlayMode = "pattern" | "arrangement";

function audioContextCtor(): typeof AudioContext {
  return window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
}

export class BeatLabRuntime {
  readonly state: BeatLabState;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private reversed = new Map<string, AudioBuffer>();
  private starterBuffers = new Map<string, AudioBuffer>();
  private voices: Voice[] = [];
  private held = new Set<string>();
  private repeatTimers = new Map<string, number>();
  playing = false;
  recording = false;
  overdub = true;
  erase = false;
  playMode: PlayMode = "pattern";
  saveStatus: "saved" | "saving" | "unsaved" | "error" = "saved";
  missingWarning = "";
  private origin = 0;
  private musicOffset = 0;
  private countInUntil = 0;
  private scheduledUntil = 0;
  private schedulerTimer: number | null = null;
  private metronomeGain: GainNode | null = null;
  private lastClick = -1;
  private recordSnapshotTaken = false;
  private autosaveTimer: number | null = null;
  private playheadListeners = new Set<() => void>();
  private displayTimer: number | null = null;
  private objectUrls = new Set<string>();
  playheadVersion = 0;
  private uiListeners = new Set<() => void>();
  uiVersion = 0;
  private restored = false;
  chokedPadId: string | null = null;
  private chokeClearTimer: number | null = null;

  constructor(state = new BeatLabState()) {
    this.state = state;
    this.state.subscribe(() => {
      if (this.state.dirty) this.queueAutosave();
    });
  }

  subscribeUi = (listener: () => void) => {
    this.uiListeners.add(listener);
    return () => { this.uiListeners.delete(listener); };
  };

  getUiSnapshot = () => this.uiVersion;

  private notifyUi() {
    this.uiVersion += 1;
    for (const listener of this.uiListeners) listener();
  }

  subscribePlayhead = (listener: () => void) => {
    this.playheadListeners.add(listener);
    return () => { this.playheadListeners.delete(listener); };
  };

  notifyPlayhead() {
    this.playheadVersion += 1;
    for (const listener of this.playheadListeners) listener();
  }

  async restore() {
    if (this.restored) {
      if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const loaded = await loadActiveProject();
      if (loaded) {
        this.state.project = loaded.project;
        this.state.warnings = loaded.warnings;
        const present = await listAssetIds();
        const marked = markAssetsMissing(this.state.project, present);
        this.state.project = marked.project;
        this.state.warnings = [...loaded.warnings, ...marked.warnings];
        this.missingWarning = marked.warnings[0]?.message || "";
        this.state.notify();
      }
      await this.warmAssets();
      this.saveStatus = "saved";
      this.state.dirty = false;
      this.restored = true;
    } catch {
      this.saveStatus = "error";
    }
    this.notifyUi();
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === "closed") {
      const Ctor = audioContextCtor();
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.metronomeGain = this.ctx.createGain();
      this.metronomeGain.gain.value = 0.35;
      this.metronomeGain.connect(this.master);
      await this.buildStarterBuffers();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private async buildStarterBuffers() {
    if (!this.ctx) return;
    for (const sound of STARTER_KIT) {
      const pcm = renderStarterSample(sound.key, this.ctx.sampleRate);
      const buffer = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
      buffer.copyToChannel(pcm, 0);
      this.starterBuffers.set(sound.key, buffer);
    }
  }

  private async warmAssets() {
    for (const asset of this.state.project.assets) {
      if (this.buffers.has(asset.id)) continue;
      const record = await loadAssetRecord(asset.id);
      if (!record) {
        this.state.markAssetMissing(asset.id);
        continue;
      }
      try {
        await this.decodeAsset(asset.id, await record.blob.arrayBuffer());
      } catch {
        this.state.markAssetMissing(asset.id);
      }
    }
  }

  private async decodeAsset(id: string, data: ArrayBuffer) {
    const ctx = await this.ensureContext();
    const buffer = await ctx.decodeAudioData(data.slice(0));
    this.buffers.set(id, buffer);
    this.reversed.delete(id);
    return buffer;
  }

  padBuffer(pad: Pad): AudioBuffer | null {
    if (pad.starterKey && this.starterBuffers.has(pad.starterKey)) return this.starterBuffers.get(pad.starterKey) || null;
    if (pad.assetId && this.buffers.has(pad.assetId)) return this.buffers.get(pad.assetId) || null;
    return null;
  }

  private reversedBuffer(pad: Pad, source: AudioBuffer): AudioBuffer | null {
    if (!this.ctx) return null;
    const key = `${pad.assetId || pad.starterKey || pad.id}:rev`;
    const cached = this.reversed.get(key);
    if (cached) return cached;
    const buffer = this.ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let channel = 0; channel < source.numberOfChannels; channel++) {
      const input = source.getChannelData(channel);
      const output = buffer.getChannelData(channel);
      for (let index = 0; index < input.length; index++) output[index] = input[input.length - 1 - index] || 0;
    }
    this.reversed.set(key, buffer);
    return buffer;
  }

  async triggerPad(padId: string, velocity = 1, when?: number) {
    const pad = findPad(this.state.project.pads, padId);
    if (!pad || !padIsAudible(pad, this.state.project.pads)) {
      if (pad?.assetId && this.state.project.assets.find((asset) => asset.id === pad.assetId)?.missing) {
        this.missingWarning = "This pad’s sample is missing. Replace it from the browser.";
        this.state.notify();
      }
      return;
    }
    const ctx = await this.ensureContext();
    const sourceBuffer = this.padBuffer(pad);
    if (!sourceBuffer) return;
    const time = when ?? ctx.currentTime;
    if (pad.chokeGroup) this.choke(pad.chokeGroup, time, pad.id);
    const buffer = pad.reverse ? this.reversedBuffer(pad, sourceBuffer) || sourceBuffer : sourceBuffer;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** (pad.pitchCents / 1200);
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pad.pan;
    const level = Math.max(0, Math.min(1, pad.volume * velocity * pad.normalizeGain));
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), time + Math.max(0.001, pad.attack));
    const offset = Math.min(Math.max(0, pad.start), Math.max(0, buffer.duration - 0.01));
    const end = Math.min(buffer.duration, Math.max(offset + 0.01, pad.end));
    const fade = Math.max(0, pad.fadeIn);
    void fade;
    source.connect(gain).connect(panner).connect(this.master!);
    const duration = (end - offset) / source.playbackRate.value;
    source.start(time, offset, duration);
    if (pad.playMode === "one-shot") {
      const releaseAt = time + duration - pad.release;
      gain.gain.setValueAtTime(level, Math.max(time, releaseAt));
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    }
    const voice: Voice = { padId: pad.id, source, gain, chokeGroup: pad.chokeGroup };
    this.voices.push(voice);
    this.notifyUi();
    source.onended = () => {
      this.voices = this.voices.filter((item) => item !== voice);
      this.notifyUi();
    };
    if (this.voices.length > 48) this.stopVoice(this.voices[0], ctx.currentTime);
  }

  releasePad(padId: string) {
    const pad = findPad(this.state.project.pads, padId);
    if (!pad || pad.playMode !== "gate" || !this.ctx) return;
    const time = this.ctx.currentTime;
    for (const voice of this.voices.filter((item) => item.padId === padId)) {
      voice.gain.gain.cancelScheduledValues(time);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), time);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.01, pad.release));
      try { voice.source.stop(time + Math.max(0.01, pad.release) + 0.02); } catch { /* already stopped */ }
    }
  }

  private choke(group: number, time: number, exceptPadId: string) {
    for (const voice of this.voices) {
      if (voice.chokeGroup === group && voice.padId !== exceptPadId) {
        this.markChoked(voice.padId);
        this.stopVoice(voice, time);
      }
    }
  }

  private markChoked(padId: string) {
    this.chokedPadId = padId;
    this.notifyUi();
    if (this.chokeClearTimer) window.clearTimeout(this.chokeClearTimer);
    this.chokeClearTimer = window.setTimeout(() => {
      this.chokedPadId = null;
      this.notifyUi();
    }, 140) as unknown as number;
  }

  soundingPadIds(): string[] {
    return [...new Set(this.voices.map((voice) => voice.padId))];
  }

  heldPadIds(): string[] {
    return [...this.held];
  }

  inCountIn(): boolean {
    return Boolean(this.playing && this.ctx && this.ctx.currentTime < this.countInUntil);
  }

  private stopVoice(voice: Voice, time: number) {
    try {
      voice.gain.gain.cancelScheduledValues(time);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), time);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      voice.source.stop(time + 0.04);
    } catch { /* already stopped */ }
    this.voices = this.voices.filter((item) => item !== voice);
    this.notifyUi();
  }

  stopAllVoices() {
    if (!this.ctx) return;
    for (const voice of [...this.voices]) this.stopVoice(voice, this.ctx.currentTime);
  }

  padOn(padId: string, velocity = 1) {
    this.held.add(padId);
    this.notifyUi();
    void this.triggerPad(padId, velocity);
    if (this.recording && this.playing) this.captureNote(padId, velocity);
    if (this.erase) this.state.erasePadFromPattern(padId);
    if (this.state.project.noteRepeat.enabled) this.startRepeat(padId, velocity);
  }

  padOff(padId: string) {
    this.held.delete(padId);
    this.notifyUi();
    this.releasePad(padId);
    this.stopRepeat(padId);
  }

  private startRepeat(padId: string, velocity: number) {
    this.stopRepeat(padId);
    if (!this.ctx) return;
    const schedule = (audioTime: number) => {
      if (!this.held.has(padId) || !this.state.project.noteRepeat.enabled || !this.ctx) return;
      const step = ticksToSeconds(QUANTIZE_TICKS[this.state.project.noteRepeat.grid], this.state.project.bpm);
      const next = audioTime + step;
      void this.triggerPad(padId, velocity, next);
      if (this.recording && this.playing) this.captureNote(padId, velocity, next);
      const delay = Math.max(8, (next - this.ctx.currentTime) * 1000 - 12);
      this.repeatTimers.set(padId, window.setTimeout(() => schedule(next), delay) as unknown as number);
    };
    schedule(this.ctx.currentTime);
  }

  private stopRepeat(padId: string) {
    const timer = this.repeatTimers.get(padId);
    if (timer) window.clearTimeout(timer);
    this.repeatTimers.delete(padId);
  }

  private captureNote(padId: string, velocity: number, audioTime?: number) {
    if (!this.recordSnapshotTaken) {
      this.state.history.snapshot("Record take", this.state.project);
      this.recordSnapshotTaken = true;
    }
    const seconds = audioTime != null && this.ctx
      ? Math.max(0, audioTime - this.origin)
      : this.musicalSeconds();
    const ticks = wrapPatternTicks(secondsToTicks(seconds, this.state.project.bpm), selectedPattern(this.state.project).bars);
    this.state.recordNote(padId, ticks, Math.round(velocity * 127), true, this.overdub);
  }

  musicalSeconds(): number {
    if (!this.ctx || !this.playing) return this.musicOffset;
    return Math.max(0, this.ctx.currentTime - this.origin);
  }

  playheadSeconds(): number {
    if (this.ctx && this.playing && this.ctx.currentTime < this.countInUntil) {
      return this.ctx.currentTime - this.countInUntil;
    }
    const seconds = this.musicalSeconds();
    if (this.playMode === "pattern" && this.state.project.looping) {
      const length = patternLengthSeconds(selectedPattern(this.state.project).bars, this.state.project.bpm);
      return length ? seconds % length : seconds;
    }
    return seconds;
  }

  barBeat(): { bar: number; beat: number; text: string } {
    const bpm = this.state.project.bpm;
    const seconds = Math.max(0, this.playheadSeconds());
    const beats = seconds / secondsPerBeat(bpm);
    const bar = Math.floor(beats / 4) + 1;
    const beat = Math.floor(beats % 4) + 1;
    return { bar, beat, text: `${String(bar).padStart(2, "0")}.${beat}` };
  }

  async play(fromSeconds = 0, mode: PlayMode = this.playMode) {
    const ctx = await this.ensureContext();
    this.playMode = mode;
    this.stopScheduler();
    this.musicOffset = Math.max(0, fromSeconds);
    const countIn = countInSeconds(this.state.project.countInBars, this.state.project.bpm);
    this.origin = ctx.currentTime + countIn - this.musicOffset;
    this.countInUntil = ctx.currentTime + countIn;
    this.scheduledUntil = this.musicOffset;
    this.lastClick = -1;
    this.playing = true;
    this.recordSnapshotTaken = false;
    this.runScheduler();
    this.runDisplayClock();
    this.notifyUi();
  }

  pause() {
    this.musicOffset = Math.max(0, this.musicalSeconds());
    this.playing = false;
    this.stopScheduler();
    this.stopAllVoices();
    this.notifyUi();
    this.notifyPlayhead();
  }

  stop() {
    this.playing = false;
    this.recording = false;
    this.musicOffset = 0;
    this.stopScheduler();
    this.stopAllVoices();
    this.notifyUi();
    this.notifyPlayhead();
  }

  returnToStart() {
    this.musicOffset = 0;
    if (this.playing) void this.play(0, this.playMode);
    else this.notifyPlayhead();
    this.notifyUi();
  }

  playFromSelectedSection() {
    const placed = placeArrangement(this.state.project.arrangement, this.state.project.patterns, this.state.project.bpm);
    const section = placed.find((item) => item.id === this.state.project.selectedSectionId) || placed[0];
    void this.play(section?.startSeconds || 0, "arrangement");
  }

  toggleRecording() {
    this.recording = !this.recording;
    this.recordSnapshotTaken = false;
    this.notifyUi();
  }

  toggleErase() {
    this.erase = !this.erase;
    this.notifyUi();
  }

  toggleOverdub() {
    this.overdub = !this.overdub;
    this.notifyUi();
  }

  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
    this.notifyUi();
  }

  private runScheduler() {
    const tick = () => {
      if (!this.playing || !this.ctx) return;
      this.scheduleWindow(this.ctx.currentTime, 0.12);
      this.schedulerTimer = window.setTimeout(tick, 25) as unknown as number;
    };
    tick();
  }

  private stopScheduler() {
    if (this.schedulerTimer) window.clearTimeout(this.schedulerTimer);
    this.schedulerTimer = null;
    if (this.displayTimer) window.cancelAnimationFrame(this.displayTimer);
    this.displayTimer = null;
  }

  private runDisplayClock() {
    const loop = () => {
      if (!this.playing) return;
      this.notifyPlayhead();
      this.displayTimer = window.requestAnimationFrame(loop);
    };
    this.displayTimer = window.requestAnimationFrame(loop);
  }

  private scheduleWindow(now: number, lookahead: number) {
    if (!this.ctx) return;
    if (this.state.project.metronome) this.scheduleMetronome(now, lookahead);
    const horizon = now + lookahead;
    const musicNow = Math.max(0, now - this.origin);
    const musicHorizon = Math.max(0, horizon - this.origin);
    if (horizon <= this.countInUntil) return;
    const notes = this.collectNotes(musicNow, musicHorizon);
    for (const note of notes) {
      const when = this.origin + note.startSeconds;
      if (when < now - 0.02) continue;
      void this.triggerPad(note.padId, note.velocity, when);
    }
    if (this.playMode === "pattern" && this.state.project.queuedPatternId) {
      const length = patternLengthSeconds(selectedPattern(this.state.project).bars, this.state.project.bpm);
      const crossed = Math.floor(musicNow / length) !== Math.floor(musicHorizon / length);
      if (crossed) this.state.consumeQueuedPattern();
    }
    this.scheduledUntil = musicHorizon;
  }

  private collectNotes(from: number, to: number) {
    const project = this.state.project;
    if (this.playMode === "arrangement") {
      const placed = placeArrangement(project.arrangement, project.patterns, project.bpm);
      const notes = [];
      for (const section of placed) {
        if (section.endSeconds < from || section.startSeconds > to) continue;
        const pattern = project.patterns.find((item) => item.id === section.patternId);
        if (!pattern) continue;
        notes.push(...schedulePatternNotes(pattern, project.pads, project.bpm, project.swing, section.startSeconds, section.repeats));
      }
      return notes.filter((note) => note.startSeconds >= this.scheduledUntil - 0.0001 && note.startSeconds < to);
    }
    const pattern = selectedPattern(project);
    const length = patternLengthSeconds(pattern.bars, project.bpm);
    const repeats = project.looping ? Math.max(1, Math.ceil(to / length) + 1) : 1;
    const notes = schedulePatternNotes(pattern, project.pads, project.bpm, project.swing, 0, repeats);
    return notes.filter((note) => note.startSeconds >= Math.max(this.scheduledUntil - 0.0001, from) && note.startSeconds < to);
  }

  private scheduleMetronome(now: number, lookahead: number) {
    if (!this.ctx || !this.metronomeGain) return;
    const bpm = this.state.project.bpm;
    const beat = secondsPerBeat(bpm);
    const start = now;
    const end = now + lookahead;
    let t = Math.ceil((start - (this.origin - countInSeconds(this.state.project.countInBars, bpm))) / beat) * beat + (this.origin - countInSeconds(this.state.project.countInBars, bpm));
    while (t < end) {
      const beatIndex = Math.round((t - (this.origin - countInSeconds(this.state.project.countInBars, bpm))) / beat);
      if (beatIndex !== this.lastClick && t >= now) {
        this.click(t, beatIndex % 4 === 0);
        this.lastClick = beatIndex;
      }
      t += beat;
    }
  }

  private click(time: number, accent: boolean) {
    if (!this.ctx || !this.metronomeGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(accent ? 0.28 : 0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(this.metronomeGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  async importFiles(files: File[], padId?: string) {
    if (padId) this.state.selectPad(padId);
    const ctx = await this.ensureContext();
    for (const file of files) {
      if (!file.type.startsWith("audio/") && !/\.(wav|mp3|aif|aiff|m4a|ogg|flac)$/i.test(file.name)) {
        this.state.warnings = [{ code: "unsupported", message: `${file.name} is not a supported audio file.` }];
        this.state.notify();
        continue;
      }
      try {
        const data = await file.arrayBuffer();
        const buffer = await ctx.decodeAudioData(data.slice(0));
        const id = createId("asset");
        const channel = buffer.getChannelData(0);
        const asset: AudioAssetMeta = {
          id,
          name: file.name,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
          mime: file.type || "audio/wav",
          byteLength: file.size,
          provenance: userUploadVaultMeta(file.name),
          sliceMarkers: [{ id: createId("sl"), time: 0 }],
          missing: false,
        };
        this.buffers.set(id, buffer);
        await saveAssetRecord(id, file, file.type || "audio/wav");
        this.state.addAsset(asset, true);
        void channel;
      } catch {
        this.state.warnings = [{ code: "corrupt", message: `${file.name} could not be decoded. The file was not assigned.` }];
        this.state.notify();
      }
    }
  }

  async recordSample(seconds = 4) {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.warnings = [{ code: "mic", message: "This browser cannot capture a microphone sample." }];
      this.state.notify();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = await this.ensureContext();
      const chunks: Float32Array[] = [];
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      await new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const pcm = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      buffer.copyToChannel(pcm, 0);
      const wav = new Blob([encodeBwf24FromChannels([pcm], ctx.sampleRate, 0, "REVERYX recorded sample")], { type: "audio/wav" });
      const id = createId("asset");
      const asset: AudioAssetMeta = {
        id,
        name: `Recorded sample ${new Date().toISOString().slice(11, 19)}`,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: 1,
        mime: "audio/wav",
        byteLength: wav.size,
        provenance: recordedVaultMeta(),
        sliceMarkers: [{ id: createId("sl"), time: 0 }],
        missing: false,
      };
      this.buffers.set(id, buffer);
      await saveAssetRecord(id, wav, "audio/wav");
      this.state.addAsset(asset, true);
    } catch {
      this.state.warnings = [{ code: "mic-denied", message: "Microphone access was not granted. Pads and recording of patterns still work." }];
      this.state.notify();
    }
  }

  async autoSliceSelected() {
    const pad = selectedPad(this.state.project);
    const buffer = this.padBuffer(pad);
    if (!buffer || !pad.assetId) return;
    try {
      const times = await analyzeTransients(buffer.getChannelData(0), buffer.sampleRate);
      this.state.setSliceMarkers(pad.assetId, times);
    } catch {
      this.state.warnings = [{ code: "analysis", message: "Transient analysis failed. Manual slices are still available." }];
      this.state.notify();
    }
  }

  async resampleSelectedToEmptyPad() {
    const pad = selectedPad(this.state.project);
    const source = this.padBuffer(pad);
    if (!source || !this.ctx) return;
    const pcm = renderPadPcm(source.getChannelData(0), source.sampleRate, pad);
    const buffer = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const wav = new Blob([encodeBwf24FromChannels([pcm], this.ctx.sampleRate, 0, `Resample ${pad.name}`)], { type: "audio/wav" });
    const id = createId("asset");
    const asset: AudioAssetMeta = {
      id,
      name: `${pad.name} resample`,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: 1,
      mime: "audio/wav",
      byteLength: wav.size,
      provenance: resampledVaultMeta(pad.name),
      sliceMarkers: [{ id: createId("sl"), time: 0 }],
      missing: false,
    };
    this.buffers.set(id, buffer);
    await saveAssetRecord(id, wav, "audio/wav");
    const target = padsInBank(this.state.project.pads, pad.bank).find((item) => item.index > pad.index && !item.assetId && !item.starterKey)
      || padsInBank(this.state.project.pads, pad.bank).find((item) => !item.assetId && !item.starterKey && item.id !== pad.id);
    this.state.addAsset(asset, false);
    if (target) {
      this.state.patchPad(target.id, {
        assetId: id,
        starterKey: null,
        name: asset.name,
        start: 0,
        end: asset.duration,
        stemBus: pad.stemBus,
      }, "Resample to pad");
      this.state.selectPad(target.id);
    }
  }

  sourcePcm(pad: Pad): Float32Array | null {
    const buffer = this.padBuffer(pad);
    return buffer ? buffer.getChannelData(0) : null;
  }

  private queueAutosave() {
    this.saveStatus = "unsaved";
    if (this.autosaveTimer) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => { void this.save(); }, 700) as unknown as number;
    this.notifyUi();
  }

  async save() {
    if (!this.restored) return;
    this.saveStatus = "saving";
    this.notifyUi();
    try {
      await saveProjectRecord(this.state.project);
      this.state.dirty = false;
      this.saveStatus = "saved";
    } catch {
      this.saveStatus = "error";
    }
    this.notifyUi();
  }

  private mixProject(bus: "master" | "drums" | "sample" | "bass" | "instrument" = "master", sampleRate = PRO_TOOLS_SAMPLE_RATE) {
    const project = this.state.project;
    const duration = Math.max(0.25, arrangementDurationSeconds(project.arrangement, project.patterns, project.bpm));
    const voices: MixVoice[] = [];
    const placed = placeArrangement(project.arrangement, project.patterns, project.bpm);
    for (const section of placed) {
      const pattern = project.patterns.find((item) => item.id === section.patternId);
      if (!pattern) continue;
      const notes = schedulePatternNotes(pattern, project.pads, project.bpm, project.swing, section.startSeconds, section.repeats);
      for (const note of notes) {
        const pad = findPad(project.pads, note.padId);
        if (!pad) continue;
        const buffer = this.padBuffer(pad);
        if (!buffer) continue;
        const rendered = renderPadPcm(buffer.getChannelData(0), buffer.sampleRate, pad);
        const [resampled] = resampleTo([rendered], buffer.sampleRate, sampleRate);
        voices.push({
          padId: pad.id,
          stem: pad.stemBus,
          startSeconds: note.startSeconds,
          samples: resampled,
          gain: pad.volume * note.velocity,
          pan: pad.pan,
        });
      }
    }
    return { ...mixVoices(voices, sampleRate, duration, bus), duration, sampleRate };
  }

  renderStemWav(bus: "master" | "drums" | "sample" | "bass" | "instrument", description: string) {
    const mix = this.mixProject(bus);
    return new Blob([encodeBwf24FromChannels([mix.left, mix.right], mix.sampleRate, 0, description)], { type: "audio/wav" });
  }

  async recordToThisBeat(): Promise<BeatToRecorderHandoff> {
    await this.restore();
    await this.save();
    this.state.bumpRevision();
    const mix = this.mixProject("master");
    const wav = new Blob([encodeBwf24FromChannels([mix.left, mix.right], mix.sampleRate, 0, `${this.state.project.title} beat`)], { type: "audio/wav" });
    const url = URL.createObjectURL(wav);
    this.objectUrls.add(url);
    const peaks = peaksFromSamples(mix.left);
    const placed = placeArrangement(this.state.project.arrangement, this.state.project.patterns, this.state.project.bpm);
    this.state.lockVocalsIfUnset();
    return {
      projectId: this.state.project.id,
      title: this.state.project.title,
      bpm: this.state.project.bpm,
      beatUrl: url,
      duration: mix.duration,
      peaks,
      sectionMarkers: sectionMarkersForHandoff(placed),
      beatRevision: this.state.project.beatRevision,
      preserveVocalTiming: true,
      source: "beat-lab",
    };
  }

  exportManifest(project: BeatLabProject = this.state.project) {
    const placed = placeArrangement(project.arrangement, project.patterns, project.bpm);
    return {
      product: "REVERYX Beat Lab",
      version: "1.0",
      schemaVersion: project.schemaVersion,
      title: project.title,
      bpm: project.bpm,
      meter: "4/4",
      swing: project.swing,
      quantize: project.quantize,
      beatRevision: project.beatRevision,
      vocalLock: project.vocalLock,
      timelineOriginSeconds: 0,
      sampleRate: PRO_TOOLS_SAMPLE_RATE,
      bitDepth: 24,
      sections: sectionMarkersForHandoff(placed),
      pads: project.pads.map((pad) => ({ id: pad.id, name: pad.name, stem: pad.stemBus, assetId: pad.assetId, starterKey: pad.starterKey })),
      assets: project.assets.map((asset) => ({ id: asset.id, name: asset.name, missing: asset.missing, provenance: asset.provenance })),
      patterns: project.patterns.map((pattern) => ({ id: pattern.id, name: pattern.name, bars: pattern.bars, events: pattern.events.length })),
      exports: ["beat.wav", "stems/drums.wav", "stems/sample.wav", "stems/bass.wav", "stems/instrument.wav"],
    };
  }

  dispose() {
    this.stop();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

export function starterKeyList(): StarterKey[] {
  return STARTER_KIT.map((item) => item.key);
}
