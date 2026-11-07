import{initLlama}from'llama.rn';
import type{AppConfig,ModelMessage,ModelResponse,ToolCall,ToolDefinition}from'../types';
import{getProviderKey,loadConfig}from'./storage';
let localContext:any=null,activeLocalPath='',localRuntimeStatus='';
export async function loadLocalModel(path:string,force=false):Promise<void>{
 if(!path)throw new Error('No local model file was selected.');
 if(localContext&&activeLocalPath===path&&!force)return;
 if(localContext){try{await localContext.release();}catch{}localContext=null;}
 const config=await loadConfig();
 const options={model:path.startsWith('file://')?path:'file://'+path,n_ctx:config.nCtx,n_batch:Math.min(256,Math.max(64,Math.floor(config.nCtx/16))),use_mlock:false,flash_attn:false};
 try{
  try{
   localContext=await initLlama({...options,n_gpu_layers:config.nGpuLayers});
  }catch(gpuError){
   if(config.nGpuLayers<=0)throw gpuError;
   localContext=await initLlama({...options,n_gpu_layers:0});
   localRuntimeStatus='CPU fallback after GPU offload failed: '+(gpuError instanceof Error?gpuError.message:String(gpuError)).slice(0,180);
  }
  activeLocalPath=path;
  if(!localRuntimeStatus.startsWith('CPU fallback')){
   localRuntimeStatus=localContext?.gpu?'GPU acceleration active':(localContext?.reasonNoGPU?'CPU fallback: '+String(localContext.reasonNoGPU):'CPU inference');
  }
 }catch(error){localContext=null;activeLocalPath='';localRuntimeStatus='';throw error;}
}
export function isLocalModelLoaded():boolean{return !!localContext;}
export function getLocalRuntimeStatus():string{return localRuntimeStatus;}
function normalizeToolCalls(items:any[]=[]):ToolCall[]{return items.map((item,index)=>({id:item.id||'pb_call_'+Date.now()+'_'+index,type:'function',function:{name:item.function?.name||'',arguments:typeof item.function?.arguments==='string'?item.function.arguments:JSON.stringify(item.function?.arguments||{})}}));}
class ProviderError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
function parseError(status:number,raw:string):ProviderError{let message='Provider returned HTTP '+status;try{const data=JSON.parse(raw);message=data.error?.message||data.message||message;}catch{}return new ProviderError(status,message);}
function chatUrl(config:AppConfig):string{
 const base=config.baseUrl.trim().replace(/\/+$/,'');if(!base)throw new Error('Set an API base URL in Settings.');
 let parsed:URL;try{parsed=new URL(base);}catch{throw new Error('Enter a valid HTTPS API base URL in Settings.');}
 if(parsed.protocol!=='https:'||!parsed.hostname)throw new Error('API endpoints must use HTTPS. Plain HTTP endpoints are blocked to protect prompts and credentials.');
 if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('API base URLs must not embed credentials, query strings or fragments.');
 if(!config.model.trim())throw new Error('Set a model identifier in Settings.');
 return base.endsWith('/chat/completions')?base:base+'/chat/completions';
}
function streamRequest(url:string,key:string,body:Record<string,unknown>,onToken?:(token:string)=>void):Promise<ModelResponse>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let cursor=0,buffer='',content='',settled=false;const calls:Record<number,ToolCall>={};
  const consume=(raw:string)=>{
   const line=raw.trim();if(!line||line==='[DONE]')return;let packet:any;try{packet=JSON.parse(line);}catch{return;}
   const delta=packet.choices?.[0]?.delta||{};if(typeof delta.content==='string'&&delta.content){content+=delta.content;onToken?.(delta.content);}
   for(const incoming of delta.tool_calls||[]){const index=Number(incoming.index??0);
    if(!calls[index])calls[index]={id:incoming.id||'pb_call_'+Date.now()+'_'+index,type:'function',function:{name:'',arguments:''}};
    if(incoming.id)calls[index].id=incoming.id;if(incoming.function?.name)calls[index].function.name+=incoming.function.name;if(incoming.function?.arguments)calls[index].function.arguments+=incoming.function.arguments;
   }
  };
  const drain=(flush=false)=>{
   buffer+=xhr.responseText.slice(cursor);cursor=xhr.responseText.length;const lines=buffer.split(/\r?\n/);buffer=flush?'':(lines.pop()||'');
   for(const line of lines)if(line.startsWith('data:'))consume(line.slice(5));if(flush&&buffer.startsWith('data:'))consume(buffer.slice(5));
  };
  xhr.open('POST',url);xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('Accept','text/event-stream, application/json');if(key)xhr.setRequestHeader('Authorization','Bearer '+key);
  xhr.timeout=180000;xhr.onprogress=()=>drain(false);xhr.onerror=()=>{if(!settled){settled=true;reject(new Error('Network error while connecting to the model provider.'));}};
  xhr.ontimeout=()=>{if(!settled){settled=true;reject(new Error('The model request timed out after three minutes.'));}};
  xhr.onload=()=>{if(settled)return;drain(true);settled=true;if(xhr.status<200||xhr.status>=300){reject(parseError(xhr.status,xhr.responseText));return;}
   if(!content&&!Object.keys(calls).length&&xhr.responseText.trim().startsWith('{')){try{const json=JSON.parse(xhr.responseText),message=json.choices?.[0]?.message||{};resolve({content:message.content||'',toolCalls:normalizeToolCalls(message.tool_calls||[])});return;}catch{}}
   resolve({content,toolCalls:Object.keys(calls).sort((a,b)=>Number(a)-Number(b)).map(key=>calls[Number(key)])});
  };xhr.send(JSON.stringify({...body,stream:true}));
 });
}
async function jsonFallback(url:string,key:string,body:Record<string,unknown>):Promise<ModelResponse>{
 const headers:Record<string,string>={'Content-Type':'application/json'};if(key)headers.Authorization='Bearer '+key;
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:false})}),raw=await response.text();if(!response.ok)throw parseError(response.status,raw);
 const data=JSON.parse(raw),message=data.choices?.[0]?.message||{};return{content:message.content||'',toolCalls:normalizeToolCalls(message.tool_calls||[])};
}
function requestBody(config:AppConfig,messages:ModelMessage[],tools:ToolDefinition[]):Record<string,unknown>{return{model:config.model,messages,temperature:config.temperature,max_tokens:4096,...(tools.length?{tools:tools.map(item=>({type:item.type,function:item.function})),tool_choice:'auto'}:{})};}
async function apiCompletion(config:AppConfig,messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{
 const key=await getProviderKey(),url=chatUrl(config),body=requestBody(config,messages,tools);
 try{return await streamRequest(url,key,body,onToken);}catch(error){if(error instanceof ProviderError&&[400,404,405,415,422,501].includes(error.status))return jsonFallback(url,key,body);throw error;}
}
async function localCompletion(config:AppConfig,messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{
 if(!localContext)throw new Error('No local GGUF model is loaded. Open Models and install one first.');
 const result=await localContext.completion({messages,...(tools.length?{tools:tools.map(item=>({type:item.type,function:item.function})),tool_choice:'auto'}:{}),n_predict:2048,temperature:config.temperature,stop:['</s>','<|end|>','<|eot_id|>','<|end_of_text|>','<|im_end|>','<|end_of_turn|>']},(event:any)=>{if(event.token)onToken?.(event.token);});
 return{content:result.text||'',toolCalls:normalizeToolCalls(result.tool_calls||[])};
}
export async function complete(messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{const config=await loadConfig();return config.mode==='local'?localCompletion(config,messages,tools,onToken):apiCompletion(config,messages,tools,onToken);}
export async function testProviderConnection():Promise<string>{const config=await loadConfig();if(config.mode!=='api')throw new Error('Switch to API provider mode to test this connection.');const result=await apiCompletion(config,[{role:'user',content:'Reply with the single word OK.'}],[]);return result.content.trim()||'The provider responded, but returned no text.';}
export async function releaseLocalModel():Promise<void>{if(localContext){try{await localContext.release();}catch{}}localContext=null;activeLocalPath='';localRuntimeStatus='';}
