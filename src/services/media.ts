import{generateLocalVideo}from'./localVideo';
import{LOCAL_VIDEO_MODEL_ID,isComfyVideoModel}from'./mediaModels';
import{LOCAL_IMAGE_MODELS,generateLocalImages}from'./localImage';
import{saveGenerationJob,listGenerationJobs,updateGenerationJob,deleteGenerationJob}from'./database';
import{getComfyToken,loadConfig}from'./storage';
import type{AudioStyle,GenerationJob,MediaKind,MediaRequest,MessageAttachment}from'../types';
import{NativeModules}from'react-native';
import{isPrivateComfyHost}from'./net';
function replacePrompt(value:any,prompt:string,model:string,variables:Record<string,string>):any{
 if(typeof value==='string'){
  let result=value.replaceAll('{{prompt}}',prompt).replaceAll('__PROMPT__',prompt).replaceAll('{{model}}',model).replaceAll('__MODEL__',model);
  for(const [key,replacement]of Object.entries(variables))result=result.replaceAll('{{'+key+'}}',replacement).replaceAll('__'+key.toUpperCase()+'__',replacement);
  return result;
 }
 if(Array.isArray(value))return value.map(item=>replacePrompt(item,prompt,model,variables));
 if(value&&typeof value==='object'){const next:Record<string,unknown>={};for(const [key,child]of Object.entries(value))next[key]=replacePrompt(child,prompt,model,variables);return next;}
 return value;
}
function comfyBaseUrl(raw:string):string{
 let endpoint:URL;try{endpoint=new URL(raw.trim());}catch{throw new Error('Enter a ComfyUI URL, for example http://192.168.1.20:8188.');}
 const localHttp=endpoint.protocol==='http:'&&isPrivateComfyHost(endpoint.hostname);
 if((endpoint.protocol!=='https:'&&!localHttp)||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
  throw new Error('Use HTTPS for public servers. HTTP is supported only for private Wi-Fi/LAN ComfyUI hosts.');
 return endpoint.toString().replace(/\/+$/,'');
}
async function request(path:string,init:RequestInit={}):Promise<any>{
 const config=await loadConfig();if(!config.comfyUrl.trim())throw new Error('Connect a ComfyUI server in Settings to use media generation.');
 const base=comfyBaseUrl(config.comfyUrl),token=await getComfyToken();
 const headers:Record<string,string>={'Content-Type':'application/json',...(init.headers as Record<string,string>||{})};
 if(token)headers.Authorization='Bearer '+token;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(base+path,{...init,headers,signal:controller.signal});
  const raw=await response.text();
  if(!response.ok)throw new Error('ComfyUI returned HTTP '+response.status+': '+raw.slice(0,500));
  if(!raw.trim())return{};
  try{return JSON.parse(raw);}catch{throw new Error('ComfyUI returned an unsupported response.');}
 }catch(error){if(controller.signal.aborted)throw new Error('The ComfyUI request timed out after 60 seconds.');throw error;}
 finally{clearTimeout(timeout);}
}
function replaceInput(value:any,inputImage:string):any{
 if(typeof value==='string')return value.replaceAll('{{input_image}}',inputImage).replaceAll('__INPUT_IMAGE__',inputImage);
 if(Array.isArray(value))return value.map(item=>replaceInput(item,inputImage));
 if(value&&typeof value==='object'){const next:Record<string,unknown>={};for(const [key,child]of Object.entries(value))next[key]=replaceInput(child,inputImage);return next;}
 return value;
}
async function uploadComfyImage(item:MessageAttachment):Promise<string>{
 const config=await loadConfig(),base=comfyBaseUrl(config.comfyUrl),token=await getComfyToken();
 const form=new FormData();
 form.append('image',{uri:item.uri,name:item.name,type:item.mimeType} as any);
 form.append('type','input');form.append('overwrite','true');
 const headers:Record<string,string>={};if(token)headers.Authorization='Bearer '+token;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetch(base+'/upload/image',{method:'POST',headers,body:form,signal:controller.signal});
  const raw=await response.text();if(!response.ok)throw new Error('ComfyUI image upload returned HTTP '+response.status+': '+raw.slice(0,400));
  let result:any;try{result=JSON.parse(raw);}catch{throw new Error('ComfyUI returned an invalid image upload response.');}
  if(typeof result.name!=='string'||!result.name)throw new Error(result.error||'ComfyUI did not return the uploaded image filename.');
  return [String(result.subfolder||'').replace(/^\/+|\/+$/g,''),result.name].filter(Boolean).join('/');
 }catch(error){if(controller.signal.aborted)throw new Error('Uploading the source image to ComfyUI timed out.');throw error;}
 finally{clearTimeout(timer);}
}
async function submitOne(kind:MediaKind,prompt:string,model:string,variables:Record<string,string>,inputAttachment?:MessageAttachment):Promise<string>{
 const config=await loadConfig(),json=kind==='image'?config.imageWorkflow:kind==='video'?config.videoWorkflow:config.audioWorkflow;
 if(!json.trim())throw new Error('Add an API-format '+kind+' workflow in Settings. Put {{prompt}} in its positive prompt text input.');
 let workflow:any;try{workflow=JSON.parse(json);}catch{throw new Error('The saved ComfyUI workflow is not valid JSON.');}
 let inputImage='';
 if(inputAttachment){
  if(!inputAttachment.mimeType.toLowerCase().startsWith('image/'))throw new Error('Wan 2.2 image-to-video needs an image attachment.');
  if(!json.includes('{{input_image}}')&&!json.includes('__INPUT_IMAGE__'))throw new Error('Add {{input_image}} to the Load Image filename in your Wan 2.2 workflow before attaching a source photo.');
  inputImage=await uploadComfyImage(inputAttachment);
 }else if(json.includes('{{input_image}}')||json.includes('__INPUT_IMAGE__'))throw new Error('Attach a source photo for this image-to-video workflow.');
 if((json.includes('{{model}}')||json.includes('__MODEL__'))&&!model.trim())throw new Error('Enter the installed ComfyUI checkpoint filename in Settings; this workflow uses {{model}}.');
 const result=await request('/prompt',{method:'POST',body:JSON.stringify({prompt:replaceInput(replacePrompt(workflow,prompt,model,variables),inputImage)})});
 if(!result.prompt_id)throw new Error(result.error?.message||'ComfyUI did not return a prompt ID. Check the workflow API export.');
 return String(result.prompt_id);
}
export async function submitMediaJobs(kind:MediaKind,prompt:string,count=1,model='',variables:Record<string,string>={},inputAttachment?:MessageAttachment):Promise<GenerationJob[]>{
 const amount=Math.max(1,Math.min(20,Math.floor(count)||1)),jobs:GenerationJob[]=[];
 for(let index=0;index<amount;index++){
  const distinct=amount===1?prompt:prompt+'\nGenerate a distinct variation, variation '+(index+1)+' of '+amount+'.';
  const promptId=await submitOne(kind,distinct,model,variables,inputAttachment);
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
 if(!config.comfyUrl.trim())throw new Error('Enter your ComfyUI server URL first.');
 const [stats,objectInfo]=await Promise.all([request('/system_stats'),request('/object_info')]);
 const report:string[]=['ComfyUI API: reachable',comfyBaseUrl(config.comfyUrl).startsWith('http://')?'Private LAN HTTP':'HTTPS'];
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

// ---------- Self-hosted media engine (ComfyUI) ----------
export type MediaProgress=(update:{items:MessageAttachment[];done:number;total:number;status:string})=>void;
export type MediaOutcome={attachments:MessageAttachment[];failures:string[];queued:GenerationJob[];engine:'comfyui'|'device'};
const LIMITS:Record<MediaKind,number>={image:20,video:4,audio:4};
export function detectAudioStyle(text:string):AudioStyle{
 if(/\b(say|speak|speech|voice ?over|narrat\w*|read (this|it|out)|tts|pronounce)\b/i.test(text))return 'speech';
 if(/\b(sound effects?|sfx|foley|noise of|sound of)\b/i.test(text))return 'sfx';
 return 'music';
}
export async function createMedia(request:MediaRequest,onProgress?:MediaProgress):Promise<MediaOutcome>{
 const config=await loadConfig(),prompt=request.prompt.trim();
 if(!prompt)throw new Error('Describe what you want to create.');
 const localVideoPick=request.model===LOCAL_VIDEO_MODEL_ID;
 if(request.kind==='video'&&(localVideoPick||(config.videoEngine==='device'&&!isComfyVideoModel(request.model)))){
  const source=request.inputAttachments?.find(item=>(item.kind||'image')==='image');
  if(source)throw new Error('Turning a photo into a video needs Wan 2.2 on your ComfyUI server. On this phone, describe the video in words instead.');
  const total=Math.max(1,Math.min(2,Math.floor(request.count)||1)),items:MessageAttachment[]=[],failures:string[]=[];
  for(let index=0;index<total;index++){
   try{items.push(await generateLocalVideo(prompt,{shape:request.shape==='portrait'?'portrait':'landscape',seconds:request.duration&&request.duration<=3?request.duration:2},update=>onProgress?.({...update,items:[...items],done:items.length,total,status:(total>1?'Clip '+(index+1)+' of '+total+' · ':'')+update.status})));}
   catch(error){failures.push(error instanceof Error?error.message:String(error));break;}
  }
  if(!items.length)throw new Error(failures[0]||'The video could not be created.');
  return{attachments:items,failures,queued:[],engine:'device'};
 }
 const localPick=LOCAL_IMAGE_MODELS.some(item=>item.id===request.model);
 if(request.kind==='image'&&(localPick||(config.imageEngine==='device'&&!request.model))){
  const shape=request.shape||config.imageShape,id=localPick?request.model:undefined;
  const result=await generateLocalImages(prompt,{count:request.count,shape,modelId:id},onProgress);
  return{attachments:result.attachments,failures:result.failures,queued:[],engine:'device'};
 }
 if(!config.comfyUrl.trim())throw new Error('Connect your own ComfyUI server in Settings, then add the FLUX.1 or Wan 2.2 API workflow.');
 const total=Math.max(1,Math.min(LIMITS[request.kind],Math.floor(request.count)||1));
 const style=request.kind==='audio'?(request.audioStyle||detectAudioStyle(prompt)):undefined;
 const selected=request.model||(request.kind==='image'?config.imageModel:request.kind==='video'?config.videoModel:style==='speech'?config.speechModel:style==='sfx'?config.sfxModel:config.musicModel);
 const model=request.kind==='image'?(selected.toLowerCase().includes('dev')?config.imageDevCheckpoint:config.imageSchnellCheckpoint):request.kind==='video'?config.videoCheckpoint:'';
 const inputAttachment=request.kind==='video'?request.inputAttachments?.find(item=>(item.kind||'image')==='image'):undefined;
 if(request.kind==='video'&&request.inputAttachments?.length&&!inputAttachment)throw new Error('Choose a photo attachment for image-to-video; a video file cannot be used as the source image.');
 onProgress?.({items:[],done:0,total,status:'Queueing '+total+' '+request.kind+' job(s) on your ComfyUI server…'});
 const shape=request.shape||(request.kind==='video'?'landscape':config.imageShape);
 const dimensions=shape==='portrait'?{width:'768',height:'1344'}:shape==='landscape'?{width:'1344',height:'768'}:{width:'1024',height:'1024'};
 const variables={duration:String(request.duration||config.videoDuration),shape,width:dimensions.width,height:dimensions.height,count:String(total)};
 const queued=await submitMediaJobs(request.kind,prompt,total,model,variables,inputAttachment);
 onProgress?.({items:[],done:total,total,status:'Queued on your ComfyUI server'});
 return{attachments:[],failures:[],queued,engine:'comfyui'};
}
type NativeFetchResult={type:'file';path:string;mimeType:string;size:number;thumbnail?:string}|{type:'text';status:number;body?:string};
type NativeMediaControls={deleteMedia(path:string):Promise<boolean>;openMedia(path:string,mime:string):Promise<boolean>;shareMedia(path:string,mime:string):Promise<boolean>;saveToGallery(path:string,mime:string):Promise<string>;playAudio(path:string):Promise<string>;stopAudio():Promise<boolean>;playVideo(path:string,title:string):Promise<boolean>;pickChatAttachment():Promise<{path:string;name:string;mimeType:string;size:number;thumbnail?:string}|null>;getVisionFrames(path:string,mime:string):Promise<string[]>;fetchToFile(url:string,method:string,headers:Record<string,string>,body:string|null,extension:string,timeoutMs:number):Promise<NativeFetchResult>};
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
export function attachmentsFromJob(job:GenerationJob):MessageAttachment[]{
 const items:MessageAttachment[]=[];for(const raw of job.outputs){try{const value=JSON.parse(raw);if(value&&typeof value.uri==='string'&&value.uri.startsWith('file://'))items.push(value as MessageAttachment);}catch{}}
 return items;
}
export function attachmentFromJob(job:GenerationJob):MessageAttachment|null{return attachmentsFromJob(job)[0]||null;}
export async function deleteLocalMedia(job:GenerationJob,item?:MessageAttachment):Promise<void>{
 const current=attachmentsFromJob(job);
 if(item){
  if(Controls?.deleteMedia)await Controls.deleteMedia(filePath(item.uri)).catch(()=>false);
  const remaining=current.filter(value=>value.id!==item.id);
  if(remaining.length){await updateGenerationJob(job.promptId,job.status,remaining.map(value=>JSON.stringify(value)));return;}
 }else if(Controls?.deleteMedia){
  for(const value of current)await Controls.deleteMedia(filePath(value.uri)).catch(()=>false);
 }
 await deleteGenerationJob(job.id);
}

export async function pickChatAttachment():Promise<MessageAttachment|null>{
 const result=await controls().pickChatAttachment();if(!result)return null;
 const kind=result.mimeType.startsWith('video/')?'video':'image';
 return{id:'attachment-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name:result.name,uri:'file://'+result.path,mimeType:result.mimeType,size:result.size,kind,thumbnail:result.thumbnail?'file://'+result.thumbnail:undefined};
}
export async function getVisionFrames(item:MessageAttachment):Promise<string[]>{
 if(!item.uri.startsWith('file://'))throw new Error('This attachment is not stored in Pocket Buddy app storage.');
 if(!['image','video'].includes(item.kind||'image'))return [];
 return controls().getVisionFrames(filePath(item.uri),item.mimeType);
}
export async function cacheMediaJobOutputs(job:GenerationJob):Promise<number>{
 if(!job.outputs.length||attachmentsFromJob(job).length)return attachmentsFromJob(job).length;
 const config=await loadConfig(),base=comfyBaseUrl(config.comfyUrl),token=await getComfyToken(),saved:MessageAttachment[]=[];
 for(const raw of job.outputs){
  let descriptor:any;try{descriptor=JSON.parse(raw);}catch{continue;}
  if(!descriptor||typeof descriptor.filename!=='string')continue;
  const query='filename='+encodeURIComponent(descriptor.filename)+'&subfolder='+encodeURIComponent(String(descriptor.subfolder||''))+'&type='+encodeURIComponent(String(descriptor.type||'output'));
  const headers:Record<string,string>={Accept:'image/*,video/*,audio/*,application/octet-stream'};if(token)headers.Authorization='Bearer '+token;
  const extension=String(descriptor.filename).split('.').pop()||'bin';
  const file=await controls().fetchToFile(base+'/view?'+query,'GET',headers,null,extension,900000);
  if(file.type!=='file')throw new Error('ComfyUI could not download '+descriptor.filename+': '+String(file.body||'Unexpected response').slice(0,180));
  const mime=file.mimeType||(job.kind==='image'?'image/jpeg':job.kind==='video'?'video/mp4':'audio/mpeg');
  saved.push({id:'media-'+job.promptId+'-'+saved.length,name:String(descriptor.filename),uri:'file://'+file.path,mimeType:mime,size:file.size,kind:job.kind,thumbnail:file.thumbnail?'file://'+file.thumbnail:undefined,prompt:job.prompt});
 }
 if(saved.length)await updateGenerationJob(job.promptId,job.status,saved.map(item=>JSON.stringify(item)));
 return saved.length;
}
