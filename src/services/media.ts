import{saveGenerationJob,listGenerationJobs,updateGenerationJob}from'./database';
import{getComfyToken,loadConfig}from'./storage';
import type{GenerationJob}from'../types';
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
async function submitOne(kind:'image'|'video',prompt:string):Promise<string>{
 const config=await loadConfig(),json=kind==='image'?config.imageWorkflow:config.videoWorkflow;
 if(!json.trim())throw new Error('Add an API-format '+kind+' workflow in Settings. Put {{prompt}} in its positive prompt text input.');
 let workflow:any;try{workflow=JSON.parse(json);}catch{throw new Error('The saved ComfyUI workflow is not valid JSON.');}
 const result=await request('/prompt',{method:'POST',body:JSON.stringify({prompt:replacePrompt(workflow,prompt)})});
 if(!result.prompt_id)throw new Error(result.error?.message||'ComfyUI did not return a prompt ID. Check the workflow API export.');
 return String(result.prompt_id);
}
export async function submitMediaJobs(kind:'image'|'video',prompt:string,count=1):Promise<GenerationJob[]>{
 const amount=Math.max(1,Math.min(20,Math.floor(count)||1)),jobs:GenerationJob[]=[];
 for(let index=0;index<amount;index++){
  const distinct=amount===1?prompt:prompt+'\nGenerate a distinct variation, variation '+(index+1)+' of '+amount+'.';
  const promptId=await submitOne(kind,distinct);
  const job:GenerationJob={id:kind+'-'+Date.now()+'-'+index,kind,prompt:distinct,promptId,status:'queued',createdAt:Date.now(),outputs:[]};
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
  for(const file of [...(node.images||[]),...(node.gifs||[]),...(node.videos||[])]){
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