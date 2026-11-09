import{initLlama,getBackendDevicesInfo}from'llama.rn';
import AsyncStorage from'@react-native-async-storage/async-storage';
import{NativeModules}from'react-native';
import type{AppConfig,LocalBenchmark,ModelMessage,ModelResponse,ToolCall,ToolDefinition}from'../types';
import{getProviderKey,loadConfig}from'./storage';
import{type BenchmarkReport,type BenchmarkRun,type InferencePlan,type ThreadTuning,coreTopology,describeDevice,inspectModel,loadTuning,planInference,probeHardware,runtimeState,saveBenchmarkReport,saveTuning,savedStorageBenchmark,subscribeHardwareEvents,tuningKey}from'./hardware';

type MoeNative={isAvailable():Promise<{available:boolean;reason:string;running:boolean}>;start(modelPath:string,args:string[]):Promise<{port:number;apiKey:string;baseUrl:string}>;stop():Promise<boolean>;status():Promise<{running:boolean;port:number;exitCode?:number;rssMb:number}>;readLog():Promise<string>};
const MoE=NativeModules.PocketBuddyMoE as MoeNative|undefined;

let localContext:any=null,activeLocalPath='',localRuntimeStatus='',activeLocalConfig:AppConfig|null=null;
let activePlan:InferencePlan|null=null,moeServer:{baseUrl:string;apiKey:string}|null=null,currentThreads=0,prewarmTask:Promise<void>|null=null,unsubscribeEvents:(()=>void)|null=null;
const PREWARM_KEY='pocket-buddy.prewarm-prefix.v1';

/** The options Pocket Buddy used before the adaptive engine: kept as the benchmark baseline and the last-resort fallback. */
export function legacyLlamaOptions(path:string,config:AppConfig):Record<string,unknown>{
 return{model:path.startsWith('file://')?path:'file://'+path,n_ctx:config.nCtx,n_batch:Math.min(256,Math.max(64,Math.floor(config.nCtx/16))),use_mlock:false,flash_attn:false,n_gpu_layers:config.nGpuLayers};
}
export function adaptiveLlamaOptions(path:string,plan:InferencePlan):Record<string,unknown>{
 return{model:path.startsWith('file://')?path:'file://'+path,n_ctx:plan.nCtx,n_batch:plan.nBatch,n_ubatch:plan.nUbatch,n_parallel:plan.nParallel,n_threads:plan.nThreads,use_mmap:plan.useMmap,use_mlock:false,flash_attn_type:plan.flashAttn,
  ...(plan.kvType==='q8_0'?{cache_type_k:'q8_0',cache_type_v:'q8_0'}:{}),n_gpu_layers:plan.nGpuLayers,state_cache_budget_mb:plan.stateCacheMb,ctx_shift:true};
}

export async function moeEngineAvailable():Promise<boolean>{if(!MoE)return false;try{return(await MoE.isAvailable()).available;}catch{return false;}}

async function gpuDevices():Promise<string[]>{try{return(await getBackendDevicesInfo()).filter((d:any)=>d.type!=='cpu'&&!/CPU/i.test(String(d.backend))).map((d:any)=>String(d.deviceName||d.backend));}catch{return[];}}

export async function buildPlan(path:string,config:AppConfig,heldMb=0):Promise<InferencePlan>{
 const[probe,raw,arch,moeOk,storage,devices]=await Promise.all([probeHardware(),runtimeState(),inspectModel(path),moeEngineAvailable(),savedStorageBenchmark(),gpuDevices()]);
 // When a model is already loaded its own memory is not "free"; count it back so re-planning compares like with like.
 const state=raw&&heldMb>0?{...raw,memory:{...raw.memory,availableMb:raw.memory.availableMb+heldMb}}:raw;
 const tuning=await loadTuning(tuningKey(probe,path));
 return planInference({probe,memory:state?.memory,power:state?.power,arch,modelBytes:arch?.fileBytes||0,requestedProfile:config.perfProfile||'auto',moeMode:config.moeMode||'auto',moeEngineAvailable:moeOk,manualContext:config.autoContext===false?config.nCtx:undefined,manualGpuLayers:config.nGpuLayers,tuning,storage,gpuDevices:devices});
}

async function initLlamaRn(options:Record<string,unknown>,gpuLayers:number):Promise<{context:any;status:string}>{
 try{
  const context=await initLlama(options as any);
  return{context,status:context?.gpu?'GPU acceleration active':(gpuLayers>0&&context?.reasonNoGPU?'CPU fallback: '+String(context.reasonNoGPU):'CPU inference')};
 }catch(gpuError){
  if(gpuLayers<=0)throw gpuError;
  const context=await initLlama({...(options as any),n_gpu_layers:0});
  return{context,status:'CPU fallback after GPU offload failed: '+(gpuError instanceof Error?gpuError.message:String(gpuError)).slice(0,180)};
 }
}

async function moeFetch(server:{baseUrl:string;apiKey:string},path:string,init:RequestInit={},timeoutMs=8000):Promise<any>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await fetch(server.baseUrl+path,{...init,signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+server.apiKey,...(init.headers||{})}});const raw=await response.text();if(!response.ok)throw new Error('Engine HTTP '+response.status+': '+raw.slice(0,200));return raw?JSON.parse(raw):{};}
 finally{clearTimeout(timer);}
}

async function startMoe(path:string,args:string[],onStatus?:(s:string)=>void):Promise<{baseUrl:string;apiKey:string;loadMs:number}>{
 if(!MoE)throw new Error('The MoE engine is not part of this build.');
 const started=Date.now();
 const server=await MoE.start(path.replace(/^file:\/\//,''),args);
 const handle={baseUrl:server.baseUrl,apiKey:server.apiKey};
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){
  await new Promise<void>(r=>setTimeout(()=>r(),700));
  const status=await MoE.status();
  if(!status.running){const log=await MoE.readLog();throw new Error('MoE engine exited'+(status.exitCode!==undefined?' with code '+status.exitCode:'')+': '+log.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0,400));}
  try{
   const info=await moeFetch(handle,'/api/info',{},3000);
   if(info.state==='ready')return{...handle,loadMs:Date.now()-started};
   if(info.state==='error')throw new Error('MoE engine: '+(info.error||'load failed'));
   onStatus?.(info.state==='planning'?'Measuring this phone for expert streaming…':'Loading MoE model…');
  }catch(error){if(error instanceof Error&&error.message.startsWith('MoE engine:'))throw error;}
 }
 throw new Error('The MoE engine did not become ready in 15 minutes.');
}

async function releaseAll():Promise<void>{
 if(localContext){try{await localContext.release();}catch{}}
 localContext=null;
 if(moeServer&&MoE){try{await MoE.stop();}catch{}}
 moeServer=null;
}

/** Loads a model with the plan the adaptive engine computes for this phone, model architecture and profile. */
async function initializeLocal(path:string,config:AppConfig,onStatus?:(s:string)=>void):Promise<{status:string;plan:InferencePlan|null}>{
 let plan:InferencePlan|null=null;
 try{plan=await buildPlan(path,config);}catch{plan=null;}
 if(plan?.engine==='moe-stream'&&plan.moe){
  try{
   const server=await startMoe(path,plan.moe.args,onStatus);moeServer=server;currentThreads=plan.nThreads;
   return{status:'MoE expert streaming · cache '+plan.moe.cacheMb+' MB · '+plan.moe.ioLanes+' read lanes'+(plan.moe.useAutoPlanner?' · engine-measured plan':''),plan};
  }catch(firstError){
   if(plan.moe.useAutoPlanner){
    try{const server=await startMoe(path,plan.moe.fallbackArgs,onStatus);moeServer=server;plan={...plan,moe:{...plan.moe,useAutoPlanner:false,args:plan.moe.fallbackArgs},reasons:[...plan.reasons,'The engine planner failed, so Pocket Buddy\'s own streaming settings were used.']};return{status:'MoE expert streaming (fallback settings)',plan};}catch{}
   }
   plan={...plan,engine:'llama.rn',reasons:[...plan.reasons,'MoE engine failed ('+(firstError instanceof Error?firstError.message:String(firstError)).slice(0,160)+'); using the standard engine with memory mapping.']};
  }
 }
 if(plan){
  try{const loaded=await initLlamaRn(adaptiveLlamaOptions(path,plan),plan.nGpuLayers);localContext=loaded.context;currentThreads=plan.nThreads;return{status:loaded.status+' · '+plan.nThreads+' threads · ctx '+plan.nCtx+' · '+plan.profile,plan};}
  catch(error){plan={...plan,reasons:[...plan.reasons,'Adaptive settings failed to load ('+(error instanceof Error?error.message:String(error)).slice(0,120)+'); using safe defaults.']};}
 }
 const loaded=await initLlamaRn(legacyLlamaOptions(path,config),config.nGpuLayers);localContext=loaded.context;currentThreads=0;
 return{status:loaded.status+' · safe defaults',plan};
}

let replanDue=false,memoryPressure=false,lastReplan=0;
/** Re-evaluates the plan between messages: profile (battery/charging/thermal) every time, and context size after Android reports memory pressure. */
async function reevaluate(config:AppConfig):Promise<void>{
 if(!activePlan||!activeLocalPath)return;
 if(!replanDue&&Date.now()-lastReplan<30000)return;
 replanDue=false;lastReplan=Date.now();
 const held=Math.max(0,(await rssMb())-150);
 let next:InferencePlan;try{next=await buildPlan(activeLocalPath,config,held);}catch{return;}
 if(memoryPressure&&localContext&&config.autoContext!==false&&next.engine==='llama.rn'&&next.nCtx<activePlan.nCtx){
  memoryPressure=false;
  const path=activeLocalPath;
  try{await loadLocalModel(path,true);if(activePlan)activePlan={...activePlan,reasons:[...activePlan.reasons,'Android reported low memory, so the context was reduced to '+activePlan.nCtx+' tokens.']};}catch{}
  return;
 }
 memoryPressure=false;
 if(next.profile!==activePlan.profile||next.nThreads!==currentThreads){
  currentThreads=next.nThreads;
  activePlan={...activePlan,profile:next.profile,nThreads:next.nThreads,reasons:[...next.reasons.slice(0,1),...activePlan.reasons.slice(1)]};
  localRuntimeStatus=localRuntimeStatus.replace(/ · (battery|balanced|max)( · .*)?$/,'')+' · '+next.profile+' · '+next.nThreads+' threads';
 }
}
function watchHardware():void{
 if(unsubscribeEvents)return;
 unsubscribeEvents=subscribeHardwareEvents(event=>{
  if(!activePlan)return;
  if(event.type==='lowMemory'||(event.type==='trimMemory'&&event.level>=15))memoryPressure=true;
  replanDue=true;
  if(event.type==='thermal'){
   const base=activePlan.nThreads;
   currentThreads=event.thermalStatus>=3?Math.max(2,base-2):event.thermalStatus>=2?Math.max(2,base-1):base;
   localRuntimeStatus=localRuntimeStatus.replace(/ · thermal.*$/,'')+(event.thermalStatus>=2?' · thermal: '+currentThreads+' threads':'');
  }
 });
}

export async function loadLocalModel(path:string,force=false,onStatus?:(s:string)=>void):Promise<void>{
 if(!path)throw new Error('No local model file was selected.');
 if((localContext||moeServer)&&activeLocalPath===path&&!force)return;
 const previousPath=activeLocalPath,previousConfig=activeLocalConfig,hadPrevious=!!(localContext||moeServer);
 await releaseAll();activeLocalPath='';activeLocalConfig=null;activePlan=null;
 const config=await loadConfig();
 try{
  const loaded=await initializeLocal(path,config,onStatus);
  activeLocalPath=path;activeLocalConfig=config;localRuntimeStatus=loaded.status;activePlan=loaded.plan;
  watchHardware();
  prewarmTask=prewarm().catch(()=>{}).finally(()=>{prewarmTask=null;});
 }catch(error){
  await releaseAll();activeLocalPath='';activeLocalConfig=null;localRuntimeStatus='';activePlan=null;
  if(hadPrevious&&previousPath&&previousConfig){
   try{
    const restored=await initializeLocal(previousPath,previousConfig);
    activeLocalPath=previousPath;activeLocalConfig=previousConfig;activePlan=restored.plan;
    localRuntimeStatus='Previous model restored after the requested model could not be loaded.';
   }catch{await releaseAll();activeLocalPath='';activeLocalConfig=null;localRuntimeStatus='';}
  }
  throw error;
 }
}
export function isLocalModelLoaded():boolean{return !!(localContext||moeServer);}
export function getLocalRuntimeStatus():string{return localRuntimeStatus;}
export function getActivePlan():InferencePlan|null{return activePlan;}
export async function clearLocalConversationCache():Promise<void>{
 if(localContext&&typeof localContext.clearCache==='function')await localContext.clearCache();
}

/** Processes the system prompt and tool list right after load, so the first real message only prefills the user's words. */
async function prewarm():Promise<void>{
 const raw=await AsyncStorage.getItem(PREWARM_KEY);if(!raw)return;
 let prefix:{messages:ModelMessage[];tools:ToolDefinition[]};try{prefix=JSON.parse(raw);}catch{return;}
 if(!prefix?.messages?.length)return;
 if(localContext){
  await localContext.completion({messages:[...prefix.messages,{role:'user',content:'hi'}],...(prefix.tools?.length?{tools:prefix.tools.map(t=>({type:t.type,function:t.function})),tool_choice:'auto'}:{}),jinja:true,enable_thinking:false,n_predict:1,temperature:0,...(currentThreads?{n_threads:currentThreads}:{})});
 }else if(moeServer){
  await moeFetch(moeServer,'/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[...prefix.messages,{role:'user',content:'hi'}],max_tokens:1,stream:false,chat_template_kwargs:{enable_thinking:false}})},120000);
 }
}
async function rememberPrefix(messages:ModelMessage[],tools:ToolDefinition[]):Promise<void>{
 const system=messages.filter(m=>m.role==='system');if(!system.length)return;
 try{await AsyncStorage.setItem(PREWARM_KEY,JSON.stringify({messages:system,tools}));}catch{}
}

export async function runLocalBenchmark():Promise<LocalBenchmark>{
 if(moeServer)throw new Error('Use Settings → Performance → Benchmark this phone for MoE models.');
 if(!localContext)throw new Error('Load a local model before running a benchmark.');
 if(typeof localContext.bench!=='function')throw new Error('This llama.rn build does not expose its native benchmark API. Update the runtime before benchmarking.');
 const config=await loadConfig();
 const result=await localContext.bench(512,128,1,3);
 const promptSpeed=Number(result?.speedPp),generationSpeed=Number(result?.speedTg);
 if(!Number.isFinite(promptSpeed)||!Number.isFinite(generationSpeed)||promptSpeed<=0||generationSpeed<=0)
  throw new Error('The native benchmark returned incomplete speed metrics. Reload the model and try again.');
 return{ranAt:Date.now(),promptTokens:Number(result.pp)||512,generatedTokens:Number(result.tg)||128,promptTokensPerSecond:promptSpeed,generationTokensPerSecond:generationSpeed,promptMs:Number(result.tPp)||0,generationMs:Number(result.tTg)||0,gpuLayers:activePlan?.nGpuLayers??config.nGpuLayers,contextSize:activePlan?.nCtx??config.nCtx,gpuActive:!!localContext.gpu};
}

// ---------------- on-device benchmark: existing defaults vs adaptive engine ----------------
const BENCH_SYSTEM='You are Pocket Buddy, a friendly and concise assistant running fully on this phone.';
const BENCH_PROMPT='In three sentences, explain why the sea looks blue.';
async function rssMb():Promise<number>{const s=await runtimeState();return s?.memory.processRssMb||0;}

async function timedLlamaRun(context:any,threads:number,nPredict:number):Promise<{ttftMs:number;prefillTps:number;decodeTps:number;promptTokens:number;generated:number}>{
 const started=Date.now();let first=0;
 const result:any=await context.completion({messages:[{role:'system',content:BENCH_SYSTEM},{role:'user',content:BENCH_PROMPT}],jinja:true,enable_thinking:false,n_predict:nPredict,temperature:0,seed:7,...(threads?{n_threads:threads}:{})},(event:any)=>{if(!first&&(event.token||event.content))first=Date.now();});
 const t=result?.timings||{};
 return{ttftMs:(first||Date.now())-started,prefillTps:Number(t.prompt_per_second)||0,decodeTps:Number(t.predicted_per_second)||0,promptTokens:Number(t.prompt_n)||0,generated:Number(t.predicted_n)||0};
}

async function timedMoeRun(server:{baseUrl:string;apiKey:string},nPredict:number):Promise<{ttftMs:number;prefillTps:number;decodeTps:number;promptTokens:number;generated:number}>{
 let summary:any=null;const started=Date.now();let first=0;
 await streamRequest(server.baseUrl+'/v1/chat/completions',server.apiKey,{messages:[{role:'system',content:BENCH_SYSTEM},{role:'user',content:BENCH_PROMPT}],max_tokens:nPredict,chat_template_kwargs:{enable_thinking:false}},()=>{if(!first)first=Date.now();},s=>{summary=s;});
 return{ttftMs:summary?.ttft_s?summary.ttft_s*1000:(first||Date.now())-started,prefillTps:Number(summary?.prefill_tps)||0,decodeTps:Number(summary?.tok_s)||0,promptTokens:Number(summary?.n_prompt)||0,generated:Number(summary?.tokens)||0};
}

/** Tries thread counts derived from the measured core topology and keeps the fastest stable one. */
async function tuneThreads(context:any,onStatus:(s:string)=>void):Promise<ThreadTuning>{
 const probe=await probeHardware();const topo=coreTopology(probe);
 const candidates=[...new Set([2,topo.big,Math.min(topo.total,topo.big+2),4,6,topo.total].filter(n=>n>=2&&n<=topo.total))].sort((a,b)=>a-b);
 const results:ThreadTuning['candidates']=[];
 await timedLlamaRun(context,candidates[0],4);
 for(const threads of candidates){onStatus('Measuring '+threads+' threads…');const run=await timedLlamaRun(context,threads,32);results.push({threads,decodeTps:run.decodeTps,prefillTps:run.prefillTps});}
 const best=results.reduce((a,b)=>b.decodeTps>a.decodeTps*1.03?b:a,results[0]);
 return{threads:best.threads,decodeTps:best.decodeTps,prefillTps:best.prefillTps,measuredAt:Date.now(),candidates:results};
}

export async function benchmarkThisPhone(onStatus:(s:string)=>void):Promise<BenchmarkReport>{
 const path=activeLocalPath;if(!path)throw new Error('Load a local model first (Models tab).');
 const config=await loadConfig();const probe=await probeHardware(true);
 const notes:string[]=[];const runs:BenchmarkRun[]=[];
 onStatus('Releasing the current model…');await releaseAll();
 const arch=await inspectModel(path);
 // 1. existing implementation
 try{
  onStatus('Run 1: existing defaults (llama.rn, previous settings)…');
  const t0=Date.now();const ctx=(await initLlamaRn(legacyLlamaOptions(path,config),config.nGpuLayers)).context;const loadMs=Date.now()-t0;
  await timedLlamaRun(ctx,0,4);
  const r=await timedLlamaRun(ctx,0,64);const rss=await rssMb();
  runs.push({label:'Existing defaults',engine:'llama.rn',loadMs,ttftMs:r.ttftMs,prefillTps:r.prefillTps,decodeTps:r.decodeTps,rssMb:rss,threads:0,nCtx:config.nCtx,promptTokens:r.promptTokens,generatedTokens:r.generated});
  try{await ctx.release();}catch{}
 }catch(error){runs.push({label:'Existing defaults',engine:'llama.rn',loadMs:0,ttftMs:0,prefillTps:0,decodeTps:0,rssMb:0,threads:0,nCtx:config.nCtx,promptTokens:0,generatedTokens:0,error:(error instanceof Error?error.message:String(error)).slice(0,160)});}
 // 2. adaptive engine
 let plan=await buildPlan(path,config);
 try{
  if(plan.engine==='moe-stream'&&plan.moe&&MoE){
   onStatus('Run 2/3: MoE expert streaming…');
   const server=await startMoe(path,plan.moe.args,onStatus);
   await timedMoeRun(server,4);
   const r=await timedMoeRun(server,64);const st=await MoE.status();
   const streamRun:BenchmarkRun={label:'Adaptive (expert streaming)',engine:'bmoe '+(plan.moe.useAutoPlanner?'auto':'explicit'),loadMs:server.loadMs,ttftMs:r.ttftMs,prefillTps:r.prefillTps,decodeTps:r.decodeTps,rssMb:st.rssMb,threads:plan.nThreads,nCtx:plan.nCtx,promptTokens:r.promptTokens,generatedTokens:r.generated};
   runs.push(streamRun);
   moeServer=server;
   // 3. the same model memory-mapped with the adaptive llama.rn settings; keep whichever engine answers a typical reply sooner.
   let mmapRun:BenchmarkRun|null=null;
   try{
    onStatus('Run 3/3: memory-mapped with adaptive settings…');
    await releaseAll();
    const mplan=await buildPlan(path,{...config,moeMode:'off'});
    const t0=Date.now();const ctx=(await initLlamaRn(adaptiveLlamaOptions(path,mplan),0)).context;const loadMs=Date.now()-t0;
    await timedLlamaRun(ctx,mplan.nThreads,4);
    const m=await timedLlamaRun(ctx,mplan.nThreads,64);const rss=await rssMb();
    mmapRun={label:'Adaptive (memory-mapped)',engine:'llama.rn',loadMs,ttftMs:m.ttftMs,prefillTps:m.prefillTps,decodeTps:m.decodeTps,rssMb:rss,threads:mplan.nThreads,nCtx:mplan.nCtx,promptTokens:m.promptTokens,generatedTokens:m.generated};
    runs.push(mmapRun);
    try{await ctx.release();}catch{}
   }catch(error){runs.push({label:'Adaptive (memory-mapped)',engine:'llama.rn',loadMs:0,ttftMs:0,prefillTps:0,decodeTps:0,rssMb:0,threads:0,nCtx:plan.nCtx,promptTokens:0,generatedTokens:0,error:(error instanceof Error?error.message:String(error)).slice(0,160)});}
   const replyMs=(run:BenchmarkRun)=>run.decodeTps>0?run.ttftMs+64000/run.decodeTps:Infinity;
   const winner:'llama.rn'|'moe-stream'=mmapRun&&replyMs(mmapRun)<replyMs(streamRun)?'llama.rn':'moe-stream';
   const previous=await loadTuning(tuningKey(probe,path));
   await saveTuning(tuningKey(probe,path),{...(previous||{threads:0,decodeTps:0,prefillTps:0,candidates:[]}),measuredAt:Date.now(),moeEngine:winner,
    moeMeasured:{mmapDecodeTps:mmapRun?.decodeTps||0,mmapTtftMs:mmapRun?.ttftMs||0,streamDecodeTps:streamRun.decodeTps,streamTtftMs:streamRun.ttftMs}});
   notes.push('Engine kept for this model on this phone: '+(winner==='llama.rn'?'memory-mapped (faster here)':'expert streaming (faster here)')+', judged by first-token time plus 64 tokens of decoding.');
   moeServer=null;localContext=null;
  }else{
   onStatus('Run 2/2: adaptive settings, tuning threads…');
   const t0=Date.now();const ctx=(await initLlamaRn(adaptiveLlamaOptions(path,plan),plan.nGpuLayers)).context;const loadMs=Date.now()-t0;
   const tuning=await tuneThreads(ctx,onStatus);await saveTuning(tuningKey(probe,path),tuning);
   notes.push('Thread sweep (decode tok/s): '+tuning.candidates.map(c=>c.threads+'t='+c.decodeTps.toFixed(2)).join(', '));
   plan={...plan,nThreads:tuning.threads};
   onStatus('Run 2/2: measuring with '+tuning.threads+' threads…');
   const r=await timedLlamaRun(ctx,tuning.threads,64);const rss=await rssMb();
   runs.push({label:'Adaptive engine',engine:'llama.rn',loadMs,ttftMs:r.ttftMs,prefillTps:r.prefillTps,decodeTps:r.decodeTps,rssMb:rss,threads:tuning.threads,nCtx:plan.nCtx,promptTokens:r.promptTokens,generatedTokens:r.generated});
   localContext=ctx;currentThreads=tuning.threads;
  }
 }catch(error){runs.push({label:'Adaptive engine',engine:plan.engine,loadMs:0,ttftMs:0,prefillTps:0,decodeTps:0,rssMb:0,threads:plan.nThreads,nCtx:plan.nCtx,promptTokens:0,generatedTokens:0,error:(error instanceof Error?error.message:String(error)).slice(0,160)});}
 if(!localContext&&!moeServer){onStatus('Reloading model…');const loaded=await initializeLocal(path,config);plan=loaded.plan||plan;localRuntimeStatus=loaded.status;}
 activePlan=plan;
 notes.push('Same prompt, greedy decoding, 64 tokens, warm-up run excluded. RSS is the resident memory of the process running inference.');
 if(arch)notes.push(arch.isMoe?'MoE model: run 1 maps the whole file with the previous settings; the streaming run reads only routed experts; the memory-mapped run uses the adaptive threads and context.':'Dense model: expert streaming does not apply; run 2 differs in threads, batch, KV cache and parallel slots.');
 const report:BenchmarkReport={ranAt:Date.now(),device:describeDevice(probe).split('\n').join(' · '),model:path.split('/').pop()||path,architecture:arch?(arch.architecture+(arch.isMoe?' MoE':' dense')):'unknown',runs,notes};
 await saveBenchmarkReport(report);
 onStatus('');
 return report;
}

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
function streamRequest(url:string,key:string,body:Record<string,unknown>,onToken?:(token:string)=>void,onSummary?:(summary:any)=>void):Promise<ModelResponse>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let cursor=0,buffer='',content='',settled=false;const calls:Record<number,ToolCall>={};
  const consume=(raw:string)=>{
   const line=raw.trim();if(!line||line==='[DONE]')return;let packet:any;try{packet=JSON.parse(line);}catch{return;}
   if(packet.bmoe?.summary)onSummary?.(packet.bmoe.summary);
   const delta=packet.choices?.[0]?.delta||{};
   if(packet.bmoe?.reset&&typeof delta.content==='string'){const full=delta.content;if(full.startsWith(content)&&full.length>content.length)onToken?.(full.slice(content.length));content=full;}
   else if(typeof delta.content==='string'&&delta.content){content+=delta.content;onToken?.(delta.content);}
   for(const incoming of delta.tool_calls||[]){const index=Number(incoming.index??0);
    if(!calls[index])calls[index]={id:incoming.id||'pb_call_'+Date.now()+'_'+index,type:'function',function:{name:'',arguments:''}};
    if(incoming.id)calls[index].id=incoming.id;if(incoming.function?.name)calls[index].function.name+=incoming.function.name;if(incoming.function?.arguments)calls[index].function.arguments+=incoming.function.arguments;
   }
  };
  const drain=(flush=false)=>{
   buffer+=xhr.responseText.slice(cursor);cursor=xhr.responseText.length;
   const lines=buffer.split(/\r?\n/),tail=lines.pop()||'';
   if(flush){
    for(const line of [...lines,tail])if(line.startsWith('data:'))consume(line.slice(5));
    buffer='';
   }else{
    for(const line of lines)if(line.startsWith('data:'))consume(line.slice(5));
    buffer=tail;
   }
  };
  xhr.open('POST',url);xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('Accept','text/event-stream, application/json');if(key)xhr.setRequestHeader('Authorization','Bearer '+key);
  xhr.timeout=url.startsWith('http://127.0.0.1')?0:180000;xhr.onprogress=()=>drain(false);xhr.onerror=()=>{if(!settled){settled=true;reject(new Error('Network error while connecting to the model provider.'));}};
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
const THINK=/<think>[\s\S]*?(<\/think>|$)/gi;
export function stripThinking(text:string):string{return text.replace(THINK,'').trim();}
async function moeCompletion(config:AppConfig,messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{
 const server=moeServer!;let raw='',shown='';
 const emit=(token:string)=>{raw+=token;const clean=stripThinking(raw);if(clean.length>shown.length&&clean.startsWith(shown)){onToken?.(clean.slice(shown.length));shown=clean;}};
 const body={messages,max_tokens:2048,chat_template_kwargs:{enable_thinking:false},...(tools.length?{tools:tools.map(item=>({type:item.type,function:item.function})),tool_choice:'auto'}:{})};
 const result=await streamRequest(server.baseUrl+'/v1/chat/completions',server.apiKey,body,emit);
 return{content:stripThinking(result.content),toolCalls:result.toolCalls};
}
async function localCompletion(config:AppConfig,messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{
 if(prewarmTask)await prewarmTask;
 if(!moeServer)await reevaluate(config).catch(()=>{});
 void rememberPrefix(messages,tools);
 if(moeServer)return moeCompletion(config,messages,tools,onToken);
 if(!localContext)throw new Error('No chat model is loaded yet. Open Models to download Qwen3.8, or pick a cloud chat model.');
 let shown='';
 const emit=(visible:string)=>{const clean=stripThinking(visible);if(clean.length>shown.length&&clean.startsWith(shown)){onToken?.(clean.slice(shown.length));shown=clean;}};
 const params:any={messages,...(tools.length?{tools:tools.map(item=>({type:item.type,function:item.function})),tool_choice:'auto'}:{}),jinja:true,enable_thinking:false,reasoning_format:'auto',n_predict:2048,temperature:config.temperature,top_p:0.9,penalty_repeat:1.05,stop:['</s>','<|end|>','<|eot_id|>','<|end_of_text|>','<|im_end|>','<|end_of_turn|>'],...(currentThreads?{n_threads:currentThreads}:{})};
 const result:any=await localContext.completion(params,(event:any)=>{
  if(typeof event.content==='string')emit(event.content);
  else if(typeof event.accumulated_text==='string')emit(event.accumulated_text);
  else if(event.token){shown+=event.token;onToken?.(event.token);}
 });
 const toolCalls=normalizeToolCalls(result.tool_calls||[]);
 const content=stripThinking(typeof result.content==='string'&&(result.content||toolCalls.length)?result.content:String(result.text||''));
 return{content:toolCalls.length?content:content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g,'').trim(),toolCalls};
}
export async function complete(messages:ModelMessage[],tools:ToolDefinition[],onToken?:(token:string)=>void):Promise<ModelResponse>{const config=await loadConfig();return config.mode==='local'?localCompletion(config,messages,tools,onToken):apiCompletion(config,messages,tools,onToken);}
export async function testProviderConnection():Promise<string>{const config=await loadConfig();if(config.mode!=='api')throw new Error('Switch to API provider mode to test this connection.');const result=await apiCompletion(config,[{role:'user',content:'Reply with the single word OK.'}],[]);return result.content.trim()||'The provider responded, but returned no text.';}
export async function releaseLocalModel():Promise<void>{await releaseAll();activeLocalPath='';activeLocalConfig=null;localRuntimeStatus='';activePlan=null;}
