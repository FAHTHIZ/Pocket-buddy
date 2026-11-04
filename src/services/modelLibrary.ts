import{NativeModules}from'react-native';
import type{DeviceProfile,NativeDownloadStatus}from'../types';
type NativeDownload={
 startDownload(url:string,fileName:string,headers:Record<string,string>):Promise<{downloadId:string}>;
 getDownloadStatus(id:string):Promise<NativeDownloadStatus>;
 cancelDownload(id:string):Promise<boolean>;
 getDeviceProfile():Promise<DeviceProfile>;
};
const Native=NativeModules.PocketBuddyNative as NativeDownload;
export type HubModel={id:string;downloads:number;likes:number};
export type HubFile={name:string;size?:number};
export async function getDeviceProfile():Promise<DeviceProfile>{
 if(!Native?.getDeviceProfile)throw new Error('Android device profile is unavailable. Rebuild the app.');
 return Native.getDeviceProfile();
}
export async function searchHuggingFaceModels(query:string):Promise<HubModel[]>{
 const response=await fetch('https://huggingface.co/api/models?search='+encodeURIComponent(query)+'&filter=gguf&sort=downloads&direction=-1&limit=30');
 if(!response.ok)throw new Error('Hugging Face search returned HTTP '+response.status);
 return(await response.json()).map((item:any)=>({id:item.id,downloads:item.downloads||0,likes:item.likes||0}));
}
export async function getModelFiles(id:string):Promise<HubFile[]>{
 const response=await fetch('https://huggingface.co/api/models/'+id.split('/').map(encodeURIComponent).join('/'));
 if(!response.ok)throw new Error('Could not load model files.');
 const data=await response.json();
 return(data.siblings||[]).map((item:any)=>({name:item.rfilename,size:item.lfs?.size||item.size})).filter((item:HubFile)=>item.name.toLowerCase().endsWith('.gguf'));
}
const wait=(ms:number):Promise<void>=>new Promise(resolve=>{setTimeout(()=>resolve(),ms);});
function uniqueDownloadName(id:string,file:string):string{
 const source=id+'/'+file;
 let hash=2166136261;
 for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
 const prefix=id.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,48)||'model';
 const digest=(hash>>>0).toString(16).padStart(8,'0');
 const leaf=file.split('/').pop()||'model.gguf';
 const maximum=Math.max(24,180-prefix.length-digest.length-2);
 return prefix+'-'+digest+'-'+leaf.slice(-maximum);
}
export async function downloadModel(id:string,file:string,onProgress:(value:number)=>void,onId?:(id:string)=>void):Promise<string>{
 if(!Native?.startDownload||!Native?.getDownloadStatus)throw new Error('Android system download manager is unavailable.');
 const url='https://huggingface.co/'+id.split('/').map(encodeURIComponent).join('/')+'/resolve/main/'+file.split('/').map(encodeURIComponent).join('/');
 const result=await Native.startDownload(url,uniqueDownloadName(id,file),{});
 onId?.(result.downloadId);
 for(let attempt=0;attempt<6*60*60;attempt++){
  const state=await Native.getDownloadStatus(result.downloadId);
  onProgress(Math.round(Math.max(0,Math.min(1,state.progress))*100));
  if(state.status==='complete'){
   if(state.localPath)return state.localPath;
   throw new Error('Android reports the download finished but did not return a readable model file path.');
  }
  if(state.status==='failed')throw new Error('Android download failed. System reason code: '+(state.reason??'unknown'));
  await wait(1000);
 }
 await Native.cancelDownload(result.downloadId);
 throw new Error('Download monitoring timed out. The system transfer was cancelled.');
}