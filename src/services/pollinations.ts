import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeModules} from 'react-native';
import {getPollinationsKey} from './storage';
import type {AudioStyle,ImageShape,MediaKind} from '../types';

/**
 * Pollinations (https://pollinations.ai) is Pocket Buddy's built-in media engine.
 * Without a key, images come from the free public endpoint (about one image every
 * 45 seconds per network). After "Connect Pollinations" (device sign-in), the
 * user's own key unlocks fast batches, video, music, speech and sound effects.
 */
const GEN='https://gen.pollinations.ai';
const LEGACY_IMAGE='https://image.pollinations.ai/prompt/';
const ENTER='https://enter.pollinations.ai';
const CATALOG_KEY='pocket-buddy.pollinations.catalog.v1';
const CATALOG_TTL=6*60*60*1000;

type NativeMedia={
 fetchToFile(url:string,method:string,headers:Record<string,string>,body:string|null,fallbackExtension:string,timeoutMs:number):Promise<NativeFetchResult>;
};
export type NativeFetchResult={type:'file';status:number;path:string;mimeType:string;size:number;thumbnail?:string}|{type:'text';status:number;mimeType:string;body:string;retryAfter:string};
export type GeneratedFile={path:string;mimeType:string;size:number;thumbnail?:string};
const Media=NativeModules.PocketBuddyMedia as NativeMedia|undefined;

export type MediaModel={id:string;title:string;description:string;kind:MediaKind;audioStyle?:AudioStyle;paid:boolean;durations?:number[];minDuration?:number;maxDuration?:number;audioOutput?:boolean};

export class MediaError extends Error{code:string;constructor(code:string,message:string){super(message);this.code=code;}}

function nativeMedia():NativeMedia{
 if(!Media?.fetchToFile)throw new MediaError('NATIVE_MISSING','Media generation needs the latest Pocket Buddy APK. Reinstall from the latest release.');
 return Media;
}

// ---------- Sign in (OAuth device flow, no app registration required) ----------
export type DeviceSignIn={deviceCode:string;userCode:string;verificationUrl:string;interval:number;expiresAt:number};
export async function startPollinationsSignIn():Promise<DeviceSignIn>{
 const response=await fetch(ENTER+'/api/device/code',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({scope:'generate profile usage',expiry:365,budget:10,models:'text,image,video,audio'})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.device_code)throw new Error('Pollinations sign-in is unavailable right now (HTTP '+response.status+'). You can paste a key from enter.pollinations.ai instead.');
 return{deviceCode:String(data.device_code),userCode:String(data.user_code||''),verificationUrl:String(data.verification_uri_complete||data.verification_uri||ENTER+'/device'),interval:Math.max(3,Number(data.interval)||5),expiresAt:Date.now()+(Number(data.expires_in)||1800)*1000};
}
/** Returns the key when approved, '' while pending. Throws if denied or expired. */
export async function pollPollinationsSignIn(deviceCode:string):Promise<string>{
 const response=await fetch(ENTER+'/api/device/token',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({device_code:deviceCode})});
 const data=await response.json().catch(()=>({}));
 if(typeof data.access_token==='string'&&data.access_token)return data.access_token;
 const error=String(data.error||'');
 if(!error||error==='authorization_pending'||error==='slow_down')return '';
 if(error==='expired_token')throw new Error('The sign-in code expired. Start again.');
 if(error==='access_denied')throw new Error('Sign-in was cancelled.');
 throw new Error('Sign-in failed: '+error);
}
export async function getPollinationsAccount(key:string):Promise<{name:string;balance?:number}>{
 const headers={Authorization:'Bearer '+key,Accept:'application/json'};
 let name='',balance:number|undefined;
 try{const r=await fetch(ENTER+'/api/oauth/userinfo',{headers});if(r.ok){const d=await r.json();name=String(d.name||d.preferred_username||d.email||'');}}catch{}
 try{const r=await fetch(GEN+'/account/balance',{headers});if(r.ok){const d=await r.json();const value=Number(d.balance??d.total??d.pollen);if(Number.isFinite(value))balance=value;}}catch{}
 return{name,balance};
}
export async function verifyPollinationsKey(key:string):Promise<void>{
 const clean=key.trim();
 if(!/^sk_[A-Za-z0-9_-]{8,}$/.test(clean))throw new Error('Pollinations secret keys start with sk_. Copy one from enter.pollinations.ai/keys.');
 const response=await fetch(GEN+'/image/models',{headers:{Authorization:'Bearer '+clean}});
 if(response.status===401||response.status===403)throw new Error('Pollinations rejected this key.');
}

// ---------- Model catalog ----------
const AUDIO_EXCLUDE=/transcribe|whisper|scribe|universal-|isolator|stem-separation|sts-|voice-changer|sonilo|dialogue/i;
const VIDEO_EXCLUDE=/mirelo\/sfx/i;
function audioStyleFor(id:string,description:string):AudioStyle{
 if(/music|lyria|stable-audio/i.test(id))return 'music';
 if(/sound|sfx/i.test(id)||/sound effect/i.test(description))return 'sfx';
 return 'speech';
}
function mapModels(kind:MediaKind,rows:any[]):MediaModel[]{
 return (Array.isArray(rows)?rows:[]).filter(row=>typeof row?.name==='string'&&!String(row.name).startsWith('community/')).filter(row=>{
  const id=String(row.name),out:string[]=Array.isArray(row.output_modalities)?row.output_modalities:[];
  if(kind==='audio')return out.includes('audio')&&!AUDIO_EXCLUDE.test(id);
  if(kind==='video')return out.includes('video')&&!VIDEO_EXCLUDE.test(id);
  return out.includes('image')&&!/edit$/i.test(id);
 }).map(row=>{
  const id=String(row.name),description=String(row.description||'');
  return{id,title:String(row.title||id.split('/').pop()),description,kind,paid:row.paid_only===true,
   audioStyle:kind==='audio'?audioStyleFor(id,description):undefined,
   durations:Array.isArray(row.allowed_durations)?row.allowed_durations.map(Number).filter(Number.isFinite):undefined,
   minDuration:Number.isFinite(Number(row.min_duration))?Number(row.min_duration):undefined,
   maxDuration:Number.isFinite(Number(row.max_duration))?Number(row.max_duration):undefined,
   audioOutput:Array.isArray(row.video_capabilities)?row.video_capabilities.includes('audio_output'):undefined};
 });
}
const FALLBACK:MediaModel[]=[
 {id:'tongyi-mai/z-image-turbo',title:'Z-Image Turbo',description:'Fast, crisp images',kind:'image',paid:false},
 {id:'black-forest-labs/flux.1-schnell',title:'FLUX.1 Schnell',description:'Fast FLUX images',kind:'image',paid:false},
 {id:'lykon/dreamshaper-8-lcm',title:'DreamShaper 8',description:'Near-instant images',kind:'image',paid:false},
 {id:'black-forest-labs/flux.1.1-pro',title:'FLUX 1.1 Pro',description:'High quality images',kind:'image',paid:false},
 {id:'alibaba/wan-2.2-fast',title:'Wan 2.2 Fast',description:'Low-cost 5-second clips',kind:'video',paid:true,durations:[5]},
 {id:'google/veo-3.1-fast',title:'Veo 3.1 Fast',description:'Video with optional sound',kind:'video',paid:true,durations:[4,6,8],audioOutput:true},
 {id:'elevenlabs/music-v2',title:'Eleven Music v2',description:'Studio-grade music',kind:'audio',audioStyle:'music',paid:true,minDuration:3,maxDuration:300},
 {id:'openai/tts-1',title:'OpenAI TTS',description:'Natural speech',kind:'audio',audioStyle:'speech',paid:false},
 {id:'elevenlabs/eleven-text-to-sound-v2',title:'Eleven Sound Effects',description:'Sound effects from text',kind:'audio',audioStyle:'sfx',paid:true},
];
export async function listMediaModels(force=false):Promise<MediaModel[]>{
 if(!force){
  try{const cached=JSON.parse((await AsyncStorage.getItem(CATALOG_KEY))||'null');if(cached&&Date.now()-cached.at<CATALOG_TTL&&Array.isArray(cached.models)&&cached.models.length)return cached.models;}catch{}
 }
 try{
  const key=await getPollinationsKey().catch(()=>'');
  const headers:Record<string,string>={Accept:'application/json',...(key?{Authorization:'Bearer '+key}:{})};
  const [images,videos,audio]=await Promise.all((['image','video','audio'] as MediaKind[]).map(async kind=>{
   const response=await fetch(GEN+'/'+kind+'/models',{headers});
   if(!response.ok)throw new Error('HTTP '+response.status);
   return mapModels(kind,await response.json());
  }));
  const models=[...images,...videos,...audio];
  if(models.length){await AsyncStorage.setItem(CATALOG_KEY,JSON.stringify({at:Date.now(),models}));return models;}
 }catch{}
 return FALLBACK;
}
export function fallbackModels():MediaModel[]{return FALLBACK;}

// ---------- Generation ----------
function dims(shape:ImageShape):{width:number;height:number}{
 return shape==='portrait'?{width:832,height:1216}:shape==='landscape'?{width:1216,height:832}:{width:1024,height:1024};
}
function randomSeed():number{return Math.floor(Math.random()*2147483000)+1;}
function cleanPrompt(prompt:string):string{return prompt.replace(/\s+/g,' ').trim().slice(0,1800);}
function errorMessage(result:Extract<NativeFetchResult,{type:'text'}>):string{
 let message='';
 try{const data=JSON.parse(result.body);message=String(data?.error?.message||data?.message||data?.error||'');}catch{message=result.body.slice(0,300);}
 if(result.status===401)return 'Connect Pollinations in Settings to use this model.';
 if(result.status===402)return message||'Your Pollinations balance is too low for this model. Pick a free model or top up at enter.pollinations.ai.';
 if(result.status===403)return message||'This Pollinations key is not allowed to use this model.';
 if(result.status===429)return message||'Pollinations is rate limiting requests. Try again in a moment.';
 return (message||'Pollinations returned HTTP '+result.status)+(result.status>=500?' (temporary server problem; try again)':'');
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(()=>resolve(),ms));

async function fetchMedia(url:string,key:string,extension:string,timeoutMs:number,asyncJob=false,onWait?:(message:string)=>void):Promise<GeneratedFile>{
 const headers:Record<string,string>={Accept:'*/*'};
 if(key)headers.Authorization='Bearer '+key;
 if(asyncJob)headers.Prefer='respond-async';
 let result=await nativeMedia().fetchToFile(url,'GET',headers,null,extension,timeoutMs);
 if(result.type==='text'&&(result.status===202||(result.status===200&&/json/.test(result.mimeType)))){
  let job:any={};try{job=JSON.parse(result.body);}catch{}
  const id=String(job.id||'');
  if(!id)throw new MediaError('BAD_RESPONSE','Pollinations returned an unexpected response.');
  const started=Date.now();
  while(Date.now()-started<20*60*1000){
   await sleep(5000);
   const statusResponse=await fetch(GEN+'/v1/jobs/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+key,Accept:'application/json'}});
   const status=await statusResponse.json().catch(()=>({}));
   const state=String(status.status||'');
   if(state==='succeeded'){result=await nativeMedia().fetchToFile(GEN+'/v1/jobs/'+encodeURIComponent(id)+'/result','GET',{Authorization:'Bearer '+key},null,extension,timeoutMs);break;}
   if(state==='failed'||state==='cancelled'||state==='canceled')throw new MediaError('JOB_FAILED',String(status.error?.message||status.error||'The generation failed on the server.'));
   onWait?.('Rendering… '+Math.round((Date.now()-started)/1000)+'s');
  }
 }
 if(result.type==='file')return{path:result.path,mimeType:result.mimeType||(extension==='mp4'?'video/mp4':extension==='mp3'?'audio/mpeg':'image/jpeg'),size:result.size,thumbnail:result.thumbnail};
 throw new MediaError('HTTP_'+result.status,errorMessage(result));
}

export async function generateImage(prompt:string,options:{model:string;shape:ImageShape;seed?:number},onWait?:(message:string)=>void):Promise<GeneratedFile>{
 const key=await getPollinationsKey().catch(()=>'');
 const {width,height}=dims(options.shape),seed=options.seed??randomSeed(),text=encodeURIComponent(cleanPrompt(prompt));
 if(key){
  const url=GEN+'/image/'+text+'?model='+encodeURIComponent(options.model||'tongyi-mai/z-image-turbo')+'&width='+width+'&height='+height+'&seed='+seed+'&nologo=true&safe=false';
  for(let attempt=0;;attempt++){
   try{return await fetchMedia(url,key,'jpg',180000);}
   catch(error){
    if(error instanceof MediaError&&(error.code==='HTTP_429'||error.code.startsWith('HTTP_5'))&&attempt<3){onWait?.('Busy, retrying…');await sleep(4000*(attempt+1));continue;}
    throw error;
   }
  }
 }
 // Free public endpoint: no key, one image about every 45 seconds per network.
 const url=LEGACY_IMAGE+text+'?width='+width+'&height='+height+'&seed='+seed+'&nologo=true';
 for(let attempt=0;attempt<30;attempt++){
  const result=await nativeMedia().fetchToFile(url,'GET',{Accept:'image/*'},null,'jpg',180000);
  if(result.type==='file')return{path:result.path,mimeType:result.mimeType||'image/jpeg',size:result.size};
  if(result.status===402||result.status===429){
   const match=result.body.match(/after (\d+)s/i),wait=Math.max(5,Math.min(60,match?Number(match[1])+1:Number(result.retryAfter)||20));
   for(let left=wait;left>0;left--){onWait?.('Free mode: next image in '+left+'s · connect Pollinations for instant batches');await sleep(1000);}
   continue;
  }
  throw new MediaError('HTTP_'+result.status,errorMessage(result));
 }
 throw new MediaError('FREE_LIMIT','The free image service is busy. Connect Pollinations in Settings for fast generation.');
}

function pickDuration(model:MediaModel|undefined,requested:number):number{
 if(model?.durations?.length){return model.durations.reduce((best,value)=>Math.abs(value-requested)<Math.abs(best-requested)?value:best,model.durations[0]);}
 const min=model?.minDuration??2,max=model?.maxDuration??10;
 return Math.max(min,Math.min(max,Math.round(requested)));
}
export async function generateVideo(prompt:string,options:{model:string;duration:number;shape:ImageShape;audio:boolean;catalog?:MediaModel[]},onWait?:(message:string)=>void):Promise<GeneratedFile>{
 const key=await getPollinationsKey().catch(()=>'');
 if(!key)throw new MediaError('KEY_REQUIRED','Video needs a connected Pollinations account. Open Settings → Media and tap Connect Pollinations.');
 const model=options.catalog?.find(item=>item.id===options.model),duration=pickDuration(model,options.duration);
 const aspect=options.shape==='portrait'?'9:16':'16:9';
 const url=GEN+'/video/'+encodeURIComponent(cleanPrompt(prompt))+'?model='+encodeURIComponent(options.model||'alibaba/wan-2.2-fast')+'&duration='+duration+'&aspectRatio='+encodeURIComponent(aspect)+(options.audio?'&audio=true':'')+'&seed='+randomSeed();
 return fetchMedia(url,key,'mp4',900000,true,onWait);
}
export async function generateAudio(prompt:string,options:{model:string;style:AudioStyle;voice:string;duration?:number},onWait?:(message:string)=>void):Promise<GeneratedFile>{
 const key=await getPollinationsKey().catch(()=>'');
 if(!key)throw new MediaError('KEY_REQUIRED','Audio needs a connected Pollinations account. Open Settings → Media and tap Connect Pollinations.');
 let url=GEN+'/audio/'+encodeURIComponent(cleanPrompt(prompt))+'?model='+encodeURIComponent(options.model);
 if(options.style==='speech')url+='&voice='+encodeURIComponent(options.voice||'nova');
 if(options.style==='music'&&options.duration&&!/lyria/i.test(options.model))url+='&duration='+Math.max(5,Math.min(180,Math.round(options.duration)));
 if(options.style==='sfx'&&options.duration)url+='&duration='+Math.max(1,Math.min(22,Math.round(options.duration)));
 return fetchMedia(url,key,'mp3',600000,options.style!=='speech',onWait);
}
export const POLLINATIONS_VOICES=['nova','alloy','echo','fable','onyx','shimmer','coral','sage','ash','ballad','verse'];
export const POLLINATIONS_KEYS_URL=ENTER+'/keys';
