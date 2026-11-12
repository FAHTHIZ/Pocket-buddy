import AsyncStorage from '@react-native-async-storage/async-storage';
import{NativeEventEmitter,NativeModules}from'react-native';
import{downloadModelFile,getModelFiles}from'./modelLibrary';
import{suspendLocalModel}from'./llm';
import{runtimeState}from'./hardware';
import{saveGenerationJob}from'./database';
import{loadConfig}from'./storage';
import type{ImageShape,MessageAttachment}from'../types';

/**
 * On-device image generation. Runs stable-diffusion.cpp on this phone's CPU through the
 * PocketBuddyDiffusion native module; nothing is sent to a server.
 *
 * The catalog is limited to Stable Diffusion 1.5 fine-tunes with few-step sampling (LCM / Hyper),
 * because they are the largest image models that fit a 6 GB phone with the chat model paused and
 * finish in minutes rather than hours on mid-range CPUs such as the Helio G85.
 */
export type LocalImageModel={
 id:string;title:string;description:string;repo:string;file:string;approxMb:number;license:string;
 steps:number;cfg:number;sampler:string;scheduler?:string;negative:string;
};
export const LOCAL_IMAGE_MODELS:LocalImageModel[]=[
 {id:'dreamshaper8-lcm',title:'DreamShaper 8 LCM',description:'Fast all-rounder: art, fantasy, anime-ish and portraits. 6 steps.',repo:'haven-ai-companion/dreamshaper8-lcm-gguf',file:'DreamShaper8_LCM_q4_0.gguf',approxMb:1625,license:'CreativeML OpenRAIL-M',steps:6,cfg:1.5,sampler:'lcm',negative:'lowres, blurry, bad anatomy, bad hands, extra fingers, deformed, watermark, text, jpeg artifacts'},
 {id:'realvis6-hyper',title:'Realistic Vision 6 Hyper',description:'Photorealistic people and scenes. 6 steps.',repo:'second-state/Realistic_Vision_V6.0_B1-GGUF',file:'realisticVisionV60B1_v51HyperVAE-Q4_0.gguf',approxMb:1570,license:'CreativeML OpenRAIL-M',steps:6,cfg:1.8,sampler:'euler_a',negative:'(deformed iris, deformed pupils), cartoon, 3d, render, lowres, blurry, bad anatomy, bad hands, extra fingers, watermark, text'},
];
export const TAESD={repo:'madebyollin/taesd',file:'diffusion_pytorch_model.safetensors',approxMb:10};
const INSTALLED_KEY='pocket-buddy.local-image-models.v1';

type NativeDiffusion={
 isAvailable():Promise<{available:boolean;detail:string;cores:number;running:boolean}>;
 generate(options:Record<string,unknown>):Promise<{path:string;mimeType:string;size:number;elapsedMs:number;threads:number;engine:string}>;
 cancel():Promise<boolean>;
};
const Native=NativeModules.PocketBuddyDiffusion as NativeDiffusion|undefined;
export type DiffusionProgress={jobId:string;phase:'loading'|'encoding'|'sampling'|'decoding';step?:number;total?:number;secondsPerStep?:number;elapsedMs:number};

export async function localEngineStatus():Promise<{available:boolean;detail:string}>{
 if(!Native?.isAvailable)return{available:false,detail:'This build does not include the on-device image engine. Install the latest Pocket Buddy APK.'};
 try{const value=await Native.isAvailable();return{available:value.available,detail:value.detail};}
 catch(error){return{available:false,detail:error instanceof Error?error.message:String(error)};}
}

export async function installedLocalImageFiles():Promise<Record<string,string>>{
 try{const value=JSON.parse((await AsyncStorage.getItem(INSTALLED_KEY))||'{}');return value&&typeof value==='object'?value:{};}catch{return{};}
}
async function setInstalled(key:string,path:string|null):Promise<void>{
 const current=await installedLocalImageFiles();
 if(path)current[key]=path;else delete current[key];
 await AsyncStorage.setItem(INSTALLED_KEY,JSON.stringify(current));
}
export async function downloadLocalImageModel(id:string,onProgress:(percent:number)=>void):Promise<string>{
 const model=LOCAL_IMAGE_MODELS.find(item=>item.id===id);if(!model)throw new Error('Unknown image model.');
 const files=await getModelFiles(model.repo).catch(()=>[]),meta=files.find(item=>item.name===model.file);
 const path=await downloadModelFile(model.repo,model.file,onProgress,meta?.size,meta?.sha256);
 await setInstalled(id,path);
 // The 10 MB fast decoder cuts ~2 minutes per picture on phone CPUs; fetch it alongside.
 if(!(await installedLocalImageFiles()).taesd)await downloadTaesd(()=>{}).catch(()=>'');
 return path;
}
export async function downloadTaesd(onProgress:(percent:number)=>void):Promise<string>{
 const path=await downloadModelFile(TAESD.repo,TAESD.file,onProgress);
 await setInstalled('taesd',path);return path;
}
export async function forgetLocalImageModel(id:string):Promise<void>{await setInstalled(id,null);}

// ---------------- safety ----------------
// Adult content is allowed. Sexual content involving minors is not, and is refused on-device.
const SEXUAL=/\b(nude|naked|nsfw|sex|sexy|sexual|porn\w*|erotic\w*|lewd|topless|bottomless|lingerie|undress\w*|explicit|hentai|genitals?|breasts?|boobs?|nipples?|penis|vagina|pussy|cock|orgasm|fetish|bdsm|seductive|provocative|strip\w*)\b/i;
const MINOR=/\b(child|children|kid|kids|minor|minors|underage|under-age|preteen|pre-teen|teen|teens|teenage\w*|young girl|young boy|little girl|little boy|schoolgirl|schoolboy|loli\w*|shota\w*|toddler|infant|baby|babies|juvenile|elementary|middle school|high school|jailbait|(?:[1-9]|1[0-7])\s*(?:yo|y\/o|years?\s*old|-year-old))\b/i;
export function refusalFor(prompt:string):string|null{
 if(SEXUAL.test(prompt)&&MINOR.test(prompt))return 'I can’t create sexual or nude imagery involving anyone who is or appears to be under 18.';
 return null;
}
function safetyNegative(prompt:string):string{
 return SEXUAL.test(prompt)?', child, teen, underage, young-looking, childlike':'';
}

// ---------------- generation ----------------
function sizeFor(shape:ImageShape):{width:number;height:number}{
 return shape==='portrait'?{width:512,height:768}:shape==='landscape'?{width:768,height:512}:{width:512,height:512};
}
export type LocalImageProgress=(update:{items:MessageAttachment[];done:number;total:number;status:string})=>void;
let cancelRequested=false;
export async function cancelLocalGeneration():Promise<void>{cancelRequested=true;if(Native?.cancel)await Native.cancel().catch(()=>false);}

export async function generateLocalImages(prompt:string,options:{count:number;shape:ImageShape;modelId?:string},onProgress?:LocalImageProgress):Promise<{attachments:MessageAttachment[];failures:string[]}>{
 const refusal=refusalFor(prompt);if(refusal)throw new Error(refusal);
 const status=await localEngineStatus();if(!status.available)throw new Error(status.detail);
 const config=await loadConfig(),installed=await installedLocalImageFiles();
 const preferred=options.modelId&&installed[options.modelId]?options.modelId:installed[config.localImageModel]?config.localImageModel:LOCAL_IMAGE_MODELS.find(item=>installed[item.id])?.id;
 const model=LOCAL_IMAGE_MODELS.find(item=>item.id===preferred);
 if(!model)throw new Error('Download an on-device image model first: open Models → Image models and tap Download on DreamShaper 8 LCM (about 1.6 GB, Wi-Fi recommended).');
 const total=Math.max(1,Math.min(20,Math.floor(options.count)||1));
 const {width,height}=sizeFor(options.shape);
 const items:MessageAttachment[]=[],failures:string[]=[];
 const report=(text:string)=>onProgress?.({items:[...items],done:items.length+failures.length,total,status:text});

 // A 6 GB phone cannot hold the chat model and the image model at once.
 const memory=await runtimeState().then(value=>value?.memory).catch(()=>null);
 if(!memory||memory.availableMb<3000){report('Pausing the chat model to free memory…');await suspendLocalModel().catch(()=>false);}

 const emitter=new NativeEventEmitter(NativeModules.PocketBuddyDiffusion);
 let current=0,started=Date.now();
 const sub=emitter.addListener('PocketBuddyDiffusionProgress',(raw:any)=>{const event=raw as DiffusionProgress;
  const label=total>1?'Image '+(current+1)+' of '+total+' · ':'';
  if(event.phase==='sampling'&&event.step&&event.total){
   const left=Math.max(0,Math.round((event.total-event.step)*(event.secondsPerStep||0)));
   report(label+'step '+event.step+'/'+event.total+(left?' · about '+(left>90?Math.round(left/60)+' min':left+' s')+' left':''));
  }else report(label+(event.phase==='decoding'?'finishing the picture…':event.phase==='encoding'?'reading your prompt…':'loading the image model… '+Math.round(event.elapsedMs/1000)+' s'));
 });
 cancelRequested=false;
 try{
  for(current=0;current<total;current++){
   if(cancelRequested)break;
   started=Date.now();
   report((total>1?'Image '+(current+1)+' of '+total+' · ':'')+'starting…');
   try{
    const seed=Math.floor(Math.random()*2147483000)+1;
    const result=await Native!.generate({
     mode:'img',jobId:'img-'+current,model:installed[model.id],taesd:config.localImageFastDecode!==false&&installed.taesd?installed.taesd:'',
     prompt:SEXUAL.test(prompt)?prompt+', adult':prompt,negative:model.negative+safetyNegative(prompt),width,height,
     steps:config.localImageSteps>0?config.localImageSteps:model.steps,cfg:model.cfg,sampler:model.sampler,scheduler:model.scheduler||'',
     seed,threads:config.localImageThreads||0,vaeTiling:true,
    });
    const attachment:MessageAttachment={id:'local-'+Date.now().toString(36)+'-'+current,name:'image-'+(current+1)+'.png',uri:'file://'+result.path,mimeType:'image/png',size:result.size,kind:'image',prompt,model:model.title+' · on this phone · '+Math.round((Date.now()-started)/1000)+' s'};
    items.push(attachment);
    await saveGenerationJob({id:attachment.id,kind:'image',prompt,promptId:attachment.id,status:'complete',createdAt:Date.now(),outputs:[JSON.stringify(attachment)]}).catch(()=>{});
   }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(cancelRequested||/cancel/i.test(message))break;
    failures.push(message);
    if(/memory|stopped the image engine|missing|processor|does not include/i.test(message))break;
   }
   report(items.length+' of '+total+' ready');
  }
 }finally{sub.remove();}
 if(!items.length)throw new Error(cancelRequested?'Generation cancelled.':failures[0]||'Nothing was generated.');
 return{attachments:items,failures};
}
