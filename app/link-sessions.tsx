"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import JSZip from "jszip";

type Role="Host"|"Performer"|"Engineer";
type Status="joining"|"ready"|"listening"|"recording"|"reviewing"|"offline";
type Participant={id:string;name:string;role:Role;status:Status;last_seen_at:number};
type LinkTake={id:string;participant_id:string;participant_name:string;name:string;mime_type:string;seconds:number;start_seconds:number;sync_offset_ms:number;state:"captured"|"keep"|"recovery";created_at:number;audio_url:string};
type SharedState={playing:boolean;currentTime:number;punchPoint:number;recording:boolean;recordNonce:string;recordStartAt:number;videoEnabled:boolean;revision:number};
type Snapshot={room:{id:string;title:string;song_name:string;bpm:number;beat_name?:string;beat_url?:string;notes:string;shared_state:SharedState};participants:Participant[];takes:LinkTake[];events:Array<{id:string;participant_name?:string;type:string;created_at:number}>;serverTime:number};

const bars=[38,62,48,86,57,74,43,91,68,52,79,59,95,67,46,72,54,84,63,41,76,88,56,71,49,82,65,44,93,61,77,50,85,58,70,47,89,66,53,80,60,97,64,45,73,55,87,69,51,78,57,92,62,48,83,67,42,75,59,90,65,53,81,58];
function stamp(seconds:number){const safe=Math.max(0,Number(seconds)||0);return `${Math.floor(safe/60)}:${String(Math.floor(safe%60)).padStart(2,"0")}`;}
function deviceId(){const key="reveryx-link-device";let value=localStorage.getItem(key);if(!value){value=crypto.randomUUID();localStorage.setItem(key,value);}return value;}

export default function LinkSessions({announce}:{announce:(message:string)=>void}){
  const [roomId,setRoomId]=useState("");
  const [secret,setSecret]=useState("");
  const [participantId,setParticipantId]=useState("");
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [hostName,setHostName]=useState("");
  const [guestName,setGuestName]=useState("");
  const [role,setRole]=useState<Role>("Performer");
  const [title,setTitle]=useState("");
  const [songName,setSongName]=useState("");
  const [bpm,setBpm]=useState(128);
  const [lobbyMode,setLobbyMode]=useState<"create"|"join">("create");
  const [inviteLink,setInviteLink]=useState("");
  const [micReady,setMicReady]=useState(false);
  const [countdown,setCountdown]=useState(0);
  const [uploading,setUploading]=useState(false);
  const [notes,setNotes]=useState("");
  const [currentTime,setCurrentTime]=useState(0);
  const [punchPoint,setPunchPoint]=useState(0);
  const beatInput=useRef<HTMLInputElement>(null);
  const beatAudio=useRef<HTMLAudioElement|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recorderRef=useRef<MediaRecorder|null>(null);
  const chunksRef=useRef<Blob[]>([]);
  const startRef=useRef(0);
  const lastNonce=useRef("");
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);

  const me=snapshot?.participants.find(person=>person.id===participantId);
  const canDirect=me?.role==="Host"||me?.role==="Engineer";

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const nextRoom=params.get("room")||"";
    const nextKey=params.get("key")||"";
    if(nextRoom&&nextKey){setRoomId(nextRoom);setSecret(nextKey);setParticipantId(localStorage.getItem(`reveryx-link-member-${nextRoom}`)||"");}
  },[]);

  async function api(path="",init?:RequestInit){
    const response=await fetch(`/api/link/rooms/${roomId}${path}?key=${encodeURIComponent(secret)}`,init);
    const data=await response.json().catch(()=>({error:"The session returned an unreadable response."}));
    if(!response.ok)throw new Error(data.error||"Link Session request failed.");
    return data;
  }
  async function refresh(){
    if(!roomId||!secret)return;
    try{
      const data=await api() as Snapshot;
      setSnapshot(data);setNotes(value=>value||data.room.notes||"");setPunchPoint(data.room.shared_state.punchPoint||0);
      const state=data.room.shared_state;
      if(state.recordNonce&&state.recordNonce!==lastNonce.current){lastNonce.current=state.recordNonce;void scheduleLocalCapture(state,data.serverTime);}
      if(!state.recording&&recorderRef.current?.state==="recording")recorderRef.current.stop();
    }catch(caught){setError(caught instanceof Error?caught.message:"Unable to open this session.");}
  }
  useEffect(()=>{void refresh();if(!roomId||!secret)return;const poll=window.setInterval(()=>void refresh(),1100);return()=>window.clearInterval(poll);},[roomId,secret]);
  useEffect(()=>{if(!participantId||!roomId||!secret)return;const heartbeat=window.setInterval(()=>void api("/heartbeat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,status:recorderRef.current?.state==="recording"?"recording":micReady?"ready":"listening"})}).catch(()=>undefined),5000);return()=>window.clearInterval(heartbeat);},[participantId,roomId,secret,micReady]);
  useEffect(()=>()=>{streamRef.current?.getTracks().forEach(track=>track.stop());if(timerRef.current)clearInterval(timerRef.current);},[]);

  async function createRoom(event:FormEvent){
    event.preventDefault();setLoading(true);setError("");
    try{
      const response=await fetch("/api/link/rooms",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hostName:hostName||"Session Host",title,songName,bpm,deviceId:deviceId()})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not create the room.");
      setRoomId(data.roomId);setSecret(data.secret);setParticipantId(data.participantId);localStorage.setItem(`reveryx-link-member-${data.roomId}`,data.participantId);
      history.replaceState(null,"",`?room=${data.roomId}&key=${encodeURIComponent(data.secret)}`);announce("Private Link Session created.");
    }catch(caught){setError(caught instanceof Error?caught.message:"Could not create the room.");}finally{setLoading(false);}
  }
  function openInvite(event:FormEvent){
    event.preventDefault();setError("");
    try{
      const invite=new URL(inviteLink.trim());
      const nextRoom=invite.searchParams.get("room")||"";
      const nextKey=invite.searchParams.get("key")||"";
      if(!nextRoom||!nextKey)throw new Error("That invitation is missing the room information.");
      setRoomId(nextRoom);setSecret(nextKey);setParticipantId(localStorage.getItem(`reveryx-link-member-${nextRoom}`)||"");
      history.replaceState(null,"",`?room=${nextRoom}&key=${encodeURIComponent(nextKey)}`);
    }catch(caught){setError(caught instanceof Error?caught.message:"Paste the complete REVERYX invitation.");}
  }
  async function joinRoom(event:FormEvent){
    event.preventDefault();setLoading(true);setError("");
    try{const data=await api("/join",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:guestName||"Guest",role,deviceId:deviceId()})});setParticipantId(data.participantId);localStorage.setItem(`reveryx-link-member-${roomId}`,data.participantId);announce(`Joined as ${data.role}.`);await refresh();}
    catch(caught){setError(caught instanceof Error?caught.message:"Could not join this session.");}finally{setLoading(false);}
  }
  async function prepareMic(){
    try{const stream=streamRef.current||await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});streamRef.current=stream;setMicReady(true);await api("/heartbeat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,status:"ready"})});announce("Microphone ready. Local lossless capture is armed.");}
    catch{setError("Microphone access was blocked. Allow microphone access, then try again.");}
  }
  async function patchState(patch:Partial<SharedState>,eventType:string){
    const data=await api("/state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,patch,eventType})});setSnapshot(value=>value?{...value,room:{...value.room,shared_state:data.sharedState}}:value);
  }
  async function togglePlay(){
    if(!canDirect)return;
    const next=!snapshot?.room.shared_state.playing;await patchState({playing:next,currentTime},next?"play_started":"play_paused");
    if(beatAudio.current){beatAudio.current.currentTime=currentTime;if(next)void beatAudio.current.play();else beatAudio.current.pause();}
  }
  async function recordEveryone(){
    if(!canDirect)return;
    if(!snapshot?.room.beat_url){setError("Load the shared beat before recording everyone.");return;}
    const notReady=snapshot.participants.filter(person=>person.role!=="Engineer"&&person.status!=="ready");
    if(notReady.length){announce(`${notReady.length} performer${notReady.length>1?"s are":" is"} not mic-ready yet.`);}
    const startsAt=Date.now()+4000;await patchState({recording:true,playing:true,currentTime:punchPoint,punchPoint,recordStartAt:startsAt,recordNonce:crypto.randomUUID()},"record_everyone");announce("Four-second synchronized count-in started.");
  }
  async function stopEveryone(){if(canDirect)await patchState({recording:false,playing:false,currentTime},"record_stopped");beatAudio.current?.pause();}
  async function scheduleLocalCapture(state:SharedState,serverTime:number){
    if(!streamRef.current){setError("A joint recording started, but this device was not mic-ready. Tap Mic check before the next pass.");return;}
    const serverOffset=serverTime-Date.now();const delay=Math.max(0,state.recordStartAt-(Date.now()+serverOffset));setCountdown(Math.max(1,Math.ceil(delay/1000)));
    if(timerRef.current)clearInterval(timerRef.current);timerRef.current=setInterval(()=>setCountdown(value=>Math.max(0,value-1)),1000);
    window.setTimeout(()=>{
      if(timerRef.current)clearInterval(timerRef.current);setCountdown(0);chunksRef.current=[];
      const preferred=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm";
      const recorder=new MediaRecorder(streamRef.current!,{mimeType:preferred});recorderRef.current=recorder;startRef.current=performance.now();
      recorder.ondataavailable=event=>{if(event.data.size)chunksRef.current.push(event.data);};
      recorder.onstop=()=>void uploadTake(new Blob(chunksRef.current,{type:recorder.mimeType}),Math.max(.1,(performance.now()-startRef.current)/1000),state.punchPoint,Math.round((Date.now()+serverOffset)-state.recordStartAt));
      recorder.start(250);setCurrentTime(state.punchPoint);if(beatAudio.current){beatAudio.current.currentTime=state.punchPoint;void beatAudio.current.play().catch(()=>undefined);}announce("Local master recording started.");
    },delay);
  }
  async function uploadTake(blob:Blob,seconds:number,startSeconds:number,syncOffsetMs:number){
    setUploading(true);const form=new FormData();form.set("participantId",participantId);form.set("file",new File([blob],`joint-take-${Date.now()}.webm`,{type:blob.type}));form.set("name",`${me?.name||"Performer"} · Take ${Date.now().toString().slice(-4)}`);form.set("seconds",String(seconds));form.set("startSeconds",String(startSeconds));form.set("syncOffsetMs",String(syncOffsetMs));
    try{await api("/takes",{method:"POST",body:form});announce("Full-quality local take uploaded and aligned.");await refresh();}catch(caught){setError(caught instanceof Error?caught.message:"Take upload failed. The local recording is still recoverable on this device.");}finally{setUploading(false);}
  }
  async function loadBeat(file?:File){
    if(!file)return;setUploading(true);const form=new FormData();form.set("participantId",participantId);form.set("file",file);
    try{await api("/beat",{method:"POST",body:form});announce("Beat uploaded and cached for the room.");await refresh();}catch(caught){setError(caught instanceof Error?caught.message:"Beat upload failed.");}finally{setUploading(false);}
  }
  async function decideTake(take:LinkTake,state:LinkTake["state"]){try{await api(`/takes/${take.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,state})});announce(state==="keep"?"Take kept in the joint comp.":state==="recovery"?"Take moved to recovery.":"Take returned to review.");await refresh();}catch(caught){setError(caught instanceof Error?caught.message:"Could not update the take.");}}
  async function copyInvite(){const url=`${location.origin}${location.pathname}?room=${roomId}&key=${encodeURIComponent(secret)}`;await navigator.clipboard.writeText(url);announce("Private invitation copied.");}
  async function saveNotes(){try{await api("/notes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,notes})});announce("Shared session notes saved.");await refresh();}catch(caught){setError(caught instanceof Error?caught.message:"Could not save notes.");}}
  async function exportSession(){
    if(!snapshot)return;setUploading(true);
    try{const zip=new JSZip();const manifest={format:"REVERYX Link Session 1.0",exportedAt:new Date().toISOString(),room:{id:snapshot.room.id,title:snapshot.room.title,song:snapshot.room.song_name,bpm:snapshot.room.bpm,notes:snapshot.room.notes},participants:snapshot.participants.map(({id,name,role})=>({id,name,role})),timeline:snapshot.takes.map(take=>({file:`Audio/${take.participant_name}/${take.id}.${take.mime_type.includes("webm")?"webm":"audio"}`,participant:take.participant_name,startSeconds:take.start_seconds,durationSeconds:take.seconds,syncOffsetMs:take.sync_offset_ms,state:take.state}))};zip.file("REVERYX-Link-Manifest.json",JSON.stringify(manifest,null,2));zip.file("Timeline.csv",["Track,File,Start Seconds,Duration Seconds,Sync Offset MS,Decision",...snapshot.takes.map(t=>`\"${t.participant_name}\",\"${t.name}\",${t.start_seconds},${t.seconds},${t.sync_offset_ms},${t.state}`)].join("\n"));
      for(const take of snapshot.takes){const blob=await fetch(take.audio_url).then(response=>response.blob());zip.file(`Audio/${take.participant_name}/${take.id}.webm`,blob);}
      if(snapshot.room.beat_url){const beat=await fetch(snapshot.room.beat_url).then(response=>response.blob());zip.file(`Audio/Beat/${snapshot.room.beat_name||"shared-beat"}`,beat);}
      const blob=await zip.generateAsync({type:"blob"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${snapshot.room.song_name.replace(/[^a-z0-9]+/gi,"-")}-REVERYX-Link.zip`;anchor.click();URL.revokeObjectURL(url);announce("DAW handoff package exported.");
    }catch{setError("The handoff package could not be assembled. Try again after all takes finish uploading.");}finally{setUploading(false);}
  }

  useEffect(()=>{
    const audio=beatAudio.current;const state=snapshot?.room.shared_state;if(!audio||!state)return;
    if(Math.abs(audio.currentTime-state.currentTime)>1.4)audio.currentTime=state.currentTime;
    if(state.playing&&!state.recording)void audio.play().catch(()=>undefined);if(!state.playing)audio.pause();
  },[snapshot?.room.shared_state.revision,snapshot?.room.beat_url]);

  if(!roomId||!secret)return <div className="link-lobby"><header><span>REVERYX LINK SESSIONS</span><h1>One song.<br/><em>Multiple studios.</em></h1><p>Create a private room or paste the invitation someone sent you. Every performer records a protected master on their own device.</p></header><section className="link-entry-card"><div className="link-entry-tabs"><button className={lobbyMode==="create"?"active":""} onClick={()=>setLobbyMode("create")}>Create a room</button><button className={lobbyMode==="join"?"active":""} onClick={()=>setLobbyMode("join")}>Join a room</button></div>{lobbyMode==="create"?<form onSubmit={createRoom}><label>ROOM NAME<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Name this session" /></label><label>SONG<input required value={songName} onChange={e=>setSongName(e.target.value)} placeholder="Song title" /></label><div className="link-form-row"><label>YOUR NAME<input value={hostName} onChange={e=>setHostName(e.target.value)} placeholder="Session host" /></label><label>TEMPO<input type="number" min="40" max="300" value={bpm} onChange={e=>setBpm(Number(e.target.value))} /></label></div><button disabled={loading}>{loading?"CREATING PRIVATE ROOM…":"CREATE PRIVATE ROOM"}<small>Generate the invitation after setup</small></button></form>:<form onSubmit={openInvite}><label>PRIVATE INVITATION<input required value={inviteLink} onChange={e=>setInviteLink(e.target.value)} placeholder="Paste the full REVERYX link" /></label><button>OPEN SHARED ROOM<small>You will choose your role before entering</small></button></form>}{error&&<p className="link-error">{error}</p>}</section><section className="link-promise"><article><b>01</b><strong>SYNC THE ROOM</strong><p>One beat, shared transport, punch points and notes.</p></article><article><b>02</b><strong>CAPTURE LOCALLY</strong><p>Clean masters stay protected from internet dropouts.</p></article><article><b>03</b><strong>ALIGN + EXPORT</strong><p>Separate tracks arrive with exact timeline placement.</p></article></section></div>;

  if(!participantId)return <div className="link-join"><section><span>PRIVATE LINK SESSION</span><h1>{snapshot?.room.title||"Joining room…"}</h1><p>{snapshot?.room.song_name||"The host has invited you into a synchronized REVERYX room."}</p><form onSubmit={joinRoom}><label>YOUR NAME<input autoFocus value={guestName} onChange={e=>setGuestName(e.target.value)} placeholder="How should the room identify you?" /></label><div className="link-role-select"><button type="button" className={role==="Performer"?"selected":""} onClick={()=>setRole("Performer")}><strong>PERFORMER</strong><small>Record and manage your takes</small></button><button type="button" className={role==="Engineer"?"selected":""} onClick={()=>setRole("Engineer")}><strong>ENGINEER</strong><small>Direct transport and approvals</small></button></div><button className="link-enter" disabled={loading}>{loading?"ENTERING…":"ENTER SHARED ROOM"}</button>{error&&<p className="link-error">{error}</p>}</form></section></div>;

  if(!snapshot)return <div className="link-loading">CONNECTING TO THE SHARED ROOM</div>;
  const state=snapshot.room.shared_state;
  const performers=snapshot.participants.filter(person=>person.role!=="Engineer");
  const readyPerformers=performers.filter(person=>person.status==="ready"||person.status==="recording"||person.status==="reviewing");
  const localCapture=typeof MediaRecorder!=="undefined"&&Boolean(navigator.mediaDevices?.getUserMedia);
  const roomReady=Boolean(snapshot.room.beat_url&&micReady&&performers.length&&readyPerformers.length===performers.length&&localCapture);
  return <div className="link-room">
    {snapshot.room.beat_url&&<audio ref={beatAudio} src={snapshot.room.beat_url} onTimeUpdate={e=>{if(!state.recording)setCurrentTime(e.currentTarget.currentTime);}} preload="auto"/>}
    {countdown>0&&<div className="link-countdown"><span>JOINT TAKE STARTS IN</span><strong>{countdown}</strong><small>Local masters armed across the room</small></div>}
    <header className="link-room-head"><div><span>REVERYX LINK / {roomId.toUpperCase()}</span><h1>{snapshot.room.title}</h1><p>{snapshot.room.song_name} · {snapshot.room.bpm} BPM</p></div><div><button onClick={copyInvite}>COPY PRIVATE INVITE</button><button className="link-export" onClick={()=>void exportSession()} disabled={uploading}>EXPORT SESSION</button></div></header>
    {error&&<div className="link-error-banner"><span>SIGNAL NOTE</span><p>{error}</p><button onClick={()=>setError("")}>DISMISS</button></div>}
    <section className={`link-readiness ${roomReady?"ready":""}`}>
      <header><span>ROOM READINESS</span><strong>{roomReady?"READY TO RECORD":"COMPLETE THE CHECKS"}</strong></header>
      <div>
        <article className={snapshot.room.beat_url?"ready":"waiting"}><span>SHARED SONG</span><strong>{snapshot.room.beat_url?"CACHED":"LOAD NEEDED"}</strong><small>{snapshot.room.beat_name||"The host adds the beat"}</small></article>
        <article className={micReady?"ready":"waiting"}><span>THIS MICROPHONE</span><strong>{micReady?"ARMED":"CHECK NEEDED"}</strong><small>Local master on this device</small></article>
        <article className={readyPerformers.length===performers.length&&performers.length?"ready":"waiting"}><span>PERFORMERS</span><strong>{readyPerformers.length} / {performers.length} READY</strong><small>Each device records independently</small></article>
        <article className={localCapture?"ready":"waiting"}><span>LOCAL CAPTURE</span><strong>{localCapture?"SUPPORTED":"UNAVAILABLE"}</strong><small>Internet cannot damage the master</small></article>
      </div>
    </section>
    <section className="link-people"><div className="link-section-title"><span>ROOM SIGNAL</span><strong>{snapshot.participants.length} CONNECTED</strong></div><div>{snapshot.participants.map((person,index)=><article key={person.id} className={`${person.status} ${person.id===participantId?"self":""}`}><span className="link-avatar">{String(index+1).padStart(2,"0")}</span><p><strong>{person.name}{person.id===participantId?" · YOU":""}</strong><small>{person.role.toUpperCase()}</small></p><i/><b>{person.status.toUpperCase()}</b></article>)}</div></section>
    <div className="link-grid">
      <section className="link-timeline"><header><div><span>SHARED TIMELINE</span><strong>{snapshot.room.beat_name||"NO BEAT LOADED"}</strong></div><div><b>{stamp(currentTime)}</b><small>PUNCH {stamp(punchPoint)}</small></div></header><div className="link-wave" onClick={event=>{if(!canDirect)return;const rect=event.currentTarget.getBoundingClientRect();const next=Math.max(0,Math.min(180,(event.clientX-rect.left)/rect.width*180));setPunchPoint(next);setCurrentTime(next);void patchState({punchPoint:next,currentTime:next},"punch_moved");}}>{bars.map((bar,index)=><i key={index} style={{height:`${bar}%`}}/>)}<span className="link-playhead" style={{left:`${Math.min(100,currentTime/180*100)}%`}}/><span className="link-punch" style={{left:`${Math.min(100,punchPoint/180*100)}%`}}><b>{stamp(punchPoint)}</b></span></div><footer><span>Click waveform to set a shared punch point</span>{canDirect?<><button onClick={togglePlay}>{state.playing&&!state.recording?"PAUSE":"PLAY FROM PUNCH"}</button><button className={state.recording?"stop":"record"} onClick={()=>void (state.recording?stopEveryone():recordEveryone())}>{state.recording?"STOP JOINT TAKE":"RECORD EVERYONE"}</button></>:<strong>HOST CONTROLS TRANSPORT</strong>}</footer></section>
      <aside className="link-side"><section className={`link-mic ${micReady?"ready":""}`}><span>{micReady?"LOCAL MASTER ARMED":"DEVICE CHECK"}</span><h2>{micReady?"Your microphone is ready.":"Protect your side of the session."}</h2><p>{micReady?"Your uncompressed source path is held locally until each take uploads.":"Grant microphone access once. REVERYX will reuse the clean input for synchronized takes."}</p><button onClick={()=>void prepareMic()}>{micReady?"MIC READY":"RUN MIC CHECK"}</button></section><section className="link-video"><span>RELAYGO VIDEO</span><h3>{state.videoEnabled?"Visual room enabled":"Optional synchronized video"}</h3><p>Video and talkback can share this room while the professional audio remains local.</p>{canDirect&&<button onClick={()=>void patchState({videoEnabled:!state.videoEnabled},"video_bridge_changed")}>{state.videoEnabled?"DISCONNECT BRIDGE":"PREPARE VIDEO BRIDGE"}</button>}</section></aside>
    </div>
    <section className="link-takes"><div className="link-section-title"><span>CAPTURED TAKES</span><strong>{uploading?"UPLOADING LOCAL MASTER…":`${snapshot.takes.length} IN THE ROOM`}</strong></div>{snapshot.takes.length?<div className="link-take-list">{snapshot.takes.map(take=><article key={take.id} className={take.state}><div><span>{take.state.toUpperCase()}</span><p><strong>{take.name}</strong><small>{take.participant_name} · starts {stamp(take.start_seconds)} · offset {take.sync_offset_ms} ms</small></p></div><audio controls preload="none" src={take.audio_url}/><div className="link-decisions"><button className={take.state==="keep"?"active":""} onClick={()=>void decideTake(take,"keep")}>KEEP</button><button onClick={()=>void decideTake(take,"captured")}>REDO</button><button className={take.state==="recovery"?"active recovery":""} onClick={()=>void decideTake(take,"recovery")}>RECOVERY</button></div></article>)}</div>:<div className="link-empty"><strong>No takes yet.</strong><p>Everyone runs a mic check, the director sets a punch point, then Record Everyone starts the synchronized local capture.</p></div>}</section>
    <section className="link-bottom"><div><span>SHARED SESSION NOTES</span><textarea value={notes} readOnly={!canDirect} onChange={e=>setNotes(e.target.value)} placeholder="Direction, punch notes, approvals and handoff details…"/>{canDirect&&<button onClick={()=>void saveNotes()}>SAVE TO ROOM</button>}</div><aside><span>SESSION TRUTH</span><h3>Internet carries direction.<br/>Each device protects the master.</h3><ul><li>Beat cached before the take</li><li>Scheduled shared count-in</li><li>Separate locally captured tracks</li><li>Automatic placement metadata</li><li>DAW-ready ZIP handoff</li></ul></aside></section>
    <input ref={beatInput} hidden type="file" accept="audio/*,.wav,.aiff,.mp3,.m4a" onChange={e=>void loadBeat(e.target.files?.[0])}/>{canDirect&&!snapshot.room.beat_url&&<button className="link-load-beat" onClick={()=>beatInput.current?.click()}>LOAD THE SHARED BEAT</button>}
  </div>;
}
