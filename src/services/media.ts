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
 const token=await getComfyToken(),headers:Record<string,string>={'Content-Type':'application/json',...(init.headers as Record<string,string>||{})};
 if(token)headers.Authorization='Bearer '+token;
 const response=await fetch(config.comfyUrl.replace(/\/+$/,'')+path,{...init,headers});
 const raw=await response.text();
 if(!response.ok)throw new Error('ComfyUI returned HTTP '+response.status+': '+raw.slice(0,500));
 if(!raw.trim())return{};
 try{return JSON.parse(raw);}catch{throw new Error('ComfyUI returned an unsupported response.');}
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
export async function refreshMediaJob(promptId:string):Promise<string>{
 const history=await request('/history/'+encodeURIComponent(promptId)),entry=history[promptId];
 if(!entry)return'queued';
 const outputs:string[]=[];
 for(const node of Object.values(entry.outputs||{})as any[]){
  for(const file of [...(node.images||[]),...(node.gifs||[]),...(node.videos||[])]){
   if(file.filename)outputs.push(JSON.stringify({filename:String(file.filename),subfolder:String(file.subfolder||''),type:String(file.type||'output')}));
  }
 }
 const failed=entry.status?.status_str==='error'||entry.status?.status_str==='failed';
 const status=failed?'failed':'complete';
 await updateGenerationJob(promptId,status,outputs);
 return status+(outputs.length?': '+outputs.length+' output file(s)':'');
}
export async function readMediaJobs():Promise<GenerationJob[]>{return listGenerationJobs();}
export async function cancelMediaJob(promptId:string):Promise<void>{
 await request('/queue',{method:'POST',body:JSON.stringify({delete:[promptId]})});
 await updateGenerationJob(promptId,'cancelled');
}