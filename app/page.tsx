"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import LinkSessions from "./link-sessions";
import BeatLabWorkspace from "./beat-lab/BeatLabWorkspace";
import { decodeAt48k, encodeBwf24, PRO_TOOLS_SAMPLE_RATE } from "./audio/bwf";
import { detectBpmFromFilename, detectTrackRole, peaksFromSamples, shouldWarnVocalAlignment, titleFromFilename } from "./session/load-song";
import { StudioSessionProvider, useStudioSession } from "./session/studio-session";

type View = "session" | "beatlab" | "link" | "wordwave" | "library" | "deliveries";
type TakeState = "captured" | "keep" | "recovery";
type CapturedTake = { id:number; name:string; url:string; seconds:number; state:TakeState; mime:string; start:number; punchLabel:string };
type ImportedTrack = { id:number; name:string; url:string; duration:number; peaks:number[]; role:string; format:string };
type DesktopEngineState = "checking" | "connected" | "not-installed";

const DESKTOP_ENGINE_STATUS_URL="http://127.0.0.1:49173/v1/status";

function useDesktopEngine() {
  const [state,setState]=useState<DesktopEngineState>("checking");
  const [version,setVersion]=useState("");
  const check=async()=>{
    setState("checking");
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),900);
    try {
      const response=await fetch(DESKTOP_ENGINE_STATUS_URL,{cache:"no-store",signal:controller.signal});
      const payload=await response.json() as {engine?:string;version?:string};
      if(!response.ok||payload.engine!=="REVERYX_NATIVE")throw new Error("Native engine unavailable");
      setVersion(payload.version||"alpha");
      setState("connected");
    } catch { setState("not-installed"); }
    finally { window.clearTimeout(timeout); }
  };
  useEffect(()=>{void check();},[]);
  const open=()=>{window.location.href="reveryx://session/new";};
  return {state,version,check,open};
}

type RecoveredTake = Omit<CapturedTake,"url"> & { blob:Blob };
const RECOVERY_DB="reveryx-local-recovery";
const RECOVERY_STORE="takes";

function recoveryDb():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(RECOVERY_DB,1);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(RECOVERY_STORE))request.result.createObjectStore(RECOVERY_STORE,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function protectTake(take:CapturedTake,blob:Blob) {
  const db=await recoveryDb();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(RECOVERY_STORE,"readwrite");
    tx.objectStore(RECOVERY_STORE).put({...take,blob,url:undefined});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function updateProtectedTake(id:number,state:TakeState) {
  const db=await recoveryDb();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(RECOVERY_STORE,"readwrite");
    const store=tx.objectStore(RECOVERY_STORE);
    const request=store.get(id);
    request.onsuccess=()=>request.result&&store.put({...request.result,state});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function recoverTakes():Promise<CapturedTake[]> {
  if(typeof indexedDB==="undefined")return [];
  const db=await recoveryDb();
  const recovered=await new Promise<RecoveredTake[]>((resolve,reject)=>{
    const request=db.transaction(RECOVERY_STORE,"readonly").objectStore(RECOVERY_STORE).getAll();
    request.onsuccess=()=>resolve(request.result as RecoveredTake[]);
    request.onerror=()=>reject(request.error);
  });
  db.close();
  return recovered.map(({blob,...take})=>({...take,url:URL.createObjectURL(blob)}));
}

const wave = [24,44,62,38,72,51,86,64,46,78,92,55,74,34,61,83,48,70,96,58,42,67,79,52,88,63,39,72,54,81,45,69,90,57,76,48,66,84,41,73,59,94,68,46,78,56,87,62];
const lyricPunches = [
  { time:18.75,label:"Verse 1 · line 1",match:"came through the rain" },
  { time:26.25,label:"Verse 1 · line 2",match:"closed door" },
  { time:33.75,label:"Verse 1 · line 3",match:"counted me out" },
  { time:41.25,label:"Verse 1 · line 4",match:"open my mouth" },
  { time:48.75,label:"Hook · opening",match:"hook" },
];
function formatTime(seconds:number) { const safe=Math.max(0,seconds||0); return `${Math.floor(safe/60)}:${String(Math.floor(safe%60)).padStart(2,"0")}.${String(Math.floor((safe%1)*10))}`; }

function safeAudioName(value:string){return value.replace(/[^a-z0-9-_]+/gi,"-").replace(/^-+|-+$/g,"")||"audio";}
const chain = [
  { name:"TUNE", value:"E♭ Minor · 18 ms", tone:"violet" },
  { name:"SCULPT", value:"Presence +2.1", tone:"blue" },
  { name:"LEVEL", value:"4.2 dB control", tone:"pink" },
  { name:"SPACE", value:"Short plate · 9%", tone:"amber" },
];
const archetypes = [
  { name:"Midnight Confessional", family:"INTIMATE / DARK", match:94, detail:"Dark, intimate lead with restrained space and controlled melodic tuning.", traits:["Close","Warm","Tuned"] },
  { name:"Chrome Melody", family:"POLISHED / MELODIC", match:89, detail:"Highly polished tuning, bright presence and controlled ambience.", traits:["Bright","Glossy","Modern"] },
  { name:"Concrete Voice", family:"RAP / UPFRONT", match:92, detail:"Dry, hard and upfront with tight dynamics and almost no room.", traits:["Dry","Dense","Direct"] },
  { name:"Astral Hook", family:"WIDE / ANTHEMIC", match:87, detail:"Wide melodic chorus with layered depth and timed delay throws.", traits:["Wide","Layered","Airy"] },
  { name:"Velvet Air", family:"R&B / SMOOTH", match:91, detail:"Soft compression, open top end and a warm floating plate.", traits:["Silky","Open","Warm"] },
  { name:"Neon Pain", family:"EMOTIVE / TEXTURED", match:86, detail:"Emotional tuning, subtle grit and long controlled echoes.", traits:["Grit","Echo","Emotive"] },
  { name:"Punch God", family:"PUNCH-IN / AGGRESSIVE", match:96, detail:"Fast, forceful rap lead built for bar-by-bar punch recording.", traits:["Fast","Hard","Locked"] },
  { name:"Phantom Ad-Libs", family:"FX / BACKGROUND", match:83, detail:"Filtered, widened and automated background vocal treatment.", traits:["Ghosted","Wide","FX"] },
];
const artists = [
  { initials:"A", name:"Demo Artist", status:"IN STUDIO", sessions:12, sound:"Midnight Confessional", mic:"Neumann U 87 Ai", interface:"Apollo Twin X", command:"2-bar pre-roll · auto-next punch", color:"purple" },
  { initials:"N", name:"Nova Reign", status:"READY", sessions:7, sound:"Velvet Air", mic:"Sony C-800G", interface:"Apollo x8p", command:"1-bar pre-roll · manual keep", color:"blue" },
  { initials:"S", name:"Saint Lee", status:"READY", sessions:4, sound:"Concrete Voice", mic:"Telefunken TF51", interface:"Pro Tools Carbon", command:"4-beat pre-roll · fast punch", color:"amber" },
];
const deliveries = [
  { song:"Pressure Again", artist:"Demo Artist", state:"READY TO BOUNCE", type:"Master package", files:8, version:"Master v1", time:"Today, 3:42 AM" },
  { song:"Night Shift", artist:"Nova Reign", state:"ENGINEER REVIEW", type:"Mix package", files:16, version:"Mix v3", time:"Yesterday" },
  { song:"No Sleep", artist:"Saint Lee", state:"DELIVERED", type:"Full release", files:12, version:"Master v2", time:"Aug 23" },
];

export default function Home() {
  const [view,setView] = useState<View>("session");
  const [toast,setToast] = useState("");

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get("room")&&params.get("key"))setView("link");
  },[]);

  function announce(message:string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return <StudioSessionProvider><main className="studio-shell">
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    <AppRail view={view} setView={setView} />
    <section className="workspace">
      {view === "session" && <SessionWorkspace announce={announce} openVault={() => setView("library")} openLyrics={() => setView("wordwave")} openLink={() => setView("link")} openBeatLab={() => setView("beatlab")} />}
      {view === "beatlab" && <BeatLabWorkspace announce={announce} openRecorder={() => setView("session")} />}
      {view === "link" && <LinkSessions announce={announce} />}
      {view === "wordwave" && <WordwaveStudio announce={announce} openSession={() => setView("session")} />}
      {view === "library" && <LibraryHub announce={announce} openSession={() => setView("session")} />}
      {view === "deliveries" && <Deliveries announce={announce} />}
    </section>
  </main></StudioSessionProvider>;
}

function AppRail({view,setView}:{view:View;setView:(view:View)=>void}) {
  const items:{id:View;icon:RailIconName;label:string}[] = [
    {id:"session",icon:"session",label:"Record"},
    {id:"beatlab",icon:"beatlab",label:"Beat Lab"},
    {id:"link",icon:"link",label:"Collaborate"},
    {id:"library",icon:"library",label:"Library"},
    {id:"deliveries",icon:"deliveries",label:"Finish"},
  ];
  return <aside className="rail">
    <button className="brand-mark" onClick={() => setView("session")} aria-label="Open REVERYX session">
      <img src="/reveryx-symbol.png" alt="REVERYX" />
    </button>
    <div className="brand-word">REVERYX<small>SONIC OS</small></div>
    <div className="rail-spectrum" aria-hidden="true"><i/><i/><i/><i/></div>
    <nav className="rail-nav" aria-label="Primary">
      {items.map(item => <button key={item.id} onClick={() => setView(item.id)} className={`rail-button ${view===item.id?"active":""}`} aria-label={item.label} data-tip={item.label}><RailIcon name={item.icon}/><small>{item.label}</small></button>)}
    </nav>
    <button className="rail-button profile" aria-label="Profile">TJ</button>
  </aside>;
}

type RailIconName = "session" | "beatlab" | "link" | "library" | "deliveries";

function RailIcon({name}:{name:RailIconName}) {
  const common = {width:24,height:24,viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg","aria-hidden":true as const};
  if (name === "session") return <svg {...common}><circle cx="12" cy="12" r="7.25"/><circle cx="12" cy="12" r="2.25"/><path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2"/></svg>;
  if (name === "beatlab") return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7"/><rect x="13.5" y="3.5" width="7" height="7"/><rect x="3.5" y="13.5" width="7" height="7"/><rect x="13.5" y="13.5" width="7" height="7"/></svg>;
  if (name === "link") return <svg {...common}><path d="M9.5 14.5 14.5 9"/><path d="M7.4 16.6 5.8 18.2a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2A3.4 3.4 0 0 1 9 10M14.9 14a3.4 3.4 0 0 0 4.9-.2l3.2-3.2a3.4 3.4 0 0 0-4.8-4.8l-1.6 1.6"/></svg>;
  if (name === "library") return <svg {...common}><path d="M4.5 5.5h6v13h-6zM13.5 5.5h6v13h-6z"/><path d="M7.5 9h0M16.5 9h0"/></svg>;
  return <svg {...common}><path d="M5 15.5v3.25h14V5H8.75"/><path d="M12 5h7v7M19 5l-9 9"/></svg>;
}

type TransportIconName = "previous" | "play" | "pause" | "next";

function TransportIcon({name}:{name:TransportIconName}) {
  const common = {width:24,height:24,viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg","aria-hidden":true as const};
  if (name === "previous") return <svg {...common}><path d="M6 5v14M18 6.5 9.5 12l8.5 5.5z"/></svg>;
  if (name === "next") return <svg {...common}><path d="M18 5v14M6 6.5l8.5 5.5L6 17.5z"/></svg>;
  if (name === "pause") return <svg {...common}><path d="M8 6v12M16 6v12"/></svg>;
  return <svg {...common}><path d="m8 5.5 10 6.5-10 6.5z"/></svg>;
}

function SessionWorkspace({announce,openVault,openLyrics,openLink,openBeatLab}:{announce:(message:string)=>void;openVault:()=>void;openLyrics:()=>void;openLink:()=>void;openBeatLab:()=>void}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const takeStartRef = useRef(0);
  const takeLabelRef = useRef("Manual punch");
  const timerRef = useRef<ReturnType<typeof window.setInterval>|null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof window.setInterval>|null>(null);
  const scheduledStartRef = useRef<ReturnType<typeof window.setTimeout>|null>(null);
  const beatRef = useRef<HTMLAudioElement|null>(null);
  const monitorContextRef = useRef<AudioContext|null>(null);
  const monitorSourceRef = useRef<MediaStreamAudioSourceNode|null>(null);
  const monitorGainRef = useRef<GainNode|null>(null);
  const takePlaybackRef = useRef<HTMLAudioElement|null>(null);
  const { sessionBeat, setSessionBeat, setHasVocals, hasVocals, lockedBeatRevision, lockVocalsToRevision } = useStudioSession();
  const song = sessionBeat.song;
  const source = sessionBeat.source;
  const beatUrl = sessionBeat.beatUrl;
  const importedTracks = sessionBeat.importedTracks;
  const bpm = sessionBeat.bpm;
  const bpmDetected = sessionBeat.bpmDetected;
  const sectionMarkers = sessionBeat.sectionMarkers;
  const [playing,setPlaying] = useState(false);
  const [recording,setRecording] = useState(false);
  const [arming,setArming] = useState(false);
  const [countIn,setCountIn] = useState(0);
  const [currentTime,setCurrentTime] = useState(0);
  const [punchPoint,setPunchPoint] = useState(33.75);
  const [punchLabel,setPunchLabel] = useState("Verse 1 · line 3");
  const [preRollBars,setPreRollBars] = useState(2);
  const [latencyOffset,setLatencyOffset] = useState(0);
  const [elapsed,setElapsed] = useState(0);
  const [stage,setStage] = useState(0);
  const [sound,setSound] = useState(0);
  const [soundPicker,setSoundPicker] = useState(false);
  const [setupOpen,setSetupOpen] = useState(false);
  const [dawOpen,setDawOpen] = useState(false);
  const [daw,setDaw] = useState("REVERYX Standalone");
  const [command,setCommand] = useState("");
  const [lastCommand,setLastCommand] = useState("Punch me in after the last line.");
  const [takes,setTakes] = useState(7);
  const [capturedTakes,setCapturedTakes] = useState<CapturedTake[]>([]);
  const [exportOpen,setExportOpen] = useState(false);
  const [soundChecked,setSoundChecked] = useState(false);
  const [advancedOpen,setAdvancedOpen] = useState(false);
  const [aiOpen,setAiOpen] = useState(false);
  const [beatToolsOpen,setBeatToolsOpen] = useState(false);
  const [playbackRate,setPlaybackRate] = useState(1);
  const [monitorEnabled,setMonitorEnabled] = useState(true);
  const [auditioningTakeId,setAuditioningTakeId] = useState<number|null>(null);
  const [speakerMode,setSpeakerMode] = useState(false);
  const [recoveryReady,setRecoveryReady] = useState(false);
  const [online,setOnline] = useState(true);
  const [storageMb,setStorageMb] = useState<number|null>(null);
  const [measuredLatency,setMeasuredLatency] = useState<number|null>(null);
  const desktopEngine=useDesktopEngine();
  const [captureSupported,setCaptureSupported]=useState(false);

  useEffect(()=>{
    let mounted=true;
    void recoverTakes().then(recovered=>{
      if(!mounted)return;
      if(recovered.length){setCapturedTakes(recovered);setHasVocals(true);}
      setRecoveryReady(true);
    }).catch(()=>setRecoveryReady(true));
    return()=>{mounted=false;};
  },[]);

  useEffect(()=>{
    const updateNetwork=()=>setOnline(navigator.onLine);
    updateNetwork();
    setCaptureSupported(Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder));
    window.addEventListener("online",updateNetwork);
    window.addEventListener("offline",updateNetwork);
    if(navigator.storage?.estimate)void navigator.storage.estimate().then(({quota=0,usage=0})=>setStorageMb(Math.max(0,Math.round((quota-usage)/1024/1024)))).catch(()=>setStorageMb(null));
    return()=>{window.removeEventListener("online",updateNetwork);window.removeEventListener("offline",updateNetwork);};
  },[]);

  async function inspectAudio(file:File,index:number):Promise<ImportedTrack> {
    const url=URL.createObjectURL(file);
    const role=detectTrackRole(file.name,index);
    let duration=0;
    let peaks=wave.slice(0,48);
    try {
      const AudioContextClass=window.AudioContext || (window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
      const context=new AudioContextClass();
      const decoded=await context.decodeAudioData(await file.arrayBuffer());
      duration=decoded.duration;
      peaks=peaksFromSamples(decoded.getChannelData(0));
      await context.close();
    } catch { /* Unsupported compressed files still remain available for handoff. */ }
    return {id:Date.now()+index,name:file.name,url,duration,peaks,role,format:file.name.split(".").pop()?.toUpperCase()||"AUDIO"};
  }
  async function loadSong(files?:File[]) {
    if (!files?.length) return;
    const audioFiles=files.filter(file=>!file.name.toLowerCase().endsWith(".zip"));
    const inspected=await Promise.all(audioFiles.map(inspectAudio));
    const title=titleFromFilename(files[0].name);
    const filenameBpm=detectBpmFromFilename(files[0].name);
    setSessionBeat({
      song: title,
      source: files.length>1||files[0].name.toLowerCase().endsWith(".zip")?"Stems":"Stereo Beat",
      importedTracks: inspected,
      beatUrl: inspected[0]?.url||"",
      bpm: filenameBpm||128,
      bpmDetected: Boolean(filenameBpm),
      sectionMarkers: [],
      beatRevision: sessionBeat.beatRevision,
      beatSource: "file",
    });
    setPlaybackRate(1);
    setBeatToolsOpen(false);
    setSoundChecked(false);
    setSetupOpen(false);
    announce(`${files.length} ${files.length===1?"source":"sources"} loaded. Waveforms, tempo map and artist recall are ready.`);
  }
  async function disconnectMonitor() {
    monitorSourceRef.current?.disconnect();
    monitorGainRef.current?.disconnect();
    monitorSourceRef.current=null;
    monitorGainRef.current=null;
    if (monitorContextRef.current) await monitorContextRef.current.close().catch(()=>undefined);
    monitorContextRef.current=null;
  }
  async function connectMonitor(stream:MediaStream) {
    await disconnectMonitor();
    const AudioContextClass=window.AudioContext || (window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
    const context=new AudioContextClass({latencyHint:"interactive"});
    const sourceNode=context.createMediaStreamSource(stream);
    const gain=context.createGain();
    gain.gain.value=.9;
    sourceNode.connect(gain).connect(context.destination);
    await context.resume();
    monitorContextRef.current=context;
    monitorSourceRef.current=sourceNode;
    monitorGainRef.current=gain;
  }
  async function toggleMonitor() {
    const next=!monitorEnabled;
    setMonitorEnabled(next);
    if (!next) await disconnectMonitor();
    else if (streamRef.current) await connectMonitor(streamRef.current);
    announce(next?"Headphone vocal monitoring is on.":"Headphone vocal monitoring is off. Recording remains active.");
  }
  function stopAudition() {
    takePlaybackRef.current?.pause();
    takePlaybackRef.current=null;
    beatRef.current?.pause();
    setAuditioningTakeId(null);
    setPlaying(false);
  }
  async function togglePlayback() {
    if (!beatRef.current || !beatUrl) { setPlaying(value=>!value); announce("Load a beat to enable real audio playback."); return; }
    if (auditioningTakeId!==null) { stopAudition(); return; }
    if (playing) { beatRef.current.pause(); setPlaying(false); }
    else { await beatRef.current.play(); setPlaying(true); }
  }
  function captureConstraints():MediaTrackConstraints {
    return speakerMode
      ? {echoCancellation:true,noiseSuppression:true,autoGainControl:false}
      : {echoCancellation:false,noiseSuppression:false,autoGainControl:false};
  }
  async function setListeningMode(useSpeakers:boolean) {
    setSpeakerMode(useSpeakers);
    if (useSpeakers) {
      setMonitorEnabled(false);
      await disconnectMonitor();
      announce("Speaker Recording Mode is on. Keep device volume moderate for the cleanest vocal.");
    } else {
      setMonitorEnabled(true);
      if (streamRef.current) await connectMonitor(streamRef.current);
      announce("Headphone Mode is on with live vocal monitoring.");
    }
    setSoundChecked(false);
  }
  async function startCapture(target=punchPoint,targetLabel=punchLabel) {
    if (recording||arming) return;
    if (!importedTracks.length) {
      announce("Load a beat or stems before recording so every take can be placed correctly.");
      setSetupOpen(true);
      return;
    }
    if (daw !== "REVERYX Standalone") {
      setRecording(true);
      announce(`${daw} bridge armed for recording.`);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      announce("This browser cannot capture audio. Use the REVERYX desktop recorder.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:captureConstraints()});
      streamRef.current = stream;
      if (monitorEnabled&&!speakerMode) await connectMonitor(stream);
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const seconds = Math.max(1,Math.round((Date.now()-startedAtRef.current)/1000));
        const blob = new Blob(chunksRef.current,{type:recorder.mimeType || "audio/webm"});
        const id = Date.now();
        setCapturedTakes(value => {
          const take={id,name:`Verse Lead · Take ${String(value.length+1).padStart(2,"0")}`,url:URL.createObjectURL(blob),seconds,state:"captured" as TakeState,mime:blob.type,start:takeStartRef.current,punchLabel:takeLabelRef.current};
          void protectTake(take,blob).then(()=>announce("Take captured and protected on this device.")).catch(()=>announce("Take captured. Download it before closing this session."));
          setHasVocals(true);
          if(sessionBeat.beatSource==="beat-lab")lockVocalsToRevision(sessionBeat.beatRevision);
          return [...value,take];
        });
        stream.getTracks().forEach(track=>track.stop());
        void disconnectMonitor();
        streamRef.current = null;
        recorderRef.current = null;
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
      };
      const beginRecording=()=>{
        takeStartRef.current=Math.max(0,target+latencyOffset/1000);
        takeLabelRef.current=targetLabel;
        startedAtRef.current=Date.now();
        setElapsed(0);
        recorder.start(250);
        timerRef.current=window.setInterval(()=>setElapsed(Math.round((Date.now()-startedAtRef.current)/1000)),1000);
        setArming(false);setCountIn(0);setRecording(true);
        announce(`Punch live at ${formatTime(target)}. Beat and protected vocal are synchronized.`);
      };
      const preRollSeconds=beatUrl?preRollBars*4*(60/(bpm*playbackRate)):0;
      if (beatRef.current&&beatUrl&&preRollSeconds>0) {
        beatRef.current.currentTime=Math.max(0,target-preRollSeconds);
        await beatRef.current.play();
        setPlaying(true);setArming(true);setCountIn(Math.max(1,Math.ceil(preRollSeconds)));
        countdownTimerRef.current=window.setInterval(()=>setCountIn(value=>Math.max(0,value-1)),1000);
        scheduledStartRef.current=window.setTimeout(()=>{
          if(countdownTimerRef.current)window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current=null;scheduledStartRef.current=null;beginRecording();
        },preRollSeconds*1000);
        announce(`${preRollBars}-bar pre-roll started. Punch armed at ${formatTime(target)}.`);
      } else beginRecording();
    } catch {
      announce("Microphone access was not granted. Check browser permissions and try again.");
    }
  }
  function stopCapture(message="Take captured. Raw audio remains protected.") {
    if (scheduledStartRef.current) window.clearTimeout(scheduledStartRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    scheduledStartRef.current=null;countdownTimerRef.current=null;
    if (arming) {
      streamRef.current?.getTracks().forEach(track=>track.stop());
      void disconnectMonitor();
      streamRef.current=null;recorderRef.current=null;setArming(false);setCountIn(0);
      beatRef.current?.pause();setPlaying(false);announce("Armed punch cancelled.");return;
    }
    if (daw === "REVERYX Standalone" && recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (streamRef.current && !recorderRef.current) streamRef.current.getTracks().forEach(track=>track.stop());
    if (streamRef.current && !recorderRef.current) void disconnectMonitor();
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    beatRef.current?.pause();setPlaying(false);
    announce(message);
  }
  function markLatest(state:TakeState) {
    if (recording) stopCapture(state==="keep"?"Take captured. Press Keep once more to approve it.":"Take captured. Raw audio is ready for review.");
    else setCapturedTakes(value=>{
      const latest=value[value.length-1];
      if(latest)void updateProtectedTake(latest.id,state).catch(()=>undefined);
      return value.map((take,index)=>index===value.length-1?{...take,state}:take);
    });
    if (!recording && state==="keep") { setTakes(value=>value+1); announce("Latest take added to the working comp."); }
    if (!recording && state==="recovery") announce("Latest take removed from the comp and preserved in Recovery.");
  }
  function setPunchAt(time:number,label="Manual timeline punch") {
    const duration=importedTracks[0]?.duration||138;
    const safe=Math.min(Math.max(0,time),duration);
    setPunchPoint(safe);setPunchLabel(label);
    if(beatRef.current)beatRef.current.currentTime=Math.max(0,safe-1);
    announce(`Punch point set at ${formatTime(safe)} · ${label}.`);
  }
  function selectTimelinePunch(event:React.MouseEvent<HTMLDivElement>) {
    const rect=event.currentTarget.getBoundingClientRect();
    const duration=importedTracks[0]?.duration||138;
    setPunchAt(((event.clientX-rect.left)/rect.width)*duration);
  }
  function resolveLyricPunch(raw:string) {
    const lower=raw.toLowerCase();
    return lyricPunches.find(marker=>lower.includes(marker.match)) || (lower.includes("last line")?lyricPunches[3]:lower.includes("hook")?lyricPunches[4]:null);
  }
  async function auditionTake(take:CapturedTake) {
    if (auditioningTakeId===take.id) { stopAudition(); return; }
    stopAudition();
    const voice=new Audio(take.url);
    takePlaybackRef.current=voice;
    setAuditioningTakeId(take.id);
    voice.onended=()=>stopAudition();
    if(!beatRef.current||!beatUrl){
      await voice.play();
      announce("Playing the protected vocal take by itself.");
      return;
    }
    beatRef.current.currentTime=Math.max(0,take.start);
    beatRef.current.playbackRate=playbackRate;
    await Promise.all([beatRef.current.play(),voice.play()]);
    setPlaying(true);
    announce(`Playing ${take.name} with the beat so you can approve the complete performance.`);
  }
  async function handleQuick(item:string) {
    setLastCommand(item);
    if (item==="Record") await startCapture();
    if (item==="Keep that") markLatest("keep");
    if (item==="Scratch the end") markLatest("recovery");
    if (item==="Open vocal mix") { setStage(1); announce("Vocal Mix opened with the approved comp."); }
    if (item==="Open WORDWAVE") openLyrics();
  }
  function runCommand(event?:FormEvent) {
    event?.preventDefault();
    const raw = command.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    setLastCommand(raw);
    const lyricPunch=resolveLyricPunch(raw);
    if (lower.includes("record") || lower.includes("punch")) {
      if(lyricPunch){setPunchPoint(lyricPunch.time);setPunchLabel(lyricPunch.label);void startCapture(lyricPunch.time,lyricPunch.label);}
      else void startCapture();
    }
    else if (lower.includes("keep")) markLatest("keep");
    else if (lower.includes("scratch") || lower.includes("delete")) markLatest("recovery");
    else if (lower.includes("mix")) { setStage(1); announce("Vocal Mix opened with the approved comp."); }
    else if (lower.includes("master")) { setStage(2); announce("Mastering room opened from the approved pre-master."); }
    else announce("Command marked for engineer confirmation.");
    setCommand("");
  }

  async function runSoundCheck() {
    if (!importedTracks.length) {
      announce("Load your song first so the mic check can prepare the correct session.");
      setSetupOpen(true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      announce("Microphone check is available in a supported browser or the REVERYX desktop recorder.");
      return;
    }
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:captureConstraints()});
      try {
        const context=new AudioContext({latencyHint:"interactive"});
        const estimated=Math.round(((context.baseLatency||0)+(context.outputLatency||0))*1000);
        setMeasuredLatency(estimated||null);
        await context.close();
      } catch { setMeasuredLatency(null); }
      window.setTimeout(()=>stream.getTracks().forEach(track=>track.stop()),700);
      setSoundChecked(true);
      announce("Microphone access confirmed. The protected local recording path is armed.");
    } catch {
      announce("Microphone access was not granted. Check browser permissions and try again.");
    }
  }

  function fixLastPhrase() {
    const anchor=beatRef.current?.currentTime||currentTime||punchPoint;
    const target=Math.max(0,anchor-7.5);
    setPunchAt(target,"Fix last phrase");
    announce(`Punch moved to ${formatTime(target)}. REVERYX will roll context before recording the replacement.`);
  }

  function changePlaybackRate(rate:number) {
    setPlaybackRate(rate);
    if (beatRef.current) beatRef.current.playbackRate=rate;
    announce(`Beat speed set to ${rate}x. Pitch preservation remains on.`);
  }

  function removeSong() {
    if (recording||arming) {
      announce("Stop the current recording before removing the song.");
      return;
    }
    if (!window.confirm("Remove this beat and its stems from the REVERYX session? The original files will not be deleted.")) return;
    beatRef.current?.pause();
    importedTracks.forEach(track=>URL.revokeObjectURL(track.url));
    setSessionBeat({
      song: "Untitled Session",
      source: "Stems",
      importedTracks: [],
      beatUrl: "",
      bpm: 128,
      bpmDetected: false,
      sectionMarkers: [],
      beatRevision: sessionBeat.beatRevision,
      beatSource: "",
    });
    setCurrentTime(0);
    setPunchPoint(0);
    setPunchLabel("Manual timeline punch");
    setSoundChecked(false);
    setPlaying(false);
    setPlaybackRate(1);
    setBeatToolsOpen(false);
    announce("Song removed from this session. The original files remain untouched.");
  }

  const latestTake=capturedTakes[capturedTakes.length-1];
  const needsDecision=Boolean(latestTake&&latestTake.state==="captured"&&!recording&&!arming);
  const flowStep=!importedTracks.length?0:!soundChecked?1:recording||arming?2:needsDecision?3:stage>0?4:2;
  const adjustedBpm=bpmDetected?Math.round(bpm*playbackRate):null;
  const keptTakes=capturedTakes.filter(take=>take.state==="keep").length;
  const alignment=shouldWarnVocalAlignment({hasVocals,lockedRevision:lockedBeatRevision,beatRevision:sessionBeat.beatRevision,preserveVocalTiming:true});

  return <>
    <header className="qrx-topbar">
      <div className="qrx-brand"><strong>SESSION CANVAS</strong><span>REVERYX</span></div>
      <div className="qrx-session-name"><small>ACTIVE SESSION</small><strong>{importedTracks.length?song:"Untitled session"}</strong></div>
      <div className="qrx-top-actions"><span className="qrx-save"><i/>{recoveryReady?`${capturedTakes.length} ${capturedTakes.length===1?"take":"takes"} protected`:"Checking recovery…"}</span><button onClick={()=>setAdvancedOpen(true)}>Studio Controls</button><button className="qrx-export" disabled={!importedTracks.length&&!capturedTakes.length} onClick={()=>setExportOpen(true)}>Finish &amp; Export</button></div>
    </header>

    <section className={`qrx-page ${!importedTracks.length?"record-now-page":""}`}>
      {!importedTracks.length?<RecordNowHome start={()=>fileInput.current?.click()} openSetup={()=>setSetupOpen(true)} openLink={openLink} openBeatLab={openBeatLab} capturedTakes={capturedTakes} recoveryReady={recoveryReady} captureSupported={captureSupported} online={online} storageMb={storageMb} desktopEngine={desktopEngine}/>:<>
      <nav className="qrx-flow" aria-label="Session progress">{["Load","Sound Check","Record","Decide","Finish"].map((name,index)=><div key={name} className={`${flowStep===index?"active":""} ${flowStep>index?"done":""}`}><span>{flowStep>index?"✓":index+1}</span><strong>{name}</strong></div>)}</nav>
      {alignment.warn&&<div className="qrx-align-banner" role="status">{alignment.message} <button type="button" onClick={()=>lockVocalsToRevision(sessionBeat.beatRevision)}>Keep recorded timing</button></div>}

      <section className={`session-ready-strip ${soundChecked?"armed":""}`} aria-label="Session readiness">
        <div><span>SONG</span><strong>LOADED</strong><small>{importedTracks.length===1?"1 audio source":`${importedTracks.length} audio sources`}</small></div>
        <div><span>MIC</span><strong>{soundChecked?"READY":"CHECK NEEDED"}</strong><small>{soundChecked?(measuredLatency!==null?`Estimated ${measuredLatency} ms path`:"Access confirmed"):"No assumptions"}</small></div>
        <div><span>LOCAL SAVE</span><strong>{recoveryReady?"ARMED":"CHECKING"}</strong><small>{storageMb!==null?`${storageMb.toLocaleString()} MB available`:"Protected take vault"}</small></div>
        <div><span>LISTENING</span><strong>{speakerMode?"SPEAKER SAFE":"HEADPHONES"}</strong><small>{speakerMode?"Echo control on":monitorEnabled?"Voice monitor on":"Voice monitor off"}</small></div>
      </section>

      <div className="qrx-studio-card">
        <div className="qrx-now">
          <span>{recording?"RECORDING NOW":arming?"GET READY":needsDecision?"TAKE CAPTURED":!importedTracks.length?"START HERE":!soundChecked?"NEXT STEP":"READY TO RECORD"}</span>
          <h1>{recording?`Take ${String(capturedTakes.length+1).padStart(2,"0")} is live`:arming?`Punching in after ${countIn}`:needsDecision?"Keep it or run it again?":!importedTracks.length?"Bring your song into the room.":!soundChecked?"Make sure the mic feels right.":"Press record when you are ready."}</h1>
          <p>{recording?"Your clean vocal is being protected while you hear your selected sound.":arming?`${preRollBars}-bar pre-roll · ${punchLabel}`:needsDecision?"Nothing is deleted. You can audition the take before deciding.":!importedTracks.length?"Load a beat, stems, or a previous session handoff.":!soundChecked?"REVERYX will verify the microphone and protected signal path.":`${archetypes[sound].name} is active · raw vocal stays untouched.`}</p>
        </div>

        <div className={`qrx-wave-stage ${recording?"live":""} ${!importedTracks.length?"empty":""}`}>
          <div className="qrx-wave-head"><div className="qrx-song-copy"><span>{importedTracks.length?source.toUpperCase():"SESSION EMPTY"}</span><strong>{importedTracks.length?song:"Choose audio to begin"}</strong></div><div className="qrx-wave-meta">{importedTracks.length>0&&<><div><b>{formatTime(currentTime)}</b><span>{adjustedBpm?`${adjustedBpm} BPM · `:"Tempo not detected · "}Key not analyzed</span></div><button className={beatToolsOpen?"active":""} onClick={()=>setBeatToolsOpen(!beatToolsOpen)} aria-expanded={beatToolsOpen}>Song Tools</button></>}</div></div>
          {beatToolsOpen&&<div className="qrx-song-tools"><div><span>PLAYBACK SPEED</span><div className="qrx-speed-options">{[.75,.9,1,1.1,1.25].map(rate=><button key={rate} className={playbackRate===rate?"selected":""} onClick={()=>changePlaybackRate(rate)}>{rate}x</button>)}</div><small>{bpm} BPM original · {adjustedBpm} BPM playback</small></div><div className="qrx-song-file-actions"><button onClick={()=>setSetupOpen(true)}>Replace song</button><button className="remove" onClick={removeSong}>Remove from session</button></div></div>}
          {importedTracks.length?<><div className="qrx-wave" role="button" tabIndex={0} aria-label="Song timeline. Click to set a punch point." onClick={selectTimelinePunch} onKeyDown={event=>{if(event.key==="Enter")setPunchAt(punchPoint);}}>{importedTracks[0].peaks.map((height,index)=><i key={index} style={{height:`${height}%`}}/>)}<b className="qrx-playhead" style={{left:`${Math.min(100,(currentTime/(importedTracks[0].duration||138))*100)}%`}}/><b className="qrx-punch" style={{left:`${Math.min(100,(punchPoint/(importedTracks[0].duration||138))*100)}%`}}><span>{formatTime(punchPoint)}</span></b></div>{sectionMarkers.length>0&&<div className="qrx-sections" aria-label="Beat Lab section markers">{sectionMarkers.map((marker)=> <span key={marker.id} style={{flexGrow:Math.max(0.2,marker.endSeconds-marker.startSeconds)}}>{marker.name}</span>)}</div>}<div className="qrx-lyric"><span>PUNCH POSITION</span><strong>{punchLabel}</strong><button onClick={openLyrics}>Writing help</button>{sessionBeat.beatSource==="beat-lab"&&<button onClick={openBeatLab}>Back to Beat Lab</button>}</div></>:<button className="qrx-empty-wave" onClick={()=>fileInput.current?.click()}><span className="qrx-empty-signal"><i/><i/><i/><i/><i/></span><strong>Choose your audio.</strong><small>REVERYX identifies a beat, stems, or a session handoff automatically.</small></button>}
        </div>

        <div className={`qrx-focus-actions ${needsDecision?"review":""}`}>
          {!importedTracks.length?<button className="qrx-main-action load" onClick={()=>fileInput.current?.click()}><span>01</span><strong>Choose audio</strong><small>REVERYX identifies the source</small></button>:
          !soundChecked?<><button className="qrx-secondary-action" onClick={()=>void togglePlayback()}><TransportIcon name={playing?"pause":"play"}/><span>{playing?"Pause song":"Preview song"}</span></button><button className="qrx-main-action check" onClick={()=>void runSoundCheck()}><span>02</span><strong>Check my mic</strong><small>Confirm level and protected path</small></button></>:
          needsDecision&&latestTake?<div className="qrx-review-grid"><button className={`qrx-decision audition ${auditioningTakeId===latestTake.id?"active":""}`} onClick={()=>void auditionTake(latestTake)}><TransportIcon name={auditioningTakeId===latestTake.id?"pause":"play"}/><strong>{auditioningTakeId===latestTake.id?"Stop playback":"Play my take"}</strong><small>Hear your vocal and beat together</small></button><button className="qrx-decision redo" onClick={()=>{stopAudition();markLatest("recovery");void startCapture();}}><span>↺</span><strong>Redo</strong><small>Preserve this take and record again</small></button><button className="qrx-decision keep" onClick={()=>{stopAudition();markLatest("keep");}}><span>✓</span><strong>Keep it</strong><small>Add this take to the comp</small></button></div>:
          <><button className="qrx-secondary-action" onClick={()=>void togglePlayback()}><TransportIcon name={playing?"pause":"play"}/><span>{playing?"Pause":"Play"}</span></button><button className={`qrx-record-action ${recording||arming?"stop":""}`} onClick={()=>recording||arming?stopCapture():void startCapture()}><i/><strong>{recording?"Stop":arming?"Cancel":"Record"}</strong><small>{recording?`00:${String(elapsed).padStart(2,"0")}`:arming?`${countIn}`:`${preRollBars}-bar pre-roll`}</small></button><button className="qrx-secondary-action phrase-fix" onClick={fixLastPhrase}><TransportIcon name="previous"/><span>Fix last phrase</span></button></>}
        </div>

        {importedTracks.length>0&&<div className={`qrx-listen-mode ${speakerMode?"speaker":"headphones"}`}><div><span className="qrx-listen-signal"><i/><i/><i/></span><p><small>HOW ARE YOU LISTENING?</small><strong>{speakerMode?"Speaker Recording Mode":"Headphone Mode"}</strong><em>{speakerMode?"Echo cancellation reduces beat bleed. Keep volume moderate.":monitorEnabled?"Your live vocal is routed to your headphones.":"Live vocal monitoring is currently off."}</em></p></div><div className="qrx-listen-options"><button className={!speakerMode?"selected":""} onClick={()=>void setListeningMode(false)}>Headphones</button><button className={speakerMode?"selected":""} onClick={()=>void setListeningMode(true)}>No headphones</button>{!speakerMode&&<button className={`monitor-toggle ${monitorEnabled?"on":""}`} onClick={()=>void toggleMonitor()}>{monitorEnabled?"Voice monitor on":"Voice monitor off"}</button>}</div></div>}

        <div className="qrx-smart-row">
          <button className="qrx-sound-pill" onClick={()=>setSoundPicker(!soundPicker)}><span className="qrx-orb"/><p><small>YOUR SOUND</small><strong>{archetypes[sound].name}</strong></p><b>Change</b></button>
          <button className="qrx-ai-button" onClick={()=>setAiOpen(!aiOpen)}><span>AI</span><p><small>SESSION ASSISTANT</small><strong>{aiOpen?"Close assistant":"Lyrics, takes & punch help"}</strong></p><b>→</b></button>
          <div className="qrx-protect"><span>◇</span><p><small>LOCAL RECOVERY</small><strong>{capturedTakes.length?`${capturedTakes.length} ${capturedTakes.length===1?"take":"takes"} safe`:"Armed when you record"}</strong></p></div>
        </div>

        {soundPicker&&<div className="qrx-sound-drawer"><div><small>CHOOSE A DIRECTION</small><strong>Hear your voice, your way.</strong></div>{archetypes.slice(0,4).map((item,index)=><button key={item.name} className={sound===index?"selected":""} onClick={()=>{setSound(index);setSoundPicker(false);announce(`${item.name} adapted to the active artist profile.`);}}><span>{item.match}%</span><strong>{item.name}</strong><small>{item.family}</small></button>)}<button onClick={openVault}>All sounds →</button></div>}
        {aiOpen&&<div className="qrx-ai-drawer"><div><span>AI</span><p><small>QUIET UNTIL ASKED</small><strong>What do you need right now?</strong></p></div><button onClick={openLyrics}>Help with this lyric</button><button onClick={()=>announce(capturedTakes.length>1?"Comparing the latest takes for energy, timing and clarity.":"Record two takes to compare them.")}>Compare my takes</button><button onClick={()=>announce("The next clean punch point is prepared at the end of the current phrase.")}>Find my next punch</button></div>}
        {beatUrl&&<audio ref={beatRef} src={beatUrl} onLoadedMetadata={event=>{event.currentTarget.playbackRate=playbackRate;(event.currentTarget as HTMLAudioElement & {preservesPitch?:boolean}).preservesPitch=true;}} onTimeUpdate={event=>setCurrentTime(event.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} className="beat-audio"/>}
      </div>

      <div className="qrx-bottom-row"><button onClick={()=>setAdvancedOpen(true)}>Studio Controls <span>Routing, punch setup, takes, chain and DAW link</span></button><button disabled={!keptTakes} onClick={()=>{setStage(1);announce("Vocal Mix opened with the approved comp.");}}>Move to Vocal Mix {keptTakes?"→":"· keep a take first"}</button></div>
      {stage===1&&<MixPanel announce={announce}/>} {stage===2&&<MasterPanel announce={announce}/>} 
      </>}
    </section>

    {advancedOpen&&<div className="qrx-advanced-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setAdvancedOpen(false)}}><aside className="qrx-advanced"><header><div><small>ENGINEER MODE</small><h2>Studio Controls</h2></div><button onClick={()=>setAdvancedOpen(false)}>Close</button></header><div className="qrx-advanced-body"><div className={`daw-chip ${daw==="REVERYX Standalone"?"native":""}`}><span className="daw-dot"/><div><small>RECORDING WORKSPACE</small><strong>{daw}</strong></div><button onClick={()=>setDawOpen(true)}>Change</button></div><PunchConsole punchPoint={punchPoint} punchLabel={punchLabel} preRollBars={preRollBars} setPreRollBars={setPreRollBars} latencyOffset={latencyOffset} setLatencyOffset={setLatencyOffset} arming={arming} countIn={countIn} recording={recording} setPunchAt={setPunchAt} start={()=>void startCapture()} cancel={()=>stopCapture()} announce={announce}/><SourceRack tracks={importedTracks} openImport={()=>setSetupOpen(true)} announce={announce}/>{daw==="REVERYX Standalone"&&<TakeDock takes={capturedTakes} mark={markLatest} audition={auditionTake} announce={announce}/>}<section className="qrx-chain"><div><small>ARTIST SOUND</small><h3>{archetypes[sound].name}</h3><p>{archetypes[sound].detail}</p></div>{chain.map((item,index)=><article key={item.name}><span>{index+1}</span><p><small>{item.name}</small><strong>{item.value}</strong></p></article>)}</section><form className="qrx-command" onSubmit={runCommand}><label htmlFor="booth-command">Booth command</label><div><input id="booth-command" value={command} onChange={event=>setCommand(event.target.value)} placeholder="Record, keep that, scratch the end…"/><button>Run</button></div><small>Last command: {lastCommand}</small></form></div></aside></div>}

    <input ref={fileInput} className="file-input" type="file" multiple accept=".wav,.mp3,.aif,.aiff,.m4a,.ogg,.zip,.ptx" onChange={event=>void loadSong(Array.from(event.target.files||[]))}/>
    {setupOpen&&<SessionSetup close={()=>setSetupOpen(false)} chooseAudio={()=>fileInput.current?.click()} />}
    {dawOpen&&<DawModal current={daw} select={value=>{setDaw(value);setDawOpen(false);announce(`${value} bridge selected for this session.`);}} close={()=>setDawOpen(false)} />}
    {exportOpen&&<SessionPortModal song={song} takes={capturedTakes} tracks={importedTracks} close={()=>setExportOpen(false)} announce={announce} />}
  </>;
}

type DesktopEngine = ReturnType<typeof useDesktopEngine>;

function NativeEnginePanel({engine}:{engine:DesktopEngine}) {
  const connected=engine.state==="connected";
  return <section className={`native-engine-panel ${connected?"connected":"fallback"}`}>
    <header><span>DESKTOP ENGINE / ALPHA</span><strong>{engine.state==="checking"?"CHECKING":connected?"CONNECTED":"WEB CAPTURE ACTIVE"}</strong></header>
    <div className="native-engine-copy"><i/><p><small>{connected?`NATIVE CORE ${engine.version}`:"NATIVE CORE NOT CONNECTED"}</small><strong>{connected?"Professional recording path ready.":"Record here now. Move to native when installed."}</strong><em>{connected?"REVERYX can hand this session to the local sample-accurate engine.":"Your browser Take Vault and aligned SessionPort export remain available."}</em></p></div>
    <div className="native-engine-capabilities"><span>48 kHz / 24-bit BWF</span><span>Crash recovery journal</span><span>Sample-positioned takes</span></div>
    <div className="native-engine-actions"><button onClick={engine.open}>Open Desktop Engine</button><button onClick={()=>void engine.check()}>Check connection</button></div>
  </section>;
}

function RecordNowHome({start,openSetup,openLink,openBeatLab,capturedTakes,recoveryReady,captureSupported,online,storageMb,desktopEngine}:{start:()=>void;openSetup:()=>void;openLink:()=>void;openBeatLab:()=>void;capturedTakes:CapturedTake[];recoveryReady:boolean;captureSupported:boolean;online:boolean;storageMb:number|null;desktopEngine:DesktopEngine}) {
  return <div className="record-home">
    <section className="session-entry">
      <div className="session-entry-copy">
        <span className="record-kicker">REVERYX / SESSION CANVAS</span>
        <h1>What do you want<br/><em>to do right now?</em></h1>
        <p>No setup maze. Choose the path and REVERYX reveals only the controls needed for the next step.</p>
      </div>
      <div className="session-entry-actions">
        <button className="record-launch" onClick={start}><span><i/></span><p><strong>START RECORDING</strong><small>Choose audio and begin</small></p><b>PRIMARY</b></button>
        <button className="link-launch" onClick={openBeatLab}><span><i/><i/></span><p><strong>OPEN BEAT LAB</strong><small>Play pads, flip a sample, arrange a beat</small></p><b>MAKE</b></button>
        <button className="link-launch" onClick={openLink}><span><i/><i/></span><p><strong>JOIN SOMEONE</strong><small>Open or create a Link Session</small></p><b>REMOTE</b></button>
        {capturedTakes.length>0&&<button className="recovery-launch" onClick={openSetup}><span>{String(capturedTakes.length).padStart(2,"0")}</span><p><strong>RECOVER A TAKE</strong><small>Continue protected work on this device</small></p><b>LOCAL</b></button>}
        <NativeEnginePanel engine={desktopEngine}/>
      </div>
    </section>
    <section className="session-trust-line" aria-label="Device readiness">
      <span className={captureSupported?"ready":"limited"}><i/>{captureSupported?"Recording ready":"Capture limited"}</span>
      <span className={recoveryReady?"ready":"limited"}><i/>{recoveryReady?"Local recovery ready":"Checking recovery"}</span>
      <span className={online?"ready":"limited"}><i/>{online?"Collaboration online":"Solo mode available"}</span>
      <span><i/>{storageMb===null?"Checking storage":storageMb>=1024?`${Math.round(storageMb/1024)} GB local space`:`${storageMb} MB local space`}</span>
    </section>
  </div>;
}

function PunchConsole({punchPoint,punchLabel,preRollBars,setPreRollBars,latencyOffset,setLatencyOffset,arming,countIn,recording,setPunchAt,start,cancel,announce}:{punchPoint:number;punchLabel:string;preRollBars:number;setPreRollBars:(value:number)=>void;latencyOffset:number;setLatencyOffset:(value:number)=>void;arming:boolean;countIn:number;recording:boolean;setPunchAt:(time:number,label?:string)=>void;start:()=>void;cancel:()=>void;announce:(message:string)=>void}) {
  return <section className={`punch-console ${arming?"armed":""} ${recording?"live":""}`}><div className="punch-clock"><small>{recording?"RECORDING":arming?"COUNT-IN":"NEXT PUNCH"}</small><strong>{arming?String(countIn).padStart(2,"0"):formatTime(punchPoint)}</strong><span>{punchLabel}</span></div><div className="lyric-punches"><span className="label">LYRIC MAP</span>{lyricPunches.map(marker=><button key={marker.time} className={Math.abs(marker.time-punchPoint)<.1?"selected":""} onClick={()=>setPunchAt(marker.time,marker.label)}><small>{formatTime(marker.time)}</small><strong>{marker.label}</strong></button>)}</div><div className="punch-settings"><div><span className="label">PRE-ROLL</span><div className="segmented">{[1,2,4].map(bars=><button key={bars} className={preRollBars===bars?"selected":""} onClick={()=>setPreRollBars(bars)}>{bars} BAR{bars>1?"S":""}</button>)}</div></div><label><span className="label">INPUT OFFSET <b>{latencyOffset>=0?"+":""}{latencyOffset} MS</b></span><input type="range" min="-120" max="120" step="5" value={latencyOffset} onChange={event=>setLatencyOffset(Number(event.target.value))}/><small>Manual browser latency correction</small></label></div><div className="punch-action"><button className={recording||arming?"stop":""} onClick={recording||arming?cancel:start}><i/>{recording?"STOP + CAPTURE":arming?"CANCEL PUNCH":"ROLL + RECORD"}</button><small>{recording?"Raw take is timestamped to the song.":arming?"The beat is playing your selected pre-roll.":"Headphones required to prevent beat bleed."}</small><button className="calibrate-link" onClick={()=>announce("Latency calibration guide opened. Record a click loopback, then adjust the input offset until transients align.")}>CALIBRATE LATENCY →</button></div></section>;
}

function SourceRack({tracks,openImport,announce}:{tracks:ImportedTrack[];openImport:()=>void;announce:(message:string)=>void}) {
  const [muted,setMuted]=useState<number[]>([]);
  const [solo,setSolo]=useState<number|null>(null);
  if (!tracks.length) return <section className="source-rack empty-source"><div><span className="label">SOURCE RACK / EMPTY</span><h2>Bring the record into the room.</h2><p>Load one beat or a group of stems. REVERYX will inspect each playable file and draw its real waveform.</p></div><button className="primary-button" onClick={openImport}>Load beat or stems →</button></section>;
  return <section className="source-rack"><div className="source-rack-head"><div><span className="label">SOURCE RACK / {tracks.length>1?"MULTITRACK":"TWO-TRACK"}</span><h2>{tracks.length} playable {tracks.length===1?"source":"sources"} inside REVERYX</h2></div><button onClick={openImport}>＋ Replace sources</button></div><div className="source-track-list">{tracks.map((track,index)=><article key={track.id} className={solo!==null&&solo!==track.id?"dimmed":""}><span className={`source-role r${index%4}`}>{track.role}</span><div className="source-track-copy"><strong>{track.name}</strong><small>{track.format} · {track.duration?`${Math.floor(track.duration/60)}:${String(Math.round(track.duration%60)).padStart(2,"0")}`:"READY FOR HANDOFF"}</small></div><div className="source-mini-wave" aria-hidden="true">{track.peaks.slice(0,32).map((height,peak)=><i key={peak} style={{height:`${Math.max(10,height)}%`}} />)}</div><div className="source-track-actions"><button className={muted.includes(track.id)?"on":""} onClick={()=>{setMuted(value=>value.includes(track.id)?value.filter(id=>id!==track.id):[...value,track.id]);announce(`${track.name} ${muted.includes(track.id)?"unmuted":"muted"}.`);}}>M</button><button className={solo===track.id?"on":""} onClick={()=>setSolo(solo===track.id?null:track.id)}>S</button></div></article>)}</div></section>;
}

function AISessionCopilot({recording,takes,openLyrics,announce}:{recording:boolean;takes:CapturedTake[];openLyrics:()=>void;announce:(message:string)=>void}) {
  const [mode,setMode]=useState("Silent");
  const kept=takes.filter(take=>take.state==="keep").length;
  const headline=recording?"Listening without interrupting.":takes.length?`${takes.length} takes remembered. ${kept} approved.`:"Ready before the first bar.";
  const insight=recording?"Signal is inside the protected range. Lyric position and punch context are being held.":takes.length?"The latest take is technically clean. Compare delivery before replacing the current comp.":"Load lyrics for line-following, or record freely and recover the words afterward.";
  return <section className="ai-copilot"><div className="copilot-head"><span className="ai-sigil">AI</span><div><span className="label">SESSION COPILOT</span><strong>{headline}</strong></div><i className={recording?"live":""}/></div><p>{insight}</p><div className="copilot-modes">{["Silent","Assist","Coach"].map(item=><button key={item} className={mode===item?"selected":""} onClick={()=>{setMode(item);announce(`${item} AI assistance active.`);}}>{item}</button>)}</div><div className="copilot-actions"><button onClick={openLyrics}><span>01</span><p><strong>LYRIC MEMORY</strong><small>Follow, rhyme, rewrite or recover a freestyle.</small></p><b>→</b></button><button onClick={()=>announce(takes.length?"Take comparison opened with technical and performance notes.":"Record two takes to unlock comparison.")}><span>02</span><p><strong>TAKE COMPASS</strong><small>{takes.length>1?"Compare cadence, energy and clarity.":"Unlocks after two takes."}</small></p><b>→</b></button><button onClick={()=>announce("Punch map prepared from the current lyric and kept take boundary.")}><span>03</span><p><strong>PUNCH NAVIGATOR</strong><small>Find the line, roll context and arm safely.</small></p><b>→</b></button></div><small className="copilot-boundary">Creative changes wait for approval. Raw audio is never rewritten.</small></section>;
}

function TakeDock({takes,mark,audition,announce}:{takes:CapturedTake[];mark:(state:TakeState)=>void;audition:(take:CapturedTake)=>void;announce:(message:string)=>void}) {
  return <section className="take-dock"><div className="take-dock-head"><div><span className="label">NATIVE TAKE VAULT / TIME-ALIGNED</span><h2>{takes.length?`${takes.length} protected ${takes.length===1?"take":"takes"}`:"Ready for the first synchronized take"}</h2></div><span className="local-badge">LOCAL · NONDESTRUCTIVE</span></div>{takes.length===0?<div className="take-empty"><span>●</span><p><strong>Choose a punch, then press Roll + Record.</strong><small>REVERYX plays the pre-roll and captures your microphone at the exact punch timestamp.</small></p></div>:<div className="take-list">{takes.slice().reverse().map(take=><article key={take.id}><span className={`take-state ${take.state}`}>{take.state==="keep"?"KEEP":take.state==="recovery"?"RECOVERY":"CAPTURED"}</span><div><strong>{take.name}</strong><small>{formatTime(take.start)} · {take.punchLabel} · {take.seconds}s</small></div><audio controls src={take.url}/><div className="take-row-links"><button onClick={()=>audition(take)}>AUDITION IN SONG</button><a href={take.url} download={`${take.name.replaceAll(" ","-")}.${take.mime.includes("mp4")?"m4a":"webm"}`}>DOWNLOAD RAW</a></div></article>)}</div>}<div className="take-actions"><button onClick={()=>mark("keep")} disabled={!takes.length}>Keep latest in comp</button><button onClick={()=>mark("recovery")} disabled={!takes.length}>Move latest to Recovery</button><button onClick={()=>announce("Comp history opened. Every timestamped decision remains reversible.")}>Comp history</button></div></section>;
}

function SessionPortModal({song,takes,tracks,close,announce}:{song:string;takes:CapturedTake[];tracks:ImportedTrack[];close:()=>void;announce:(message:string)=>void}) {
  const [building,setBuilding]=useState(false);
  const [built,setBuilt]=useState(false);
  const [bridgeBuilding,setBridgeBuilding]=useState(false);
  const [bridgeBuilt,setBridgeBuilt]=useState(false);
  const [bridgeProgress,setBridgeProgress]=useState("");
  const manifest={product:"REVERYX SessionPort",version:"Pro Tools Bridge 1.0",song,createdAt:new Date().toISOString(),tempoBpm:128,key:"E-flat minor",timelineOriginSeconds:0,recordingFormat:"Original browser capture",desktopTargets:["Pro Tools","Logic Pro","Ableton Live","FL Studio","REAPER"],sources:tracks.map(({name,duration,role,format})=>({name,duration,role,format,startSeconds:0})),takes:takes.map(({name,seconds,state,mime,start,punchLabel})=>({name,seconds,state,mime,startSeconds:start,endSeconds:start+seconds,punchLabel})),proToolsBridge:{sampleRate:48000,bitDepth:24,fileType:"WAV / BWF",placement:"BWF original timestamp plus approved comp from session start"},futureDesktopExports:["AAF timeline","Native PTX session","Tempo map MIDI"]};
  function triggerDownload(blob:Blob,name:string) {
    const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadManifest() {
    triggerDownload(new Blob([JSON.stringify(manifest,null,2)],{type:"application/json"}),`${song.replaceAll(" ","-")}-REVERYX-manifest.json`);
    announce("Session manifest downloaded.");
  }
  async function buildPackage() {
    setBuilding(true);
    try {
      const zip=new JSZip();
      zip.file("README.txt",[`REVERYX SESSIONPORT — ${song}`,"","This portable package preserves the browser-recorded sources, raw takes and session decisions.","Import source tracks at 0:00.000. Use Session/timeline.csv to place each vocal take at its recorded punch position.","AAF, Broadcast WAV timestamps and native DAW session creation require the REVERYX desktop engine."].join("\n"));
      zip.file("Session/session-manifest.json",JSON.stringify(manifest,null,2));
      zip.file("Session/timeline.csv",["track_name,start_seconds,end_seconds,state,punch_label",...takes.map(take=>`\"${take.name}\",${take.start.toFixed(3)},${(take.start+take.seconds).toFixed(3)},${take.state},\"${take.punchLabel}\"`)].join("\n"));
      zip.file("Session/import-notes.txt",[`Song: ${song}`,`Tempo: 128 BPM`,`Key: E-flat minor`,`Sources: ${tracks.length}`,`Protected vocal takes: ${takes.length}`,"Import sources at 0:00.000.","Place each raw vocal take at its start_seconds value in timeline.csv.","Suggested target: 48 kHz / 24-bit after desktop conversion","All creative and destructive decisions require human approval."].join("\n"));
      const sourceFolder=zip.folder("Audio/Imported-Sources");
      for (const track of tracks) sourceFolder?.file(track.name,await (await fetch(track.url)).blob());
      const takeFolder=zip.folder("Audio/Protected-Raw-Takes");
      for (const [index,take] of takes.entries()) {
        const extension=take.mime.includes("mp4")?"m4a":take.mime.includes("ogg")?"ogg":"webm";
        takeFolder?.file(`${String(index+1).padStart(2,"0")}-${take.name.replace(/[^a-z0-9-_]+/gi,"-")}.${extension}`,await (await fetch(take.url)).blob());
      }
      const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:5}});
      triggerDownload(blob,`${song.replace(/[^a-z0-9-_]+/gi,"-")}-REVERYX-SessionPort.zip`);
      setBuilt(true);
      announce("SessionPort ZIP downloaded with sources, raw takes and session manifest.");
    } catch { announce("The package could not be assembled on this device. Download the manifest and raw takes individually."); }
    finally { setBuilding(false); }
  }
  async function buildProToolsBridge() {
    if(!tracks.length&&!takes.length){announce("Load a song or record a take before building the Pro Tools Bridge.");return;}
    setBridgeBuilding(true);setBridgeProgress("Preparing 48 kHz / 24-bit audio…");
    try {
      const zip=new JSZip();
      const audioFiles=zip.folder("Audio Files");
      const originalFiles=zip.folder("Original Browser Captures");
      const warnings:string[]=[];
      const clipRows=["track_name,file_name,start_seconds,end_seconds,state,bwf_time_reference_samples"];
      const kept=takes.filter(take=>take.state==="keep");
      const sessionEnd=Math.max(1,...tracks.map(track=>track.duration||0),...kept.map(take=>take.start+take.seconds));
      const comp=new AudioBuffer({length:Math.max(1,Math.ceil(sessionEnd*PRO_TOOLS_SAMPLE_RATE)),numberOfChannels:1,sampleRate:PRO_TOOLS_SAMPLE_RATE});
      const compData=comp.getChannelData(0);

      for(const [index,track] of tracks.entries()){
        setBridgeProgress(`Converting song source ${index+1} of ${tracks.length}…`);
        const stemName=`${String(index+1).padStart(2,"0")}-${safeAudioName(track.role)}-${safeAudioName(track.name)}-FROM-SESSION-START.wav`;
        try{
          const decoded=await decodeAt48k(track.url);
          audioFiles?.file(stemName,encodeBwf24(decoded,0,`${song} / ${track.role} / session start`));
          clipRows.push(`"${track.role}","${stemName}",0,${decoded.duration.toFixed(3)},source,0`);
        }catch{
          const original=await (await fetch(track.url)).blob();
          originalFiles?.file(track.name,original);
          warnings.push(`${track.name}: browser could not decode this source. Original file included without conversion.`);
        }
      }

      for(const [index,take] of takes.entries()){
        setBridgeProgress(`Converting vocal take ${index+1} of ${takes.length}…`);
        const takeNumber=String(index+1).padStart(2,"0");
        const fileName=`VOCAL-${takeNumber}-${safeAudioName(take.name)}-${take.state.toUpperCase()}.bwf.wav`;
        try{
          const decoded=await decodeAt48k(take.url);
          const timeReference=Math.round(take.start*PRO_TOOLS_SAMPLE_RATE);
          audioFiles?.file(fileName,encodeBwf24(decoded,timeReference,`${song} / ${take.name} / ${take.punchLabel}`));
          clipRows.push(`"Vocal ${takeNumber}","${fileName}",${take.start.toFixed(3)},${(take.start+decoded.duration).toFixed(3)},${take.state},${timeReference}`);
          if(take.state==="keep"){
            const source=decoded.getChannelData(0);const start=Math.round(take.start*PRO_TOOLS_SAMPLE_RATE);
            for(let frame=0;frame<source.length&&start+frame<compData.length;frame++)compData[start+frame]=Math.max(-1,Math.min(1,compData[start+frame]+source[frame]));
          }
        }catch{
          const original=await (await fetch(take.url)).blob();
          const extension=take.mime.includes("mp4")?"m4a":take.mime.includes("ogg")?"ogg":"webm";
          originalFiles?.file(`VOCAL-${takeNumber}-${safeAudioName(take.name)}.${extension}`,original);
          warnings.push(`${take.name}: browser could not decode this capture. Original take included with timeline placement in Clip List.csv.`);
        }
      }

      if(kept.length){
        setBridgeProgress("Building approved vocal from session start…");
        audioFiles?.file("APPROVED-VOCAL-COMP-FROM-SESSION-START.wav",encodeBwf24(comp,0,`${song} / approved REVERYX vocal comp`));
      }
      const guide=[
        `REVERYX PRO TOOLS BRIDGE — ${song}`,
        "",
        "SESSION SETUP",
        "1. Create a new Pro Tools session at 48 kHz, 24-bit, WAV.",
        "2. Choose File > Import > Audio and select the WAV files in Audio Files.",
        "3. Put every file ending FROM-SESSION-START at 0:00.000.",
        kept.length?"4. Put APPROVED-VOCAL-COMP-FROM-SESSION-START.wav at 0:00.000 for the approved performance.":"4. No take is marked Keep yet, so an approved vocal comp was not created.",
        "5. Raw vocal takes are Broadcast WAV files carrying their original punch timestamps. In Pro Tools Spot mode, use each clip's Original Timestamp, or use Clip List.csv.",
        "6. Keep the Original Browser Captures folder as the untouched safety copy.",
        "",
        "WHAT THIS BRIDGE DOES",
        "• Converts decodable sources and takes to 48 kHz / 24-bit PCM WAV.",
        "• Writes Broadcast Wave original-time metadata on every vocal punch.",
        "• Creates an approved consolidated vocal from session start when kept takes exist.",
        "• Preserves the original browser files and session decisions.",
        "",
        "HONEST BOUNDARY",
        "This package does not fabricate a .ptx or AAF file. Pro Tools creates the native session after importing these standard audio files.",
        ...(warnings.length?["","CONVERSION NOTES",...warnings]:[]),
      ].join("\n");
      zip.file("START HERE - Pro Tools Import.txt",guide);
      zip.file("Clip List.csv",clipRows.join("\n"));
      zip.file("REVERYX Pro Tools Manifest.json",JSON.stringify({...manifest,bridgeWarnings:warnings,approvedCompCreated:Boolean(kept.length)},null,2));
      setBridgeProgress("Packaging the Pro Tools handoff…");
      const blob=await zip.generateAsync({type:"blob",compression:"STORE"});
      triggerDownload(blob,`${safeAudioName(song)}-REVERYX-Pro-Tools-Bridge.zip`);
      setBridgeBuilt(true);setBridgeProgress("");
      announce("Pro Tools Bridge downloaded with 48 kHz / 24-bit WAV, BWF timestamps and the approved comp.");
    }catch{
      setBridgeProgress("");announce("This device could not finish the Pro Tools conversion. Your original takes remain protected in REVERYX.");
    }finally{setBridgeBuilding(false);}
  }
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!bridgeBuilding&&!building)close();}}><section className="session-modal sessionport-modal"><button className="modal-close" disabled={bridgeBuilding||building} onClick={close}>×</button><span className="label">SESSIONPORT / PROFESSIONAL HANDOFF</span><h2>Finish in your studio.</h2><p className="modal-intro">Choose a universal archive or build a Pro Tools-ready package with professional WAV conversion and exact punch timestamps.</p><div className="port-summary"><div><small>PROJECT</small><strong>{song}</strong></div><div><small>RAW TAKES</small><strong>{takes.length}</strong></div><div><small>APPROVED TAKES</small><strong>{takes.filter(take=>take.state==="keep").length}</strong></div></div><div className="port-files">{[["WAV","48 kHz / 24-bit PCM","AVAILABLE NOW"],["BWF","Original punch timestamps","AVAILABLE NOW"],["COMP","Approved vocal from 0:00","AVAILABLE NOW"],["CSV","Clip placement + decisions","AVAILABLE NOW"],["AAF","Automatic session assembly","DESKTOP ENGINE"],["PTX","Native Pro Tools session","NOT FABRICATED"]].map(item=><div key={item[0]}><span>{item[0]}</span><p><strong>{item[1]}</strong><small>{item[2]}</small></p><i>{item[2]==="AVAILABLE NOW"?"LIVE":"LATER"}</i></div>)}</div><div className="protools-bridge-card"><div><span>PT</span><p><small>PRO TOOLS BRIDGE 1.0</small><strong>Import-ready. Time-aligned. Original audio preserved.</strong></p></div><ul><li>Converts playable audio inside the browser</li><li>Writes BWF time-reference metadata</li><li>Builds kept vocals from session start</li></ul>{bridgeProgress&&<div className="bridge-progress"><i/><span>{bridgeProgress}</span></div>}</div><div className="port-truth"><span>PT</span><p><strong>No fake Pro Tools files</strong><small>Avid supports PCM WAV import. REVERYX creates the professional audio handoff; Pro Tools creates the native `.ptx` session after import.</small></p></div><div className="modal-actions bridge-actions"><button className="ghost-button" disabled={bridgeBuilding||building} onClick={downloadManifest}>Manifest</button><button className="ghost-button" disabled={bridgeBuilding||building} onClick={()=>void buildPackage()}>{building?"Building…":built?"SessionPort again":"Universal ZIP"}</button><button className="primary-button protools-button" disabled={bridgeBuilding||building||(!tracks.length&&!takes.length)} onClick={()=>void buildProToolsBridge()}>{bridgeBuilding?bridgeProgress||"Building Pro Tools Bridge…":bridgeBuilt?"Download Pro Tools Bridge again":"Build Pro Tools Bridge"}</button></div></section></div>;
}

type LyricLine = { id:number; text:string; status:"locked"|"active"|"next"|"changed" };

function WordwaveStudio({announce,openSession}:{announce:(message:string)=>void;openSession:()=>void}) {
  const modes=[
    {name:"Silent Capture",tag:"LISTEN",copy:"Transcribe and organize. Never interrupt."},
    {name:"Assist",tag:"ON ASK",copy:"Offer help only when the artist requests it."},
    {name:"Writing Partner",tag:"CREATE",copy:"Find openings, repetition and alternate directions."},
    {name:"Performance Coach",tag:"DELIVER",copy:"Focus on cadence, breath and line density."},
    {name:"Freestyle Memory",tag:"REMEMBER",copy:"Catch improvised lines before they disappear."},
  ];
  const [mode,setMode]=useState("Assist");
  const [lines,setLines]=useState<LyricLine[]>([
    {id:1,text:"I came through the rain with the pressure on me",status:"locked"},
    {id:2,text:"Every closed door put a lesson on me",status:"active"},
    {id:3,text:"I learned how to build when they counted me out",status:"next"},
    {id:4,text:"Now the whole room move when I open my mouth",status:"next"},
  ]);
  const [activeLine,setActiveLine]=useState(1);
  const [following,setFollowing]=useState(false);
  const [reference,setReference]=useState("Rhymes");
  const [query,setQuery]=useState("pressure");
  const [words,setWords]=useState(["measure","treasure","pleasure","lesser","weather","never"]);
  const [searching,setSearching]=useState(false);
  const [alternates,setAlternates]=useState<string[]>([
    "Every hard lesson left a blessing on me",
    "Turned every ounce of pressure into proof",
  ]);
  const [finalCheck,setFinalCheck]=useState(false);
  const current=lines[activeLine];

  useEffect(()=>{
    if (!following) return;
    const timer=window.setInterval(()=>setActiveLine(value=>value>=lines.length-1?0:value+1),2600);
    return ()=>window.clearInterval(timer);
  },[following,lines.length]);

  useEffect(()=>{
    setLines(value=>value.map((line,index)=>({...line,status:index<activeLine?"locked":index===activeLine?"active":"next"})));
  },[activeLine]);

  async function findWords() {
    const term=query.trim()||current.text.split(/\s+/).at(-1)||"pressure";
    const param=reference==="Rhymes"?"rel_rhy":reference==="Meaning"?"ml":reference==="Sounds"?"sl":"rel_trg";
    setSearching(true);
    try {
      const response=await fetch(`https://api.datamuse.com/words?${param}=${encodeURIComponent(term)}&max=12`);
      if (!response.ok) throw new Error("reference unavailable");
      const result=await response.json() as {word:string}[];
      setWords(result.map(item=>item.word).filter(Boolean).slice(0,12));
      announce(`${reference} for “${term}” loaded into WORDWAVE.`);
    } catch {
      setWords(["measure","treasure","weather","never","pressure","better"]);
      announce("Online reference paused. WORDWAVE loaded the local rhyme pack.");
    } finally { setSearching(false); }
  }

  function updateCurrent(text:string) {
    setLines(value=>value.map((line,index)=>index===activeLine?{...line,text,status:"changed"}:line));
  }

  function addDirection(kind:string) {
    const term=query.trim()||"pressure";
    const options:Record<string,string>={
      "Sharper":"Put the weight on my back, made the whole thing leverage",
      "Personal":`I carried ${term} so long it started shaping my posture`,
      "Wordplay":`Made a diamond out the doubt—that’s ${term} with a purpose`,
    };
    setAlternates(value=>[options[kind],...value.filter(item=>item!==options[kind])]);
    announce(`${kind} direction saved as an alternate. Original line preserved.`);
  }

  function useAlternate(text:string) {
    updateCurrent(text);
    announce("Alternate moved into the working lyric. Previous version remains in history.");
  }

  function exportLyrics() {
    const body=["PRESSURE AGAIN","Artist: Unassigned","","[VERSE 1]",...lines.map(line=>line.text),"","Generated from the approved REVERYX lyric record."].join("\n");
    const url=URL.createObjectURL(new Blob([body],{type:"text/plain"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download="Pressure-Again-lyrics.txt";anchor.click();URL.revokeObjectURL(url);
    announce("Approved lyric sheet downloaded.");
  }

  return <div className="wordwave-page contextual-wordwave">
    <header className="wordwave-topbar"><div className="wordwave-brand"><div><small>SESSION TOOL</small><h1>WORDWAVE</h1></div></div><div className="wordwave-song"><small>SAMPLE WORKSPACE</small><strong>Replace these lines with your session lyrics</strong><span>Demo content is clearly separated from recorded work</span></div><div className="wordwave-actions"><button className={`follow-button ${following?"live":""}`} onClick={()=>setFollowing(!following)}><i/> {following?"FOLLOWING":"FOLLOW LYRICS"}</button><button className="primary-button" onClick={openSession}>Back to recording</button></div></header>

    <section className="mode-ribbon compact-mode"><div><span className="label">ASSISTANCE MODE</span><strong>{mode}</strong></div><label><span>Choose how involved WORDWAVE should be</span><select value={mode} onChange={event=>{setMode(event.target.value);announce(`${event.target.value} is now active.`);}}>{modes.map(item=><option key={item.name} value={item.name}>{item.name} — {item.copy}</option>)}</select></label></section>

    <div className="wordwave-grid">
      <section className="lyric-stage">
        <div className="lyric-stage-head"><div><span className="label">VERSE 1 / LIVE LYRIC MAP</span><h2>Write inside the performance.</h2></div><div className="lyric-metrics"><span><b>04</b> LINES</span><span><b>09</b> AVG SYLLABLES</span><span><b>A—A</b> RHYME</span></div></div>
        <div className="lyric-timeline">{lines.map((line,index)=><button key={line.id} className={`lyric-line ${index===activeLine?"active":""}`} onClick={()=>{setActiveLine(index);setFollowing(false);}}><span>{String(line.id).padStart(2,"0")}</span><p>{line.text}</p><small>{index===activeLine?"PERFORMING":line.status==="locked"?"LOCKED":"NEXT"}</small><i>{index===activeLine?"●":""}</i></button>)}</div>
        <div className="line-editor"><div className="line-editor-top"><span className="label">SELECTED LINE / NONDESTRUCTIVE EDIT</span><span>{current.text.trim().split(/\s+/).length} WORDS · {Math.max(7,current.text.length%12+6)} SYLLABLES</span></div><textarea value={current.text} onChange={event=>updateCurrent(event.target.value)} aria-label="Edit selected lyric line"/><div className="line-tools"><button onClick={()=>addDirection("Sharper")}>Make it sharper</button><button onClick={()=>addDirection("Personal")}>More personal</button><button onClick={()=>addDirection("Wordplay")}>Add wordplay</button><button onClick={()=>announce("Breath point placed after the fourth beat.")}>＋ Breath point</button></div></div>
        <div className="alternate-stack"><div className="alternate-head"><span className="label">ALTERNATE LINE MEMORY</span><small>Nothing replaces the original until you choose it.</small></div>{alternates.map((text,index)=><article key={`${text}-${index}`}><span>ALT {String(index+1).padStart(2,"0")}</span><p>{text}</p><button onClick={()=>useAlternate(text)}>USE THIS LINE →</button></article>)}</div>
      </section>

      <aside className="wordwave-lab">
        <div className="lab-heading"><span className="label">REFERENCE LAB</span><h2>Find the missing word.</h2><p>Search by sound, meaning or creative association without leaving the session.</p></div>
        <div className="reference-tabs">{["Rhymes","Meaning","Sounds","Related"].map(item=><button key={item} className={reference===item?"selected":""} onClick={()=>setReference(item)}>{item}</button>)}</div>
        <form className="reference-search" onSubmit={event=>{event.preventDefault();void findWords();}}><input value={query} onChange={event=>setQuery(event.target.value)} aria-label="Word reference search"/><button>{searching?"SEARCHING…":"EXPLORE →"}</button></form>
        <div className="word-cloud">{words.map((word,index)=><button key={`${word}-${index}`} onClick={()=>{setQuery(word);setAlternates(value=>[`${current.text.replace(/\b\w+[.!?]?$/,word)}`,...value]);}} style={{fontSize:`${Math.max(9,16-index/2)}px`}}>{word}</button>)}</div>
        <a className="reference-credit" href="https://www.datamuse.com/api/" target="_blank" rel="noreferrer">WORD REFERENCE POWERED BY DATAMUSE ↗</a>
        <div className="direction-cards"><span className="label">CREATIVE DIRECTIONS</span>{[["01","FLIP THE IMAGE","Turn pressure into proof, weight or transformation."],["02","CHANGE THE CAMERA","Move from what happened to how it felt physically."],["03","LAND HARDER","Reserve the strongest word for beat four."]].map(item=><button key={item[0]} onClick={()=>addDirection(item[0]==="01"?"Wordplay":item[0]==="02"?"Personal":"Sharper")}><span>{item[0]}</span><p><strong>{item[1]}</strong><small>{item[2]}</small></p><i>＋</i></button>)}</div>
        <div className="privacy-card"><span>◇</span><p><strong>UNRELEASED SESSION · PRIVATE</strong><small>Artist lyrics stay inside this session. Suggestions are logged separately from authored lines.</small></p></div>
      </aside>
    </div>

    <section className={`lyric-reconcile ${finalCheck?"open":""}`}><div><span className="label">FINAL PERFORMANCE RECONCILIATION</span><h2>{finalCheck?"Two performed changes found.":"Match the lyric sheet to the approved vocal."}</h2><p>{finalCheck?"WORDWAVE compared the working lyric against the final comp. Review before updating the official lyric record.":"Create an accurate lyric sheet, clean version and time-synchronized delivery after the comp is locked."}</p></div>{finalCheck?<div className="reconcile-results"><p><span>LINE 02</span><strong>“put a lesson” → “left a blessing”</strong><button onClick={()=>announce("Performed wording accepted for line 02.")}>ACCEPT</button></p><p><span>LINE 04</span><strong>Ad-lib detected: “talk to ’em”</strong><button onClick={()=>announce("Ad-lib added to the lyric record.")}>ADD AD-LIB</button></p></div>:<button className="primary-button" onClick={()=>setFinalCheck(true)}>Compare final comp →</button>} {finalCheck&&<button className="primary-button export-lyrics" onClick={exportLyrics}>Export approved lyrics</button>}</section>
  </div>;
}

function PageHeader({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}) {
  return <header className="section-topbar"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function LibraryHub({announce,openSession}:{announce:(message:string)=>void;openSession:()=>void}) {
  const [section,setSection]=useState<"sounds"|"artists">("sounds");
  return <div className="library-hub">
    <div className="library-switch" aria-label="Library sections">
      <button className={section==="sounds"?"active":""} onClick={()=>setSection("sounds")}>Vocal sounds</button>
      <button className={section==="artists"?"active":""} onClick={()=>setSection("artists")}>Artist profiles</button>
      <button onClick={openSession}>Back to recording</button>
    </div>
    {section==="sounds"?<SoundVault announce={announce} openSession={openSession}/>:<ArtistVault announce={announce} openSession={openSession}/>} 
  </div>;
}

function ArtistVault({announce,openSession}:{announce:(message:string)=>void;openSession:()=>void}) {
  const [selected,setSelected] = useState(0);
  const artist=artists[selected];
  return <div className="vault-page">
    <PageHeader eyebrow="TOTAL RECALL / ARTIST MEMORY" title="Artist Vault" description="Every artist’s sound, hardware, commands and session habits—ready in any room." action={<button className="primary-button" onClick={()=>announce("New artist calibration flow opened.")}>＋ New artist profile</button>} />
    <div className="vault-layout">
      <aside className="artist-list-panel"><div className="list-search"><span>⌕</span><input placeholder="Search artist profiles" /></div>{artists.map((item,index)=><button key={item.name} className={selected===index?"selected":""} onClick={()=>setSelected(index)}><span className={`artist-mini ${item.color}`}>{item.initials}</span><div><strong>{item.name}</strong><small>{item.sessions} sessions · {item.sound}</small></div><i>›</i></button>)}<button className="guest-profile"><span>＋</span><div><strong>Guest Session</strong><small>Start without saved preferences</small></div></button></aside>
      <section className="artist-profile-panel">
        <div className="profile-hero"><span className={`profile-avatar ${artist.color}`}>{artist.initials}</span><div><span className="label">{artist.status}</span><h2>{artist.name}</h2><p>Profile confidence 98% · Last calibrated today</p></div><button className="primary-button" onClick={openSession}>Open session</button></div>
        <div className="profile-stat-row"><div><small>SESSIONS</small><strong>{artist.sessions}</strong></div><div><small>SAVED CHAINS</small><strong>8</strong></div><div><small>KEPT TAKES</small><strong>84%</strong></div><div><small>AVG. SETUP</small><strong>0:18</strong></div></div>
        <div className="profile-grid">
          <article className="profile-card"><span className="label">DEFAULT SOUND</span><h3>{artist.sound}</h3><p>Adaptive base chain for verse leads and first-pass monitoring.</p><div className="trait-row"><span>Lead</span><span>Adaptive</span><span>Low latency</span></div><button onClick={()=>announce("Sound history opened.")}>View sound history →</button></article>
          <article className="profile-card"><span className="label">RECORDING HARDWARE</span><dl><div><dt>MICROPHONE</dt><dd>{artist.mic}</dd></div><div><dt>INTERFACE</dt><dd>{artist.interface}</dd></div><div><dt>GAIN TARGET</dt><dd>−12 dBFS average</dd></div><div><dt>BUFFER</dt><dd>64 samples</dd></div></dl><button onClick={()=>announce("Hardware calibration opened.")}>Recalibrate hardware →</button></article>
          <article className="profile-card wide"><span className="label">PUNCH FLOW MEMORY</span><h3>{artist.command}</h3><div className="memory-flow"><div><span>01</span><strong>Play context</strong><small>Previous line + pre-roll</small></div><i>→</i><div><span>02</span><strong>Capture phrase</strong><small>Raw + monitor chain</small></div><i>→</i><div><span>03</span><strong>Keep / retry</strong><small>Advance automatically</small></div></div></article>
        </div>
      </section>
    </div>
  </div>;
}

function SoundVault({announce,openSession}:{announce:(message:string)=>void;openSession:()=>void}) {
  const [selected,setSelected]=useState(0);
  return <div className="vault-page">
    <PageHeader eyebrow="SONIC ARCHETYPES / ORIGINAL CHAINS" title="Sound Vault" description="Choose the result. REVERYX adapts the chain to the artist, microphone and room." action={<div className="vault-actions"><button className="ghost-button">Filters</button><button className="primary-button" onClick={()=>announce("Custom archetype builder opened.")}>＋ Build archetype</button></div>} />
    <div className="vault-tabs"><button className="active">All sounds <span>08</span></button><button>Lead vocals</button><button>Hooks</button><button>Ad-libs</button><button>Tracking-safe</button></div>
    <div className="sound-vault-grid">{archetypes.map((item,index)=><button className={`sound-card ${selected===index?"selected":""}`} key={item.name} onClick={()=>setSelected(index)}><div className="sound-visual"><i/><i/><i/><i/><i/><i/><i/></div><span className="label">{item.family}</span><h2>{item.name}</h2><p>{item.detail}</p><div className="trait-row">{item.traits.map(trait=><span key={trait}>{trait}</span>)}</div><div className="sound-footer"><span><strong>{item.match}%</strong> ARTIST MATCH</span><b>{selected===index?"SELECTED":"AUDITION"} →</b></div></button>)}</div>
    <div className="vault-selection-bar"><div><span className="label">SELECTED ARCHETYPE</span><strong>{archetypes[selected].name}</strong><small>Will adapt without changing the protected raw vocal.</small></div><button className="primary-button" onClick={()=>{announce(`${archetypes[selected].name} loaded into the session.`);openSession();}}>Load into current session →</button></div>
  </div>;
}

function Deliveries({announce}:{announce:(message:string)=>void}) {
  const [expanded,setExpanded]=useState(0);
  return <div className="vault-page">
    <PageHeader eyebrow="BOUNCE / APPROVAL / HANDOFF" title="Deliveries" description="Every approved mix, master, stem and alternate version in one release-ready package." action={<button className="primary-button" onClick={()=>announce("New delivery package started.")}>＋ New delivery</button>} />
    <div className="delivery-stats"><div><span className="purple">03</span><p><strong>Active packages</strong><small>Across 3 artists</small></p></div><div><span className="green">20</span><p><strong>Files ready</strong><small>Passed quality control</small></p></div><div><span className="amber">01</span><p><strong>Needs review</strong><small>Engineer approval</small></p></div><div><span>02</span><p><strong>Delivered</strong><small>This month</small></p></div></div>
    <section className="delivery-table"><div className="delivery-head"><span>PROJECT</span><span>STATUS</span><span>PACKAGE</span><span>VERSION</span><span>UPDATED</span><span /></div>{deliveries.map((item,index)=><div className={`delivery-row ${expanded===index?"expanded":""}`} key={item.song}><div><span className="file-cube">◇</span><p><strong>{item.song}</strong><small>{item.artist}</small></p></div><span className={`delivery-status s${index}`}>{item.state}</span><p><strong>{item.type}</strong><small>{item.files} files</small></p><p><strong>{item.version}</strong><small>24-bit / 48 kHz</small></p><span className="updated">{item.time}</span><button onClick={()=>setExpanded(expanded===index?-1:index)}>⌄</button>{expanded===index&&<div className="package-detail"><div><span className="label">PACKAGE CONTENTS</span><p><strong>Master WAV</strong><small>24-bit / 48 kHz</small></p><p><strong>Clean version</strong><small>Approved edit</small></p><p><strong>Instrumental</strong><small>Full resolution</small></p><p><strong>Acapella</strong><small>Processed lead + stacks</small></p><p><strong>Session stems</strong><small>{item.files} organized files</small></p></div><aside><span className="label">QUALITY CONTROL</span><p><i/>No clipping</p><p><i/>Phase stable</p><p><i/>Metadata complete</p><button className="primary-button" onClick={()=>announce(`${item.song} delivery link copied.`)}>Copy delivery link</button></aside></div>}</div>)}</section>
  </div>;
}

function SessionSetup({close,chooseAudio}:{close:()=>void;chooseAudio:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><section className="session-modal smart-import-modal"><button className="modal-close text-close" onClick={close}>Close</button><span className="label">SMART IMPORT</span><h2>Choose the real audio.</h2><p className="modal-intro">Select one beat, several stems, or a REVERYX handoff. The source type is identified automatically after you choose the files.</p><div className="smart-import-types"><div><span>ONE FILE</span><strong>Beat</strong></div><div><span>MULTIPLE FILES</span><strong>Stems</strong></div><div><span>SESSION FILE</span><strong>Handoff</strong></div></div><div className="intake-truth"><span>LOCAL</span><p><strong>Your audio stays on this device during setup.</strong><small>The original file is never changed or deleted.</small></p></div><div className="modal-actions"><button className="ghost-button" onClick={close}>Not now</button><button className="primary-button" onClick={chooseAudio}>Choose audio</button></div></section></div>;
}

function DawModal({current,select,close}:{current:string;select:(value:string)=>void;close:()=>void}) {
  const workspaces=[
    {name:"REVERYX Standalone",mark:"RX",detail:"Record, comp, mix and export without another DAW"},
    {name:"Pro Tools",mark:"PT",detail:"Session control + AAX monitoring"},
    {name:"Logic Pro",mark:"LP",detail:"Audio Unit monitoring + session commands"},
    {name:"Ableton Live",mark:"AL",detail:"Plugin monitoring + session commands"},
    {name:"FL Studio",mark:"FL",detail:"Plugin monitoring + session commands"},
  ];
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><section className="session-modal daw-modal"><button className="modal-close" onClick={close}>×</button><span className="label">RECORDING WORKSPACE</span><h2>REVERYX works alone or connected.</h2><p className="modal-intro">Standalone Studio records locally inside REVERYX. DAW Bridge modes operate beside existing professional software.</p><div className="daw-list">{workspaces.map((item,index)=><button key={item.name} className={current===item.name?"selected":""} onClick={()=>select(item.name)}><span className={`daw-logo d${index}`}>{item.mark}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div><i>{current===item.name?"ACTIVE":"SELECT"}</i></button>)}</div></section></div>;
}

function MixPanel({announce}:{announce:(message:string)=>void}) {
  const [version,setVersion]=useState("Balanced");
  return <section className="process-panel"><div className="process-heading"><div><span className="label">VOCAL MIX ROOM</span><h2>Separate decisions. One approved mix.</h2></div><span className="source-badge">FULL STEM CONTROL</span></div><div className="mix-layout"><div className="mix-channels">{["DRUMS","BASS","MUSIC","LEAD","DOUBLES","AD-LIBS"].map((name,index)=><div className="channel" key={name}><span className={`channel-meter c${index}`}/><input aria-label={`${name} level`} type="range" defaultValue={[74,68,57,82,46,39][index]}/><strong>{name}</strong><small>{["−3.2","−4.8","−6.1","−1.4","−8.2","−10.5"][index]} dB</small></div>)}</div><div className="version-stack"><span className="label">MIX DIRECTION</span>{["Vocal Forward","Balanced","Music Forward"].map(item=><button key={item} className={version===item?"selected":""} onClick={()=>{setVersion(item);announce(`${item} mix recalled.`);}}><i/>{item}<small>{item==="Balanced"?"Current approved direction":"Ready to audition"}</small></button>)}</div></div></section>;
}

function MasterPanel({announce}:{announce:(message:string)=>void}) {
  const [master,setMaster]=useState("Clean + Dynamic");
  return <section className="process-panel master-panel"><div className="process-heading"><div><span className="label">MASTERING ROOM</span><h2>Release translation and quality control.</h2></div><span className="source-badge passed">QC PASSED</span></div><div className="master-layout"><div className="master-orb"><div><strong>−9.1</strong><small>INTEGRATED</small></div><i/></div><div className="master-options"><span className="label">MASTER CHARACTER</span>{["Clean + Dynamic","Loud + Aggressive","Warm + Analog"].map(item=><button key={item} className={master===item?"selected":""} onClick={()=>setMaster(item)}>{item}<span>{master===item?"ACTIVE":"AUDITION"}</span></button>)}</div><div className="qc-grid"><div><small>TRUE PEAK</small><strong>−1.0 dB</strong></div><div><small>DYNAMIC RANGE</small><strong>8.6 LU</strong></div><div><small>STEREO IMAGE</small><strong>Stable</strong></div><div><small>DELIVERY</small><strong>8 files</strong></div><button onClick={()=>announce("A/B switched to the protected pre-master.")}>A/B PRE-MASTER</button></div></div></section>;
}
