/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const jsonHeaders={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}
async function hashSecret(secret:string){
  const bytes=new TextEncoder().encode(secret);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,"0")).join("");
}
function roomSecret(request:Request,url:URL){return request.headers.get("x-reveryx-key")||url.searchParams.get("key")||"";}
async function authorizeRoom(env:Env,roomId:string,secret:string){
  if(!secret)return false;
  const room=await env.DB.prepare("SELECT secret_hash FROM link_rooms WHERE id = ?1").bind(roomId).first<{secret_hash:string}>();
  return Boolean(room&&room.secret_hash===await hashSecret(secret));
}
async function participant(env:Env,roomId:string,participantId:string){
  return env.DB.prepare("SELECT id, role FROM link_participants WHERE id = ?1 AND room_id = ?2").bind(participantId,roomId).first<{id:string;role:string}>();
}

async function handleLinkApi(request:Request,env:Env,url:URL):Promise<Response>{
  const parts=url.pathname.split("/").filter(Boolean);
  const now=Date.now();
  if(parts.length===3&&parts[0]==="api"&&parts[1]==="link"&&parts[2]==="rooms"&&request.method==="POST"){
    const body=await request.json<{title?:string;songName?:string;bpm?:number;hostName?:string;deviceId?:string}>().catch(()=>({}));
    const roomId=crypto.randomUUID().replaceAll("-","").slice(0,10);
    const secret=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","").slice(0,12);
    const participantId=crypto.randomUUID();
    const sharedState=JSON.stringify({playing:false,currentTime:0,punchPoint:0,recording:false,recordNonce:"",recordStartAt:0,videoEnabled:false,revision:1});
    await env.DB.batch([
      env.DB.prepare("INSERT INTO link_rooms (id, secret_hash, title, song_name, bpm, shared_state, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, ?7)").bind(roomId,await hashSecret(secret),(body.title||"Joint Session").slice(0,80),(body.songName||"Untitled song").slice(0,140),Math.min(300,Math.max(40,Number(body.bpm)||128)),sharedState,now),
      env.DB.prepare("INSERT INTO link_participants (id, room_id, name, role, device_id, status, joined_at, last_seen_at) VALUES (?1, ?2, ?3, 'Host', ?4, 'ready', ?5, ?5)").bind(participantId,roomId,(body.hostName||"Session Host").slice(0,60),(body.deviceId||crypto.randomUUID()).slice(0,100),now),
      env.DB.prepare("INSERT INTO link_events (id, room_id, participant_id, type, payload, created_at) VALUES (?1, ?2, ?3, 'room_created', '{}', ?4)").bind(crypto.randomUUID(),roomId,participantId,now),
    ]);
    return json({roomId,secret,participantId,role:"Host"},201);
  }
  if(parts.length<4||parts[0]!=="api"||parts[1]!=="link"||parts[2]!=="rooms")return json({error:"Not found"},404);
  const roomId=parts[3];
  const secret=roomSecret(request,url);
  if(!await authorizeRoom(env,roomId,secret))return json({error:"This Link Session invitation is invalid or expired."},403);

  if(parts.length===4&&request.method==="GET"){
    const room=await env.DB.prepare("SELECT id, title, song_name, bpm, beat_name, beat_mime, shared_state, notes, created_at, updated_at FROM link_rooms WHERE id = ?1").bind(roomId).first<Record<string,unknown>>();
    if(!room)return json({error:"Room not found"},404);
    const participants=await env.DB.prepare("SELECT id, name, role, status, joined_at, last_seen_at FROM link_participants WHERE room_id = ?1 ORDER BY joined_at ASC").bind(roomId).all();
    const takes=await env.DB.prepare("SELECT t.id, t.participant_id, p.name AS participant_name, t.name, t.mime_type, t.seconds, t.start_seconds, t.sync_offset_ms, t.state, t.created_at FROM link_takes t JOIN link_participants p ON p.id = t.participant_id WHERE t.room_id = ?1 ORDER BY t.created_at DESC LIMIT 60").bind(roomId).all();
    const events=await env.DB.prepare("SELECT e.id, e.participant_id, p.name AS participant_name, e.type, e.payload, e.created_at FROM link_events e LEFT JOIN link_participants p ON p.id = e.participant_id WHERE e.room_id = ?1 ORDER BY e.created_at DESC LIMIT 30").bind(roomId).all();
    return json({room:{...room,shared_state:JSON.parse(String(room.shared_state||"{}")),beat_url:room.beat_name?`/api/link/rooms/${roomId}/beat?key=${encodeURIComponent(secret)}`:null},participants:participants.results,takes:takes.results.map((take:any)=>({...take,audio_url:`/api/link/rooms/${roomId}/takes/${take.id}/audio?key=${encodeURIComponent(secret)}`})),events:events.results.map((event:any)=>({...event,payload:JSON.parse(String(event.payload||"{}"))})),serverTime:now});
  }
  if(parts.length===5&&parts[4]==="join"&&request.method==="POST"){
    const body=await request.json<{name?:string;role?:string;deviceId?:string}>().catch(()=>({}));
    const role=["Performer","Engineer"].includes(body.role||"")?String(body.role):"Performer";
    const participantId=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO link_participants (id, room_id, name, role, device_id, status, joined_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, 'joining', ?6, ?6)").bind(participantId,roomId,(body.name||"Guest").slice(0,60),role,(body.deviceId||crypto.randomUUID()).slice(0,100),now),
      env.DB.prepare("INSERT INTO link_events (id, room_id, participant_id, type, payload, created_at) VALUES (?1, ?2, ?3, 'participant_joined', ?4, ?5)").bind(crypto.randomUUID(),roomId,participantId,JSON.stringify({role}),now),
    ]);
    return json({participantId,role},201);
  }
  if(parts.length===5&&parts[4]==="heartbeat"&&request.method==="POST"){
    const body=await request.json<{participantId?:string;status?:string}>().catch(()=>({}));
    const member=await participant(env,roomId,body.participantId||"");
    if(!member)return json({error:"Participant not found"},404);
    const status=["joining","ready","listening","recording","reviewing","offline"].includes(body.status||"")?body.status:"ready";
    await env.DB.prepare("UPDATE link_participants SET status = ?1, last_seen_at = ?2 WHERE id = ?3 AND room_id = ?4").bind(status,now,member.id,roomId).run();
    return json({ok:true,serverTime:now});
  }
  if(parts.length===5&&parts[4]==="state"&&request.method==="POST"){
    const body=await request.json<{participantId?:string;patch?:Record<string,unknown>;eventType?:string}>().catch(()=>({}));
    const member=await participant(env,roomId,body.participantId||"");
    if(!member)return json({error:"Participant not found"},404);
    if(!["Host","Engineer"].includes(member.role))return json({error:"Only the Host or Engineer can control shared transport."},403);
    const row=await env.DB.prepare("SELECT shared_state FROM link_rooms WHERE id = ?1").bind(roomId).first<{shared_state:string}>();
    const current=JSON.parse(row?.shared_state||"{}");
    const next={...current,...(body.patch||{}),revision:Number(current.revision||0)+1};
    await env.DB.batch([
      env.DB.prepare("UPDATE link_rooms SET shared_state = ?1, updated_at = ?2 WHERE id = ?3").bind(JSON.stringify(next),now,roomId),
      env.DB.prepare("INSERT INTO link_events (id, room_id, participant_id, type, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(crypto.randomUUID(),roomId,member.id,(body.eventType||"state_changed").slice(0,40),JSON.stringify(body.patch||{}),now),
    ]);
    return json({sharedState:next,serverTime:now});
  }
  if(parts.length===5&&parts[4]==="notes"&&request.method==="POST"){
    const body=await request.json<{participantId?:string;notes?:string}>().catch(()=>({}));
    const member=await participant(env,roomId,body.participantId||"");
    if(!member||!["Host","Engineer"].includes(member.role))return json({error:"Only the Host or Engineer can edit session notes."},403);
    await env.DB.prepare("UPDATE link_rooms SET notes = ?1, updated_at = ?2 WHERE id = ?3").bind(String(body.notes||"").slice(0,8000),now,roomId).run();
    return json({ok:true});
  }
  if(parts.length===5&&parts[4]==="beat"){
    if(request.method==="GET"){
      const row=await env.DB.prepare("SELECT beat_key, beat_mime FROM link_rooms WHERE id = ?1").bind(roomId).first<{beat_key:string|null;beat_mime:string|null}>();
      if(!row?.beat_key)return json({error:"No beat loaded"},404);
      const object=await env.BUCKET.get(row.beat_key);
      if(!object)return json({error:"Beat file unavailable"},404);
      return new Response(object.body,{headers:{"content-type":row.beat_mime||"audio/mpeg","cache-control":"private, max-age=3600"}});
    }
    if(request.method==="POST"){
      const form=await request.formData();
      const participantId=String(form.get("participantId")||"");
      const member=await participant(env,roomId,participantId);
      if(!member||!["Host","Engineer"].includes(member.role))return json({error:"Only the Host or Engineer can load the shared beat."},403);
      const file=form.get("file");
      if(!(file instanceof File)||!file.type.startsWith("audio/"))return json({error:"Choose a playable audio file."},400);
      const objectKey=`link/${roomId}/beat/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;
      await env.BUCKET.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type}});
      await env.DB.batch([
        env.DB.prepare("UPDATE link_rooms SET beat_key = ?1, beat_name = ?2, beat_mime = ?3, song_name = ?2, updated_at = ?4 WHERE id = ?5").bind(objectKey,file.name,file.type,now,roomId),
        env.DB.prepare("INSERT INTO link_events (id, room_id, participant_id, type, payload, created_at) VALUES (?1, ?2, ?3, 'beat_loaded', ?4, ?5)").bind(crypto.randomUUID(),roomId,participantId,JSON.stringify({name:file.name}),now),
      ]);
      return json({ok:true,name:file.name});
    }
  }
  if(parts.length===5&&parts[4]==="takes"&&request.method==="POST"){
    const form=await request.formData();
    const participantId=String(form.get("participantId")||"");
    const member=await participant(env,roomId,participantId);
    if(!member)return json({error:"Participant not found"},404);
    const file=form.get("file");
    if(!(file instanceof File))return json({error:"Missing vocal take"},400);
    const takeId=crypto.randomUUID();
    const objectKey=`link/${roomId}/takes/${takeId}`;
    await env.BUCKET.put(objectKey,file.stream(),{httpMetadata:{contentType:file.type||"audio/webm"}});
    const seconds=Math.max(0,Number(form.get("seconds"))||0);
    const startSeconds=Math.max(0,Number(form.get("startSeconds"))||0);
    const syncOffsetMs=Math.round(Number(form.get("syncOffsetMs"))||0);
    const name=String(form.get("name")||"Vocal take").slice(0,100);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO link_takes (id, room_id, participant_id, name, object_key, mime_type, seconds, start_seconds, sync_offset_ms, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'captured', ?10)").bind(takeId,roomId,participantId,name,objectKey,file.type||"audio/webm",seconds,startSeconds,syncOffsetMs,now),
      env.DB.prepare("INSERT INTO link_events (id, room_id, participant_id, type, payload, created_at) VALUES (?1, ?2, ?3, 'take_uploaded', ?4, ?5)").bind(crypto.randomUUID(),roomId,participantId,JSON.stringify({takeId,name,startSeconds,syncOffsetMs}),now),
    ]);
    return json({takeId,objectKey},201);
  }
  if(parts.length===7&&parts[4]==="takes"&&parts[6]==="audio"&&request.method==="GET"){
    const take=await env.DB.prepare("SELECT object_key, mime_type FROM link_takes WHERE id = ?1 AND room_id = ?2").bind(parts[5],roomId).first<{object_key:string;mime_type:string}>();
    if(!take)return json({error:"Take not found"},404);
    const object=await env.BUCKET.get(take.object_key);
    if(!object)return json({error:"Take audio unavailable"},404);
    return new Response(object.body,{headers:{"content-type":take.mime_type,"cache-control":"private, max-age=3600"}});
  }
  if(parts.length===6&&parts[4]==="takes"&&request.method==="PATCH"){
    const body=await request.json<{participantId?:string;state?:string}>().catch(()=>({}));
    const member=await participant(env,roomId,body.participantId||"");
    if(!member)return json({error:"Participant not found"},404);
    const take=await env.DB.prepare("SELECT participant_id FROM link_takes WHERE id = ?1 AND room_id = ?2").bind(parts[5],roomId).first<{participant_id:string}>();
    if(!take)return json({error:"Take not found"},404);
    if(take.participant_id!==member.id&&!["Host","Engineer"].includes(member.role))return json({error:"You cannot change this take."},403);
    const state=["captured","keep","recovery"].includes(body.state||"")?body.state:"captured";
    await env.DB.prepare("UPDATE link_takes SET state = ?1 WHERE id = ?2 AND room_id = ?3").bind(state,parts[5],roomId).run();
    return json({ok:true,state});
  }
  return json({error:"Not found"},404);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if(url.pathname.startsWith("/api/link/"))return handleLinkApi(request,env,url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
