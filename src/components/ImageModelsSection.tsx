import React,{useEffect,useState}from'react';
import{Alert,Pressable,StyleSheet,Switch,Text,View}from'react-native';
import{LOCAL_IMAGE_MODELS,TAESD,downloadLocalImageModel,downloadTaesd,forgetLocalImageModel,installedLocalImageFiles,localEngineStatus}from'../services/localImage';
import{deleteInstalledModelFile}from'../services/modelLibrary';
import{VIDEO_PACK,VIDEO_PACK_MB,downloadVideoPack,forgetVideoPack,installedVideoPack}from'../services/localVideo';
import{loadConfig,saveConfig}from'../services/storage';
import type{AppConfig}from'../types';

/** Download, pick and delete on-device image models (stable-diffusion.cpp). */
export default function ImageModelsSection(){
 const[installed,setInstalled]=useState<Record<string,string>>({}),[config,setConfig]=useState<AppConfig|null>(null);
 const[busy,setBusy]=useState(''),[progress,setProgress]=useState(0),[engine,setEngine]=useState<{available:boolean;detail:string}|null>(null);
 const[video,setVideo]=useState<Record<string,string>>({}),[videoLabel,setVideoLabel]=useState('');
 const refresh=async()=>{setInstalled(await installedLocalImageFiles());setVideo(await installedVideoPack());setConfig(await loadConfig());};
 const getVideo=async()=>{
  if(busy)return;
  try{setBusy('video');setProgress(0);await downloadVideoPack((label,percent)=>{setVideoLabel(label);setProgress(percent);});await refresh();}
  catch(error){Alert.alert('Download failed',(error instanceof Error?error.message:String(error))+'\n\nFinished files are kept; tap Download again to continue.');await refresh();}
  finally{setBusy('');setProgress(0);setVideoLabel('');}
 };
 const removeVideo=()=>Alert.alert('Delete the video pack?','Frees about '+(VIDEO_PACK_MB/1024).toFixed(1)+' GB.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{for(const path of await forgetVideoPack())await deleteInstalledModelFile(path).catch(()=>false);await refresh();}}]);
 const videoCount=VIDEO_PACK.filter(item=>video[item.key]).length,videoReady=videoCount===VIDEO_PACK.length;
 useEffect(()=>{refresh().catch(()=>{});localEngineStatus().then(setEngine).catch(()=>{});},[]);
 const update=async(patch:Partial<AppConfig>)=>{const next={...(await loadConfig()),...patch};await saveConfig(next);setConfig(next);};
 const download=async(id:string)=>{
  if(busy)return;
  try{setBusy(id);setProgress(0);
   if(id==='taesd')await downloadTaesd(setProgress);
   else{await downloadLocalImageModel(id,setProgress);if(!installed[config?.localImageModel||''])await update({localImageModel:id,imageEngine:'device'});}
   await refresh();
  }catch(error){Alert.alert('Download failed',error instanceof Error?error.message:String(error));}
  finally{setBusy('');setProgress(0);}
 };
 const remove=(id:string,title:string)=>Alert.alert('Delete '+title+'?','This frees its storage. You can download it again later.',[
  {text:'Cancel',style:'cancel'},
  {text:'Delete',style:'destructive',onPress:async()=>{try{const path=installed[id];if(path)await deleteInstalledModelFile(path).catch(()=>false);await forgetLocalImageModel(id);await refresh();}catch(error){Alert.alert('Could not delete',error instanceof Error?error.message:String(error));}}},
 ]);
 const deviceMode=config?.imageEngine!=='comfyui';
 return <View style={s.section}>
  <View style={s.head}><View style={{flex:1}}><Text style={s.title}>Images & video · on this phone</Text><Text style={s.sub}>Create pictures offline with no account and no server. Adult content is allowed; sexual content involving minors is always refused. A picture takes roughly 3–6 minutes on a mid-range phone such as the Helio G85 (faster on newer chips); the chat model pauses while it draws.</Text></View></View>
  {engine&&!engine.available?<Text style={s.warn}>{engine.detail}</Text>:null}
  <View style={s.row}><Text style={s.rowLabel}>Make images on this phone</Text><Switch value={deviceMode} onValueChange={value=>update({imageEngine:value?'device':'comfyui'})}/></View>
  {!deviceMode?<Text style={s.note}>Images currently go to your ComfyUI server (Settings).</Text>:null}
  {LOCAL_IMAGE_MODELS.map(item=>{
   const have=!!installed[item.id],active=have&&config?.localImageModel===item.id;
   return <View key={item.id} style={[s.card,active&&s.cardActive]}>
    <View style={s.cardTop}><View style={{flex:1}}><Text style={s.name}>{item.title}</Text><Text style={s.meta}>~{(item.approxMb/1024).toFixed(1)} GB · {item.license}</Text></View>{active?<Text style={s.tag}>In use</Text>:null}</View>
    <Text style={s.desc}>{item.description}</Text>
    <View style={s.actions}>
     {busy===item.id?<Text style={s.progress}>Downloading… {progress}%</Text>:have?<>
      {!active?<Pressable style={s.button} onPress={()=>update({localImageModel:item.id,imageEngine:'device'})}><Text style={s.buttonText}>Use</Text></Pressable>:null}
      <Pressable style={s.ghost} onPress={()=>remove(item.id,item.title)}><Text style={s.ghostText}>Delete</Text></Pressable>
     </>:<Pressable disabled={!!busy} style={[s.button,!!busy&&s.disabled]} onPress={()=>download(item.id)}><Text style={s.buttonText}>Download</Text></Pressable>}
    </View>
   </View>;
  })}
  <View style={[s.card,{marginTop:14}]}>
   <View style={s.cardTop}><View style={{flex:1}}><Text style={s.name}>Video on this phone · Wan 2.1 1.3B</Text><Text style={s.meta}>~{(VIDEO_PACK_MB/1024).toFixed(1)} GB pack · Apache 2.0 · experimental</Text></View>{videoReady?<Text style={s.tag}>Ready</Text>:null}</View>
   <Text style={s.desc}>Offline text-to-video: 1–3 second clips at 416×240 that take about 8–25 minutes each on a mid-range phone (keep it plugged in). Quality is far below Wan 2.2 on a PC, but nothing leaves your phone.</Text>
   <View style={s.row}><Text style={s.rowLabel}>Make videos on this phone</Text><Switch value={config?.videoEngine!=='comfyui'} onValueChange={value=>update({videoEngine:value?'device':'comfyui'})}/></View>
   <View style={s.actions}>
    {busy==='video'?<Text style={s.progress} numberOfLines={1}>{videoLabel?videoLabel.slice(0,28)+' · ':''}{progress}%</Text>:videoReady?<Pressable style={s.ghost} onPress={removeVideo}><Text style={s.ghostText}>Delete</Text></Pressable>:<Pressable disabled={!!busy} style={[s.button,!!busy&&s.disabled]} onPress={getVideo}><Text style={s.buttonText}>{videoCount?'Resume download ('+videoCount+'/'+VIDEO_PACK.length+')':'Download'}</Text></Pressable>}
   </View>
  </View>
  <View style={s.row}>
   <View style={{flex:1}}><Text style={s.rowLabel}>Fast decoder (TAESD, {TAESD.approxMb} MB)</Text><Text style={s.note}>Downloaded automatically. Saves about 2 minutes per picture; turn off for slightly crisper detail.</Text></View>
   {installed.taesd?<Switch value={config?.localImageFastDecode!==false} onValueChange={value=>update({localImageFastDecode:value})}/>:busy==='taesd'?<Text style={s.progress}>{progress}%</Text>:<Pressable disabled={!!busy} style={[s.button,!!busy&&s.disabled]} onPress={()=>download('taesd')}><Text style={s.buttonText}>Get</Text></Pressable>}
  </View>
 </View>;
}
const s=StyleSheet.create({
 section:{marginHorizontal:16,marginTop:9,marginBottom:5,padding:12,borderRadius:16,backgroundColor:'#17191e',borderWidth:1,borderColor:'#303640'},
 head:{flexDirection:'row',marginBottom:6},title:{color:'#f4f4f5',fontSize:13,fontWeight:'800'},sub:{color:'#a1a1aa',fontSize:10,lineHeight:15,marginTop:3},
 warn:{color:'#f5c27a',fontSize:10,lineHeight:15,marginVertical:6},note:{color:'#8b93a0',fontSize:9,lineHeight:13,marginTop:2},
 row:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:8,borderTopWidth:1,borderTopColor:'#2c3139',marginTop:6},rowLabel:{color:'#e6e9f0',fontSize:11,fontWeight:'700',flex:1},
 card:{backgroundColor:'#202329',borderWidth:1,borderColor:'#383f49',borderRadius:12,padding:11,marginTop:8},cardActive:{borderColor:'#8fb3ff'},
 cardTop:{flexDirection:'row',alignItems:'flex-start',gap:8},name:{color:'#f1f2f6',fontSize:12,fontWeight:'800'},meta:{color:'#a8b4c4',fontSize:9,marginTop:4},
 tag:{color:'#d1dbee',fontSize:8,fontWeight:'700',backgroundColor:'#303640',borderRadius:10,paddingHorizontal:8,paddingVertical:5,overflow:'hidden'},
 desc:{color:'#b7bdc8',fontSize:10,lineHeight:15,marginTop:8},actions:{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:8,marginTop:9},
 button:{backgroundColor:'#e9edf5',borderRadius:15,paddingHorizontal:13,paddingVertical:8},buttonText:{color:'#13171d',fontSize:10,fontWeight:'800'},disabled:{opacity:0.55},
 ghost:{borderWidth:1,borderColor:'#4a515c',borderRadius:15,paddingHorizontal:12,paddingVertical:7},ghostText:{color:'#d4d8df',fontSize:10,fontWeight:'700'},
 progress:{color:'#c6d7ff',fontSize:10,fontWeight:'700'},
});
