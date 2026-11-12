import AsyncStorage from '@react-native-async-storage/async-storage';
import{NativeEventEmitter,NativeModules}from'react-native';
import{downloadModelFile,getModelFiles}from'./modelLibrary';
import{suspendLocalModel}from'./llm';
import{saveGenerationJob}from'./database';
import{refusalFor,localEngineStatus,type DiffusionProgress}from'./localImage';
import type{MessageAttachment}from'../types';

/**
 * Experimental on-device text-to-video: Wan 2.1 T2V 1.3B (Apache 2.0, GGUF Q4_K_S) accelerated with
 * the CausVid few-step LoRA (cfg 1, 6 steps) and decoded by the TAEW 2.1 tiny autoencoder.
 * Clips are short (1–2 s at 416×240) and take roughly 8–20 minutes on a mid-range phone CPU.
 */
type PackFile={key:string;repo:string;file:string;approxMb:number;url?:string;sha256?:string};
export const VIDEO_PACK:PackFile[]=[
 {key:'model',repo:'off-grid-ai/Wan2.1-T2V-1.3B-GGUF',file:'Wan2.1-T2V-1.3B-Q4_K_S.gguf',approxMb:778},
 {key:'t5',repo:'off-grid-ai/Video-Companions-GGUF',file:'umt5-xxl-encoder-Q4_K_M.gguf',approxMb:3486},
 {key:'lora',repo:'Kijai/WanVideo_comfy',file:'Wan21_CausVid_bidirect2_T2V_1_3B_lora_rank32.safetensors',approxMb:87},
 {key:'tae',repo:'madebyollin/taehv',file:'taew2_1.safetensors',approxMb:22,url:'https://github.com/madebyollin/taehv/raw/refs/heads/main/safetensors/taew2_1.safetensors'},
];
export const VIDEO_PACK_MB=VIDEO_PACK.reduce((sum,item)=>sum+item.approxMb,0);
const KEY='pocket-buddy.local-video-pack.v1';
export async function installedVideoPack():Promise<Record<string,string>>{
 try{const value=JSON.parse((await AsyncStorage.getItem(KEY))||'{}');return value&&typeof value==='object'?value:{};}catch{return{};}
}
export async function videoPackReady():Promise<boolean>{const files=await installedVideoPack();return VIDEO_PACK.every(item=>!!files[item.key]);}
export async function forgetVideoPack():Promise<string[]>{const files=await installedVideoPack();await AsyncStorage.removeItem(KEY);return Object.values(files);}
export async function downloadVideoPack(onProgress:(label:string,percent:number)=>void):Promise<void>{
 const current=await installedVideoPack();
 for(const item of VIDEO_PACK){
  if(current[item.key])continue;
  const meta=item.url?undefined:(await getModelFiles(item.repo).catch(()=>[])).find(entry=>entry.name===item.file);
  const path=await downloadModelFile(item.repo,item.file,percent=>onProgress(item.file,percent),meta?.size,meta?.sha256,item.url);
  current[item.key]=path;await AsyncStorage.setItem(KEY,JSON.stringify(current));
 }
}

export type VideoShape='landscape'|'portrait';
const NEGATIVE='blurry, low quality, static, still image, worst quality, jpeg artifacts, deformed, distorted, extra limbs, watermark, text, subtitles';
const sexual=/\b(nude|naked|nsfw|sex|sexy|sexual|porn\w*|erotic\w*|lewd|topless|lingerie|explicit)\b/i;

/** seconds → Wan frame count (4n+1) at 16 fps, capped for phone memory. */
function framesFor(seconds:number):number{const frames=Math.round(Math.max(1,Math.min(3,seconds))*16);return Math.max(9,Math.min(49,Math.floor(frames/4)*4+1));}

export async function generateLocalVideo(prompt:string,options:{shape:VideoShape;seconds:number},onProgress?:(update:{items:MessageAttachment[];done:number;total:number;status:string})=>void):Promise<MessageAttachment>{
 const refusal=refusalFor(prompt);if(refusal)throw new Error(refusal);
 const status=await localEngineStatus();if(!status.available)throw new Error(status.detail);
 const files=await installedVideoPack();
 if(!VIDEO_PACK.every(item=>files[item.key]))throw new Error('Download the on-device video pack first: Models → Images & video · on this phone (about '+(VIDEO_PACK_MB/1024).toFixed(1)+' GB, Wi-Fi recommended).');
 const report=(text:string)=>onProgress?.({items:[],done:0,total:1,status:text});
 report('Pausing the chat model to free memory…');await suspendLocalModel().catch(()=>false);
 const width=options.shape==='portrait'?240:416,height=options.shape==='portrait'?416:240,frames=framesFor(options.seconds);
 const loraPath=files.lora,loraDir=loraPath.slice(0,loraPath.lastIndexOf('/')),loraName=loraPath.slice(loraPath.lastIndexOf('/')+1).replace(/\.safetensors$/i,'');
 const emitter=new NativeEventEmitter(NativeModules.PocketBuddyDiffusion),started=Date.now();
 const sub=emitter.addListener('PocketBuddyDiffusionProgress',(raw:any)=>{
  const event=raw as DiffusionProgress;
  if(event.phase==='sampling'&&event.step&&event.total){const left=Math.round((event.total-event.step)*(event.secondsPerStep||0));report('Video · step '+event.step+'/'+event.total+(left?' · about '+Math.max(1,Math.round(left/60))+' min left':''));}
  else report(event.phase==='decoding'?'Video · turning frames into an MP4…':event.phase==='encoding'?'Video · reading your prompt (large text encoder)…':'Video · loading models… '+Math.round(event.elapsedMs/1000)+' s');
 });
 try{
  const result:any=await NativeModules.PocketBuddyDiffusion.generate({
   mode:'vid',jobId:'vid',model:files.model,t5xxl:files.t5,taesd:files.tae,loraDir,
   prompt:(sexual.test(prompt)?prompt+', adults':prompt)+'<lora:'+loraName+':0.7>',negative:NEGATIVE+(sexual.test(prompt)?', child, teen, underage':''),
   width,height,steps:6,cfg:1.0,sampler:'euler',seed:Math.floor(Math.random()*2147483000)+1,threads:0,frames,flowShift:5.0,fps:16,vaeTiling:true,
  });
  const attachment:MessageAttachment={id:'localvid-'+Date.now().toString(36),name:'video.mp4',uri:'file://'+result.path,mimeType:result.mimeType||'video/mp4',size:result.size,kind:'video',thumbnail:result.thumbnail?'file://'+result.thumbnail:undefined,prompt,model:'Wan 2.1 1.3B · on this phone · '+Math.round((Date.now()-started)/60000)+' min'};
  await saveGenerationJob({id:attachment.id,kind:'video',prompt,promptId:attachment.id,status:'complete',createdAt:Date.now(),outputs:[JSON.stringify(attachment)]}).catch(()=>{});
  return attachment;
 }finally{sub.remove();}
}
