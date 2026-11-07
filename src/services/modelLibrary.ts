import AsyncStorage from '@react-native-async-storage/async-storage';
import{NativeModules}from'react-native';
import{getHuggingFaceToken}from'./storage';
import type{DeviceProfile,LocalModelRecord,NativeDownloadStatus}from'../types';
type NativeDownload={startDownload(url:string,fileName:string,headers:Record<string,string>):Promise<{downloadId:string}>;getDownloadStatus(id:string):Promise<NativeDownloadStatus>;cancelDownload(id:string):Promise<boolean>;getDeviceProfile():Promise<DeviceProfile>};
const Native=NativeModules.PocketBuddyNative as NativeDownload;
const LIBRARY_KEY='pocket-buddy.installed-models.v1';
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
const wait=(ms:number):Promise<void>=>new Promise(resolve=>{setTimeout(resolve,ms);});
function uniqueDownloadName(id:string,file:string):string{
 const source=id+'/'+file;let hash=2166136261;for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
 const prefix=id.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,48)||'model',digest=(hash>>>0).toString(16).padStart(8,'0'),leaf=file.split('/').pop()||'model.gguf';
 return prefix+'-'+digest+'-'+leaf.slice(-Math.max(24,180-prefix.length-digest.length-2));
}
export async function downloadModel(id:string,file:string,onProgress:(value:number)=>void,onId?:(id:string)=>void):Promise<string>{
 if(!Native?.startDownload||!Native?.getDownloadStatus)throw new Error('Android system download manager is unavailable.');
 const encodedId=id.split('/').map(encodeURIComponent).join('/'),encodedFile=file.split('/').map(encodeURIComponent).join('/'),url='https://huggingface.co/'+encodedId+'/resolve/main/'+encodedFile;
 const result=await Native.startDownload(url,uniqueDownloadName(id,file),await hfHeaders());onId?.(result.downloadId);
 for(let attempt=0;attempt<6*60*60;attempt++){
  const state=await Native.getDownloadStatus(result.downloadId);onProgress(Math.round(Math.max(0,Math.min(1,state.progress))*100));
  if(state.status==='complete'){if(state.localPath)return state.localPath;throw new Error('Android reports the download finished but did not return a readable model file path.');}
  if(state.status==='failed')throw new Error('Android download failed. System reason code: '+(state.reason??'unknown'));
  await wait(1000);
 }
 await Native.cancelDownload(result.downloadId);throw new Error('Download monitoring timed out. The system transfer was cancelled.');
}
