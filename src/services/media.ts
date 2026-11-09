import{saveGenerationJob,listGenerationJobs,updateGenerationJob,deleteGenerationJob}from'./database';
import{getComfyToken,getPollinationsKey,loadConfig}from'./storage';
import type{AudioStyle,GenerationJob,MediaKind,MediaRequest,MessageAttachment}from'../types';
import{generateAudio,generateImage,generateVideo,listMediaModels,type GeneratedFile}from'./pollinations';
import{NativeModules}from'react-native';
function replacePrompt(value:any,prompt:string):any{
 if(typeof value==='string')return value.replaceAll('{{prompt}}',prompt).replaceAll('__PROMPT__',prompt);
 if(Array.isArray(value))return value.map(item=>replacePrompt(item,prompt));
 if(value&&typeof value==='object'){const next:Record<string,unknown>={};for(const [key,child]of Object.entries(value))next[key]=replacePrompt(child,prompt);return next;}
 return value;
}
async function request(path:string,init:RequestInit={}):Promise<any>{
 const config=await loadConfig();if(!config.comfyUrl.trim())throw new Error('Connect a ComfyUI server in Settings to use media generation.');
 let endpoint:URL;try{endpoint=new URL(config.comfyUrl.trim());}catch{throw new Error('Enter a valid ComfyUI HTTPS URL in Settings.');}
 if(endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('ComfyUI endpoints must use HTTPS and must not contain embedded credentials, query strings or fragments.');
 const token=await getComfyToken(),headers:Record<string,string>={'Content-Type':'application/json',...(init.headers as Record<string,string>||{})};
 if(token)headers.Authorization='Bearer '+token;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(endpoint.toString().replace(/\/+$/,'')+path,{...init,headers,signal:controller.signal});
  const raw=await response.text();
  if(!response.ok)throw new Error('ComfyUI returned HTTP '+response.status+': '+raw.slice(0,500));
  if(!raw.trim())return{};
  try{return JSON.parse(raw);}catch{throw new Error('ComfyUI returned an unsupported response.');}
 }catch(error){
  if(controller.signal.aborted)throw new Error('The ComfyUI request timed out after 60 seconds.');
  throw error;
 }finally{clearTimeout(timeout);}
}
async function submitOne(kind:MediaKind,prompt:string):Promise<string>{
 const config=await loadConfig(),json=kind==='image'?config.imageWorkflow:kind==='video'?config.videoWorkflow:config.audioWorkflow;
 if(!json.trim())throw new Error('Add an API-format '+kind+' workflow in Settings. Put {{prompt}} in its positive prompt text input.');
 let workflow:any;try{workflow=JSON.parse(json);}catch{throw new Error('The saved ComfyUI workflow is not valid JSON.');}
 const result=await request('/prompt',{method:'POST',body:JSON.stringify({prompt:replacePrompt(workflow,prompt)})});
 if(!result.prompt_id)throw new Error(result.error?.message||'ComfyUI did not return a prompt ID. Check the workflow API export.');
 return String(result.prompt_id);
}
export async function submitMediaJobs(kind:MediaKind,prompt:string,count=1):Promise<GenerationJob[]>{
 const amount=Math.max(1,Math.min(20,Math.floor(count)||1)),jobs:GenerationJob[]=[];
 for(let index=0;index<amount;index++){
  const distinct=amount===1?prompt:prompt+'\nGenerate a distinct variation, variation '+(index+1)+' of '+amount+'.';
  const promptId=await submitOne(kind,distinct);
  const createdAt=Date.now(),job:GenerationJob={id:kind+'-'+promptId,kind,prompt:distinct,promptId,status:'queued',createdAt,outputs:[]};
  await saveGenerationJob(job);jobs.push(job);
 }
 return jobs;
}
function queueContains(items:unknown,promptId:string):boolean{
 if(!Array.isArray(items))return false;
 return items.some(item=>{
  if(Array.isArray(item))return item[1]===promptId;
  if(item&&typeof item==='object'){
   const value=item as Record<string,unknown>;
   return value.prompt_id===promptId||value.id===promptId;
  }
  return false;
 });
}
async function getQueueState(promptId:string):Promise<{running:boolean;pending:boolean}>{
 const queue=await request('/queue');
 return{
  running:queueContains(queue.queue_running,promptId),
  pending:queueContains(queue.queue_pending,promptId),
 };
}
export async function refreshMediaJob(promptId:string):Promise<string>{
 const history=await request('/history/'+encodeURIComponent(promptId)),entry=history[promptId];
 if(!entry){
  const queue=await getQueueState(promptId);
  const status=queue.running?'running':queue.pending?'queued':'unknown';
  await updateGenerationJob(promptId,status);
  return status;
 }
 const outputs:string[]=[];
 for(const node of Object.values(entry.outputs||{})as any[]){
  for(const file of [...(node.images||[]),...(node.gifs||[]),...(node.videos||[]),...(node.audio||[]),...(node.audio_files||[])]){
   if(file.filename)outputs.push(JSON.stringify({filename:String(file.filename),subfolder:String(file.subfolder||''),type:String(file.type||'output')}));
  }
 }
 const statusText=String(entry.status?.status_str||'').toLowerCase();
 const failed=statusText==='error'||statusText==='failed';
 const completed=entry.status?.completed===true||statusText==='success';
 const status=failed?'failed':completed?'complete':statusText==='running'?'running':statusText==='pending'?'queued':'unknown';
 await updateGenerationJob(promptId,status,outputs);
 return status+(outputs.length?': '+outputs.length+' output file(s)':'');
}
export async function readMediaJobs():Promise<GenerationJob[]>{return listGenerationJobs();}

export async function testMediaSetup():Promise<string[]>{
 const config=await loadConfig();
 if(!config.comfyUrl.trim())throw new Error('Enter your ComfyUI HTTPS server URL first.');
 const [stats,objectInfo]=await Promise.all([request('/system_stats'),request('/object_info')]);
 const report:string[]=['ComfyUI API: reachable'];
 const system=stats?.system||{};
 if(system.ram_total)report.push('Server RAM: '+Math.round(Number(system.ram_total)/1073741824*10)/10+' GB');
 for(const [kind,raw] of [['Image',config.imageWorkflow],['Video',config.videoWorkflow],['Audio',config.audioWorkflow]] as const){
  if(!raw.trim()){report.push(kind+' workflow: not configured');continue;}
  let workflow:any;
  try{workflow=JSON.parse(raw);}catch{report.push(kind+' workflow: invalid JSON');continue;}
  if(!workflow||typeof workflow!=='object'||Array.isArray(workflow)){report.push(kind+' workflow: expected API-format node JSON');continue;}
  const nodes=Object.values(workflow) as any[];
  if(!nodes.length){report.push(kind+' workflow: contains no nodes');continue;}
  const nodeTypes=[...new Set(nodes.map(node=>typeof node?.class_type==='string'?node.class_type:'').filter(Boolean))];
  if(!nodeTypes.length){report.push(kind+' workflow: export the workflow in ComfyUI API format');continue;}
  const missing=nodeTypes.filter(type=>!Object.prototype.hasOwnProperty.call(objectInfo||{},type));
  report.push(missing.length
   ?kind+' workflow: missing node classes: '+missing.slice(0,8).join(', ')+(missing.length>8?'…':'')
   :kind+' workflow: '+nodes.length+' nodes recognized; referenced node classes are installed');
 }
 report.push('This check does not verify model-weight files or guarantee a successful generation.');
 return report;
}
export async function cancelMediaJob(promptId:string):Promise<void>{
 const job=(await listGenerationJobs()).find(item=>item.promptId===promptId);
 if(!job)throw new Error('That generation job is not in this Pocket Buddy media library.');
 const before=await getQueueState(promptId);
 if(before.running){
  await updateGenerationJob(promptId,'running');
  throw new Error('This job is already running. It cannot be removed from the pending queue.');
 }
 if(!before.pending){
  await refreshMediaJob(promptId);
  throw new Error('This job is no longer pending in the ComfyUI queue.');
 }
 await request('/queue',{method:'POST',body:JSON.stringify({delete:[promptId]})});
 const after=await getQueueState(promptId);
 if(after.running){
  await updateGenerationJob(promptId,'running');
  throw new Error('The job started before the queue removal took effect; it is still running.');
 }
 if(after.pending)throw new Error('ComfyUI still reports this job as pending. Refresh and try again.');
 const history=await request('/history/'+encodeURIComponent(promptId));
 if(history[promptId]){
  await refreshMediaJob(promptId);
  throw new Error('The job finished before cancellation was confirmed.');
 }
 await updateGenerationJob(promptId,'cancelled');
}

// ---------- Built-in media engine (Pollinations) ----------
export type MediaProgress=(update:{items:MessageAttachment[];done:number;total:number;status:string})=>void;
export type MediaOutcome={attachments:MessageAttachment[];failures:string[];queued:GenerationJob[];engine:'pollinations'|'comfyui'};
const LIMITS:Record<MediaKind,number>={image:20,video:4,audio:4};
export function detectAudioStyle(text:string):AudioStyle{
 if(/\b(say|speak|speech|voice ?over|narrat\w*|read (this|it|out)|tts|pronounce)\b/i.test(text))return 'speech';
 if(/\b(sound effects?|sfx|foley|noise of|sound of)\b/i.test(text))return 'sfx';
 return 'music';
}
async function runPool<T>(total:number,concurrency:number,task:(index:number)=>Promise<T>):Promise<void>{
 let next=0;
 const worker=async()=>{while(next<total){const index=next++;await task(index);}};
 await Promise.all(Array.from({length:Math.max(1,Math.min(concurrency,total))},worker));
}
function toAttachment(kind:MediaKind,file:GeneratedFile,prompt:string,model:string,index:number):MessageAttachment{
 const ext=file.path.split('.').pop()||'bin';
 return{id:'media-'+Date.now().toString(36)+'-'+index+'-'+Math.random().toString(36).slice(2,7),name:kind+'-'+(index+1)+'.'+ext,uri:'file://'+file.path,mimeType:file.mimeType||(kind==='image'?'image/jpeg':kind==='video'?'video/mp4':'audio/mpeg'),size:file.size,kind,thumbnail:file.thumbnail?'file://'+file.thumbnail:undefined,prompt,model};
}
export async function createMedia(request:MediaRequest,onProgress?:MediaProgress):Promise<MediaOutcome>{
 const config=await loadConfig();
 const prompt=request.prompt.trim();
 if(!prompt)throw new Error('Describe what you want to create.');
 const total=Math.max(1,Math.min(LIMITS[request.kind],Math.floor(request.count)||1));
 if(config.mediaEngine==='comfyui'&&config.comfyUrl.trim()){
  const queued=await submitMediaJobs(request.kind,prompt,total);
  return{attachments:[],failures:[],queued,engine:'comfyui'};
 }
 const key=await getPollinationsKey().catch(()=>'');
 const style=request.kind==='audio'?(request.audioStyle||detectAudioStyle(prompt)):undefined;
 const model=request.model||(request.kind==='image'?config.imageModel:request.kind==='video'?config.videoModel:style==='speech'?config.speechModel:style==='sfx'?config.sfxModel:config.musicModel);
 const shape=request.shape||config.imageShape;
 const catalog=request.kind==='video'?await listMediaModels().catch(()=>[]):[];
 const items:MessageAttachment[]=[],failures:string[]=[];let done=0;
 const label=request.kind==='image'?(total>1?'images':'image'):request.kind==='video'?(total>1?'videos':'video'):style==='speech'?'speech':style==='sfx'?'sound effect':'music';
 const report=(status:string)=>onProgress?.({items:[...items],done,total,status});
 report('Creating '+total+' '+label+'…');
 const concurrency=request.kind==='image'?(key?4:1):2;
 await runPool(total,concurrency,async index=>{
  try{
   const wait=(message:string)=>report(message+' ('+done+'/'+total+' ready)');
   const file=request.kind==='image'?await generateImage(prompt,{model,shape},wait)
    :request.kind==='video'?await generateVideo(prompt,{model,duration:request.duration||config.videoDuration,shape:shape==='square'?'landscape':shape,audio:config.videoAudio,catalog},wait)
    :await generateAudio(prompt,{model,style:style||'music',voice:request.voice||config.mediaVoice,duration:request.duration},wait);
   const attachment=toAttachment(request.kind,file,prompt,model,index);
   items.push(attachment);
   await saveGenerationJob({id:attachment.id,kind:request.kind,prompt,promptId:attachment.id,status:'complete',createdAt:Date.now(),outputs:[JSON.stringify(attachment)]}).catch(()=>{});
  }catch(error){failures.push(error instanceof Error?error.message:String(error));}
  finally{done++;report(done<total?'Created '+items.length+' of '+total+' '+label+'…':'Finishing…');}
 });
 if(!items.length)throw new Error(failures[0]||'Nothing was generated.');
 return{attachments:items,failures,queued:[],engine:'pollinations'};
}
type NativeMediaControls={deleteMedia(path:string):Promise<boolean>;openMedia(path:string,mime:string):Promise<boolean>;shareMedia(path:string,mime:string):Promise<boolean>;saveToGallery(path:string,mime:string):Promise<string>;playAudio(path:string):Promise<string>;stopAudio():Promise<boolean>;playVideo(path:string,title:string):Promise<boolean>};
const Controls=NativeModules.PocketBuddyMedia as NativeMediaControls|undefined;
function controls():NativeMediaControls{if(!Controls?.openMedia)throw new Error('Media controls need the latest Pocket Buddy APK.');return Controls;}
const filePath=(uri:string)=>uri.replace(/^file:\/\//,'');
export const openAttachment=(item:MessageAttachment)=>controls().openMedia(filePath(item.uri),item.mimeType);
export const shareAttachment=(item:MessageAttachment)=>controls().shareMedia(filePath(item.uri),item.mimeType);
export const playVideoAttachment=(item:MessageAttachment)=>controls().playVideo(filePath(item.uri),item.prompt||'');
export const playAudioAttachment=(item:MessageAttachment)=>controls().playAudio(filePath(item.uri));
export const stopAudioPlayback=()=>Controls?.stopAudio?Controls.stopAudio():Promise.resolve(true);
export async function saveAttachment(item:MessageAttachment):Promise<string>{
 const {PermissionsAndroid,Platform}=require('react-native');
 if(Platform.OS==='android'&&Number(Platform.Version)<29){
  const granted=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  if(granted!==PermissionsAndroid.RESULTS.GRANTED)throw new Error('Storage permission is needed to save to the gallery on this Android version.');
 }
 return controls().saveToGallery(filePath(item.uri),item.mimeType);
}
export function attachmentFromJob(job:GenerationJob):MessageAttachment|null{
 for(const raw of job.outputs){try{const value=JSON.parse(raw);if(value&&typeof value.uri==='string'&&value.uri.startsWith('file://'))return value as MessageAttachment;}catch{}}
 return null;
}
export async function deleteLocalMedia(job:GenerationJob):Promise<void>{
 const item=attachmentFromJob(job);
 if(item&&Controls?.deleteMedia)await Controls.deleteMedia(filePath(item.uri)).catch(()=>false);
 await deleteGenerationJob(job.id);
}
