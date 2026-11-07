import AsyncStorage from '@react-native-async-storage/async-storage';
import{NativeModules}from'react-native';
import{getHuggingFaceToken}from'./storage';
import type{DeviceProfile,LocalBenchmark,LocalModelRecord,NativeDownloadStatus,PendingModelDownload,PendingModelDownloadState}from'../types';
type NativeDownload={startDownload(url:string,fileName:string,headers:Record<string,string>):Promise<{downloadId:string}>;getDownloadStatus(id:string):Promise<NativeDownloadStatus>;cancelDownload(id:string):Promise<boolean>;getDeviceProfile():Promise<DeviceProfile>;deleteModelFile(path:string):Promise<boolean>};
const Native=NativeModules.PocketBuddyNative as NativeDownload;
const LIBRARY_KEY='pocket-buddy.installed-models.v1';
const DOWNLOADS_KEY='pocket-buddy.pending-model-downloads.v1';
const BENCHMARK_KEY='pocket-buddy.model-benchmarks.v1';
export async function getModelBenchmark(path:string):Promise<LocalBenchmark|null>{
 try{const value=JSON.parse((await AsyncStorage.getItem(BENCHMARK_KEY))||'{}');return value&&typeof value==='object'&&value[path]?value[path] as LocalBenchmark:null;}catch{return null;}
}
export async function saveModelBenchmark(path:string,result:LocalBenchmark):Promise<void>{
 let value:Record<string,LocalBenchmark>={};try{value=JSON.parse((await AsyncStorage.getItem(BENCHMARK_KEY))||'{}')||{};}catch{}
 value[path]=result;await AsyncStorage.setItem(BENCHMARK_KEY,JSON.stringify(value));
}
export type HubModel={id:string;downloads:number;likes:number};
export type HubFile={name:string;size?:number};
export async function getDeviceProfile():Promise<DeviceProfile>{if(!Native?.getDeviceProfile)throw new Error('Android device profile is unavailable. Rebuild the app.');return Native.getDeviceProfile();}
async function hfHeaders():Promise<Record<string,string>>{const token=await getHuggingFaceToken();return token?{Authorization:'Bearer '+token}:{};}
export async function searchHuggingFaceModels(query:string):Promise<HubModel[]>{
 const response=await fetch('https://huggingface.co/api/models?search='+encodeURIComponent(query)+'&filter=gguf&sort=downloads&direction=-1&limit=30',{headers:{Accept:'application/json',...await hfHeaders()}});
 if(!response.ok)throw new Error('Hugging Face search returned HTTP '+response.status);
 const items=await response.json();if(!Array.isArray(items))throw new Error('Hugging Face returned an unexpected model list.');
 return items.map((item:any)=>({id:String(item.id||''),downloads:Number(item.downloads)||0,likes:Number(item.likes)||0})).filter((item:HubModel)=>!!item.id);
}
export async function getModelFiles(id:string):Promise<HubFile[]>{
 const encodedId=id.split('/').map(encodeURIComponent).join('/'),response=await fetch('https://huggingface.co/api/models/'+encodedId,{headers:{Accept:'application/json',...await hfHeaders()}});
 if(!response.ok)throw new Error('Could not load model files (HTTP '+response.status+'). For gated models, add a Hugging Face read token in Settings.');
 const data=await response.json();return(data.siblings||[]).map((item:any)=>({name:item.rfilename,size:item.lfs?.size||item.size})).filter((item:HubFile)=>item.name.toLowerCase().endsWith('.gguf'));
}
export async function listInstalledModels():Promise<LocalModelRecord[]>{
 try{const value=JSON.parse((await AsyncStorage.getItem(LIBRARY_KEY))||'[]');if(!Array.isArray(value))return [];
  return value.filter((item:any)=>item&&typeof item.id==='string'&&typeof item.path==='string'&&typeof item.name==='string').sort((a:any,b:any)=>(Number(b.addedAt)||0)-(Number(a.addedAt)||0));
 }catch{return [];}
}
export async function registerInstalledModel(item:LocalModelRecord):Promise<LocalModelRecord[]>{
 const current=await listInstalledModels(),next=[item,...current.filter(existing=>existing.path!==item.path)].slice(0,100);
 await AsyncStorage.setItem(LIBRARY_KEY,JSON.stringify(next));return next;
}
export async function removeInstalledModel(path:string):Promise<LocalModelRecord[]>{
 const current=await listInstalledModels(),next=current.filter(item=>item.path!==path);
 await AsyncStorage.setItem(LIBRARY_KEY,JSON.stringify(next));
 try{const benchmarks=JSON.parse((await AsyncStorage.getItem(BENCHMARK_KEY))||'{}');if(benchmarks&&typeof benchmarks==='object'){delete benchmarks[path];await AsyncStorage.setItem(BENCHMARK_KEY,JSON.stringify(benchmarks));}}catch{}
 return next;
}
export async function deleteInstalledModelFile(path:string):Promise<boolean>{
 if(!Native?.deleteModelFile)throw new Error('Safe model-file deletion is unavailable. Rebuild the app.');
 const removed=await Native.deleteModelFile(path);
 await removeInstalledModel(path);
 return removed;
}
export async function listPendingModelDownloads():Promise<PendingModelDownload[]>{
 try{const value=JSON.parse((await AsyncStorage.getItem(DOWNLOADS_KEY))||'[]');return Array.isArray(value)?value.filter((item:any)=>item&&typeof item.downloadId==='string'&&typeof item.modelId==='string'&&typeof item.fileName==='string'):[];}catch{return [];}
}
async function savePendingModelDownload(item:PendingModelDownload):Promise<void>{
 const current=await listPendingModelDownloads(),next=[item,...current.filter(existing=>existing.downloadId!==item.downloadId)];
 await AsyncStorage.setItem(DOWNLOADS_KEY,JSON.stringify(next));
}
async function forgetPendingModelDownload(id:string):Promise<void>{
 const current=await listPendingModelDownloads();await AsyncStorage.setItem(DOWNLOADS_KEY,JSON.stringify(current.filter(item=>item.downloadId!==id)));
}
export class ModelDownloadCancelledError extends Error{
 constructor(){super('Model download was cancelled.');this.name='ModelDownloadCancelledError';}
}
const activeDownloadIds=new Set<string>(),cancelledDownloadIds=new Set<string>();
export async function cancelModelDownload(id:string):Promise<void>{
 if(!Native?.cancelDownload)throw new Error('Android download cancellation is unavailable.');
 const active=activeDownloadIds.has(id);
 if(active)cancelledDownloadIds.add(id);
 try{
  await Native.cancelDownload(id);
  await forgetPendingModelDownload(id);
 }catch(error){
  if(active)cancelledDownloadIds.delete(id);
  throw error;
 }
}
export async function refreshPendingModelDownloads():Promise<PendingModelDownloadState[]>{
 const pending=await listPendingModelDownloads(),results:PendingModelDownloadState[]=[];
 for(const item of pending){
  try{
   const state=await Native.getDownloadStatus(item.downloadId);
   if(state.status==='complete'){
    if(state.localPath){
     await registerInstalledModel({id:item.modelId+'::'+item.fileName,modelId:item.modelId,name:item.name,fileName:item.fileName,path:state.localPath,size:item.size,addedAt:item.startedAt});
    }else{
     results.push({...item,status:'failed',progress:1,reason:0});
    }
    await forgetPendingModelDownload(item.downloadId);
    continue;
   }
   if(state.status==='failed'){
    results.push({...item,status:'failed',progress:state.progress,reason:state.reason});
    await forgetPendingModelDownload(item.downloadId);
    continue;
   }
   results.push({...item,status:state.status,progress:Math.max(0,Math.min(1,state.progress||0)),reason:state.reason});
  }catch{
   results.push({...item,status:'unknown',progress:0});
  }
 }
 return results;
}
const wait=(ms:number):Promise<void>=>new Promise(resolve=>{setTimeout(resolve,ms);});
function uniqueDownloadName(id:string,file:string):string{
 const source=id+'/'+file;let hash=2166136261;for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
 const prefix=id.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,48)||'model',digest=(hash>>>0).toString(16).padStart(8,'0'),leaf=file.split('/').pop()||'model.gguf';
 return prefix+'-'+digest+'-'+leaf.slice(-Math.max(24,180-prefix.length-digest.length-2));
}
export async function downloadModel(id:string,file:string,onProgress:(value:number)=>void,onId?:(id:string)=>void,size?:number):Promise<string>{
 if(!Native?.startDownload||!Native?.getDownloadStatus)throw new Error('Android system download manager is unavailable.');
 const encodedId=id.split('/').map(encodeURIComponent).join('/'),encodedFile=file.split('/').map(encodeURIComponent).join('/'),url='https://huggingface.co/'+encodedId+'/resolve/main/'+encodedFile;
 const result=await Native.startDownload(url,uniqueDownloadName(id,file),await hfHeaders()),downloadId=result.downloadId;
 activeDownloadIds.add(downloadId);
 try{
  onId?.(downloadId);
  await savePendingModelDownload({downloadId,modelId:id,name:id.split('/').pop()||'Local model',fileName:file,size,startedAt:Date.now()});
  for(let attempt=0;attempt<6*60*60;attempt++){
   if(cancelledDownloadIds.has(downloadId))throw new ModelDownloadCancelledError();
   let state:NativeDownloadStatus;
   try{state=await Native.getDownloadStatus(downloadId);}
   catch(error){if(cancelledDownloadIds.has(downloadId))throw new ModelDownloadCancelledError();throw error;}
   if(cancelledDownloadIds.has(downloadId))throw new ModelDownloadCancelledError();
   onProgress(Math.round(Math.max(0,Math.min(1,state.progress))*100));
   if(state.status==='complete'){
    if(state.localPath){
     await registerInstalledModel({id:id+'::'+file,modelId:id,name:id.split('/').pop()||'Local model',fileName:file,path:state.localPath,size,addedAt:Date.now()});
     await forgetPendingModelDownload(downloadId);return state.localPath;
    }
    throw new Error('Android reports the download finished but did not return a readable model file path.');
   }
   if(state.status==='failed'){await forgetPendingModelDownload(downloadId);throw new Error('Android download failed. System reason code: '+(state.reason??'unknown'));}
   await wait(1000);
  }
  await Native.cancelDownload(downloadId);await forgetPendingModelDownload(downloadId);
  throw new Error('Download monitoring timed out. The system transfer was cancelled.');
 }finally{
  activeDownloadIds.delete(downloadId);cancelledDownloadIds.delete(downloadId);
 }
}