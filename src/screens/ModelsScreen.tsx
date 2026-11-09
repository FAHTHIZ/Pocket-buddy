import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,TextInput,View}from'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import{downloadModel,getDeviceProfile,getModelFiles,searchHuggingFaceModels,listInstalledModels,registerInstalledModel,getModelBenchmark,saveModelBenchmark,deleteInstalledModelFile,refreshPendingModelDownloads,cancelModelDownload,ModelDownloadCancelledError,type HubFile,type HubModel}from'../services/modelLibrary';
import{getLocalRuntimeStatus,loadLocalModel,runLocalBenchmark,moeEngineAvailable}from'../services/llm';
import{inspectModel,type ModelArchitecture}from'../services/hardware';
import type{DeviceProfile,LocalBenchmark,LocalModelRecord,PendingModelDownloadState}from'../types';
const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type QuickPick={id:string;name:string;repo:string;fileName:string;sizeLabel:string;description:string;fitLabel:string;minRamMb:number;moe?:boolean};
export const QUICK_PICKS:QuickPick[]=[
 {id:'qwen3.8-2b-uncensored',name:'Qwen3.8 2B Uncensored',repo:'atakhadivi/Qwen3.8-2B-Uncensored-GGUF',fileName:'Qwen3.8-2B-Uncensored-Q4_K_M.gguf',sizeLabel:'~1.27 GB',description:'The default Pocket Buddy brain. Fast, unfiltered everyday chat with tool calling, so it can create images, video and audio for you. Runs fully offline.',fitLabel:'Default · recommended',minRamMb:0},
 {id:'qwen3.8-4b-heretic',name:'Qwen3.8 4B Heretic',repo:'mradermacher/Qwen3.8-4B-Heretic-i1-GGUF',fileName:'Qwen3.8-4B-Heretic.i1-Q4_K_M.gguf',sizeLabel:'~2.7 GB',description:'A bigger uncensored Qwen3.8 for flagship phones. Smarter answers and better writing, but slower and needs plenty of free memory.',fitLabel:'For 8 GB+ phones',minRamMb:5800},
 {id:'lfm2-8b-a1b-abliterated',name:'LFM2 8B-A1B Abliterated (MoE)',repo:'mradermacher/Huihui-LFM2-8B-A1B-abliterated-i1-GGUF',fileName:'Huihui-LFM2-8B-A1B-abliterated.i1-IQ4_XS.gguf',sizeLabel:'~4.5 GB',description:'An uncensored 8B Mixture-of-Experts model (32 experts, 4 active per token). On 6 GB phones it does not fit in RAM: Pocket Buddy memory-maps it or streams only the active experts from storage, whichever the benchmark measures faster on your phone. It replies slowly (about 2–3 tokens/s in a 6 GB eMMC test), so choose it for quality, not speed. Phones with more RAM run it fully in memory and much faster.',fitLabel:'Heavy · MoE',minRamMb:5000,moe:true},
 {id:'qwen3-0.6b',name:'Qwen3 0.6B Lite',repo:'unsloth/Qwen3-0.6B-GGUF',fileName:'Qwen3-0.6B-Q4_K_M.gguf',sizeLabel:'~397 MB',description:'A tiny fallback for older or low-memory phones. Good for short questions; less capable than the default.',fitLabel:'Lightweight',minRamMb:0},
];
export const DEFAULT_PICK_ID='qwen3.8-2b-uncensored';
export type CloudChoice={label:string;baseUrl:string;model:string;needsKey:boolean};
type Props={onBack:()=>void;onOpenSettings:()=>void;onLoaded:(name:string,uri:string)=>void;autoStart?:string;onAutoStartHandled?:()=>void;onCloud:(choice:CloudChoice)=>Promise<void>};
function bytesLabel(value?:number):string{return value?(value/1024/1024/1024).toFixed(2)+' GB':'Size unknown';}
export default function ModelsScreen({onBack,onOpenSettings,onLoaded,autoStart,onAutoStartHandled,onCloud}:Props){
 const[libraryReady,setLibraryReady]=useState(false);
 const[cloudModels,setCloudModels]=useState<CloudChoice[]>([]),[cloudBusy,setCloudBusy]=useState('');
 const[query,setQuery]=useState(''),[models,setModels]=useState<HubModel[]>([]),[files,setFiles]=useState<Record<string,HubFile[]>>({});
 const[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[device,setDevice]=useState<DeviceProfile|null>(null),[downloading,setDownloading]=useState('');
 const[installed,setInstalled]=useState<LocalModelRecord[]>([]),[activePath,setActivePath]=useState(''),[runtimeStatus,setRuntimeStatus]=useState(''),[benchmark,setBenchmark]=useState<LocalBenchmark|null>(null),[benchmarkBusy,setBenchmarkBusy]=useState(false),[pendingDownloads,setPendingDownloads]=useState<PendingModelDownloadState[]>([]),[quickLoading,setQuickLoading]=useState(''),[cancellingDownload,setCancellingDownload]=useState('');
 const[arch,setArch]=useState<Record<string,ModelArchitecture|null>>({});
 useEffect(()=>{installed.forEach(item=>{if(!(item.path in arch))inspectModel(item.path).then(a=>setArch(old=>({...old,[item.path]:a}))).catch(()=>setArch(old=>({...old,[item.path]:null})));});},[installed]);// eslint-disable-line react-hooks/exhaustive-deps
 const refreshLibrary=async()=>{const [next,items]=await Promise.all([listInstalledModels(),refreshPendingModelDownloads()]);setInstalled(next);setPendingDownloads(items);setLibraryReady(true);};
 useEffect(()=>{getDeviceProfile().then(setDevice).catch(()=>{});AsyncStorage.getItem('pocket-buddy.local-model-uri').then(value=>setActivePath(value||'')).catch(()=>{});refreshLibrary().catch(()=>{});const timer=setInterval(()=>refreshLibrary().catch(()=>{}),3000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(activePath)getModelBenchmark(activePath).then(setBenchmark).catch(()=>setBenchmark(null));else setBenchmark(null);},[activePath]);
 const runBenchmark=async()=>{try{setBenchmarkBusy(true);const result=await runLocalBenchmark();await saveModelBenchmark(activePath,result);setBenchmark(result);}catch(error){Alert.alert('Benchmark failed',error instanceof Error?error.message:String(error));}finally{setBenchmarkBusy(false);}};
 const removeModel=(item:LocalModelRecord)=>{
  if(item.path===activePath){Alert.alert('Model is active','Switch to another model before deleting this file.');return;}
  Alert.alert('Delete downloaded model?',item.name+'\n'+item.fileName+'\n\nThis removes the model file from this app and frees its storage.',[
   {text:'Cancel',style:'cancel'},
   {text:'Delete',style:'destructive',onPress:async()=>{try{setBusy(true);await deleteInstalledModelFile(item.path);await refreshLibrary();}catch(error){Alert.alert('Could not delete model',error instanceof Error?error.message:String(error));}finally{setBusy(false);}}}
  ]);
 };
 const cancelPending=async(id:string)=>{
  if(cancellingDownload)return;
  try{setCancellingDownload(id);await cancelModelDownload(id);await refreshLibrary();}
  catch(error){Alert.alert('Could not cancel download',error instanceof Error?error.message:String(error));}
  finally{setCancellingDownload('');}
 };
 const search=async()=>{try{setBusy(true);setModels(await searchHuggingFaceModels(query));}catch(e){Alert.alert('Search failed',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const showFiles=async(id:string)=>{if(files[id]){setSelected(selected===id?'':id);return;}try{setBusy(true);const items=await getModelFiles(id);setFiles(old=>({...old,[id]:items}));setSelected(id);}catch(e){Alert.alert('Model files unavailable',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const activate=async(item:LocalModelRecord)=>{try{setBusy(true);await loadLocalModel(item.path,false,setRuntimeStatus);await AsyncStorage.setItem('pocket-buddy.local-model-uri',item.path);await AsyncStorage.setItem('pocket-buddy.active-model',item.name);setActivePath(item.path);setRuntimeStatus(getLocalRuntimeStatus());onLoaded(item.name,item.path);}catch(error){Alert.alert('Could not load model',error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 const install=async(modelId:string,file:HubFile,quickStart=false,displayName?:string)=>{
  const free=device?.availableStorageMb||0,need=file.size?file.size/1048576:0,ram=device?.availableRamMb||0,warnings:string[]=[];
  if(need&&free&&need*1.15>free)warnings.push('The download may exceed available device storage.');
  const estimatedRuntimeMb=need*1.18+384;
  // GGUF weights and inference buffers are native allocations; Android's Java memoryClass is not a useful cap for them.
  const safeRamBudget=device?Math.max(0,(device.availableRamMb||0)*0.68):0;
  const moePick=QUICK_PICKS.some(p=>p.moe&&p.fileName===file.name)&&await moeEngineAvailable();
  if(moePick&&need&&ram&&estimatedRuntimeMb>safeRamBudget)warnings.push('This Mixture-of-Experts model is larger than the free RAM, so Pocket Buddy will read part of it from storage while answering (memory-mapped or expert streaming; run Settings → Performance → Benchmark this phone to pick the faster one). It works, but replies are slow on eMMC phones. The 2B default stays the fastest for chat.');
  else if(need&&ram&&estimatedRuntimeMb>safeRamBudget)warnings.push('Rough fit estimate: this model may exceed the memory currently available to the phone after runtime and context overhead. Close other apps or choose a smaller model/context. This is a heuristic, not a guarantee.');
  const start=async()=>{try{setBusy(true);setDownloading(file.name);setProgress(0);const uri=await downloadModel(modelId,file.name,setProgress,undefined,file.size,file.sha256),modelName=displayName||modelId.split('/').pop()||'Local model';
   const record:LocalModelRecord={id:modelId+'::'+file.name,modelId,name:modelName,fileName:file.name,path:uri,size:file.size,sha256:file.sha256,addedAt:Date.now()};
   setInstalled(await registerInstalledModel(record));await AsyncStorage.setItem('pocket-buddy.local-model-uri',uri);await AsyncStorage.setItem('pocket-buddy.active-model',modelName);
   await loadLocalModel(uri,false,setRuntimeStatus);setActivePath(uri);setRuntimeStatus(getLocalRuntimeStatus());onLoaded(modelName,uri);
  }catch(e){if(!(e instanceof ModelDownloadCancelledError))Alert.alert('Could not install model',e instanceof Error?e.message:String(e));}finally{setBusy(false);setDownloading('');}};
  if(warnings.length){
   if(quickStart){
    await new Promise<void>(resolve=>Alert.alert('Check device compatibility',warnings.join('\n\n'),[
     {text:'Cancel',style:'cancel',onPress:()=>resolve()},
     {text:'Try anyway',onPress:()=>{void start().finally(()=>resolve());}}
    ],{cancelable:false}));
   }else Alert.alert('Check device compatibility',warnings.join('\n\n'),[{text:'Cancel',style:'cancel'},{text:'Try anyway',onPress:start}]);
  }else if(quickStart)await start();
  else Alert.alert('Download model?',(displayName||modelId)+'\n'+file.name+'\n'+bytesLabel(file.size),[{text:'Cancel',style:'cancel'},{text:'Download',onPress:start}]);
 };
 const quickInstall=async(preset:QuickPick)=>{
  if(busy||quickLoading)return;
  try{
   setQuickLoading(preset.id);setBusy(true);
   const available=await getModelFiles(preset.repo);
   const file=available.find(item=>item.name===preset.fileName);
   if(!file)throw new Error('The recommended GGUF file is no longer available in '+preset.repo+'. Use Search GGUF models to choose another quantization.');
   setBusy(false);
   await install(preset.repo,file,true,preset.name);
  }catch(error){Alert.alert('Could not prepare model',error instanceof Error?error.message:String(error));}
  finally{setBusy(false);setQuickLoading('');}
 };
 const recommendedPicks=QUICK_PICKS.filter(item=>item.minRamMb<=(device?.totalRamMb||99999)||item.id===DEFAULT_PICK_ID);
 const[autoHandled,setAutoHandled]=useState(false);
 useEffect(()=>{
  if(!autoStart||autoHandled||busy||quickLoading||!libraryReady)return;
  const pick=QUICK_PICKS.find(item=>item.id===autoStart);if(!pick){setAutoHandled(true);onAutoStartHandled?.();return;}
  const timer=setTimeout(()=>{
   setAutoHandled(true);onAutoStartHandled?.();
   const existing=installed.find(entry=>entry.modelId===pick.repo&&entry.fileName===pick.fileName);
   const pending=pendingDownloads.find(entry=>entry.modelId===pick.repo&&entry.fileName===pick.fileName);
   if(pending)return;
   if(existing)void activate(existing);else void quickInstall(pick);
  },700);
  return()=>clearTimeout(timer);
 },[autoStart,autoHandled,installed,pendingDownloads,busy,quickLoading,libraryReady]);
 useEffect(()=>{
  fetch('https://gen.pollinations.ai/text/models').then(r=>r.ok?r.json():[]).then((items:any[])=>{
   const list:CloudChoice[]=(Array.isArray(items)?items:[]).filter(item=>item&&typeof item.name==='string'&&(!item.output_modalities||item.output_modalities.includes('text'))).sort((a,b)=>Number(!!a.paid_only)-Number(!!b.paid_only)||Number(!String(b.name).includes('qwen'))-Number(!String(a.name).includes('qwen'))).slice(0,40).map(item=>({label:(item.paid_only?'Paid · ':'Free · ')+String(item.description||item.name).slice(0,60),baseUrl:'https://gen.pollinations.ai/v1',model:String(item.name),needsKey:true}));
   setCloudModels(list);
  }).catch(()=>{});
 },[]);
 const useCloud=async(choice:CloudChoice)=>{if(cloudBusy)return;try{setCloudBusy(choice.model);await onCloud(choice);}catch(error){Alert.alert('Could not switch to cloud chat',error instanceof Error?error.message:String(error));}finally{setCloudBusy('');}};
 const renderFile=(model:HubModel,file:HubFile)=>{
  const modelMb=file.size?file.size/1048576:0;
  const estimatedMb=modelMb*1.18+384;
  const ramBudget=device?Math.max(0,(device.availableRamMb||0)*0.68):0;
  const fitLabel=!device||!modelMb?'Fit unknown':estimatedMb<=ramBudget?'Likely fit':estimatedMb<=ramBudget*1.2?'Tight fit':'May not fit';
  return <View key={file.name} style={s.fileRow}>
   <View style={{flex:1}}>
    <Text style={s.fileName}>{file.name}</Text>
    <Text style={s.fileSize}>{bytesLabel(file.size)} · Rough fit: {fitLabel}</Text>
   </View>
   <Pressable disabled={busy} style={s.install} onPress={()=>install(model.id,file)}><Text style={s.installText}>Install</Text></Pressable>
  </View>;
 };
 return <View style={s.root}>
  <View style={s.header}><Pressable style={s.back} onPress={onBack}><Text style={s.backGlyph}>‹</Text></Pressable><Text style={s.title}>Models</Text><Pressable onPress={onOpenSettings}><Text style={s.settings}>Settings</Text></Pressable></View>
  <ScrollView style={s.content} contentContainerStyle={s.contentContainer} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
   <View style={s.intro}><Text style={s.heading}>Your models</Text><Text style={s.sub}>Tap Download & start on Qwen3.8 2B Uncensored and you are ready. Download once, chat offline forever. Or pick any GGUF from Hugging Face below.</Text></View>
   {device?<View style={s.device}><Text style={s.deviceTitle}>{device.manufacturer} {device.model}</Text><Text style={s.deviceInfo}>{(device.totalRamMb/1024).toFixed(1)} GB RAM · {Math.round(device.availableRamMb)} MB free now · {Math.round(device.availableStorageMb)} MB free storage · {device.soc||'SoC unknown'}</Text></View>:null}
   {(busy||!!quickLoading)?<View style={s.progress}><ActivityIndicator color="#eee"/><Text style={s.progressText}>{downloading?'Downloading '+downloading:quickLoading?'Preparing your model…':'Working…'} {progress>0?progress+'%':''}</Text></View>:null}
   {downloading?<View style={s.progressTrack}><View style={[s.progressFill,{width:progress+'%'}]}/></View>:null}
   {pendingDownloads.length?<View style={s.pendingPanel}>
    <Text style={s.pendingTitle}>Downloads</Text>
    {pendingDownloads.map(item=><View key={item.downloadId} style={s.pendingRow}>
     <View style={{flex:1}}><Text style={s.pendingName} numberOfLines={1}>{item.name} · {item.fileName}</Text><Text style={s.pendingStatus}>{item.status==='failed'?'Download failed':item.status==='unknown'?'Checking system download':item.status+' · '+Math.round(item.progress*100)+'%'}</Text></View>
     {item.status!=='failed'?<Pressable disabled={cancellingDownload===item.downloadId} style={s.pendingCancel} onPress={()=>cancelPending(item.downloadId)}><Text style={s.pendingCancelText}>{cancellingDownload===item.downloadId?'Cancelling…':'Cancel'}</Text></Pressable>:null}
    </View>)}
   </View>:null}
   <View style={s.quickSection}>
    <View style={s.quickHeading}><View style={{flex:1}}><Text style={s.quickTitle}>Start with a recommended model</Text><Text style={s.quickSubtitle}>Curated GGUF picks · one tap to download and start</Text></View><Text style={s.quickSpark}>✦</Text></View>
    {recommendedPicks.map(item=>{
     const existing=installed.find(entry=>entry.modelId===item.repo&&entry.fileName===item.fileName);
     const pending=pendingDownloads.find(entry=>entry.modelId===item.repo&&entry.fileName===item.fileName);
     const active=existing?.path===activePath;
     const buttonLabel=quickLoading===item.id?'Preparing…':pending?'Download in progress':active?'In chat':existing?'Load model':'Download & start';
     return <View key={item.id} style={s.quickCard}>
      <View style={s.quickCardTop}><View style={{flex:1}}><Text style={s.quickName}>{item.name}</Text><Text style={s.quickMeta}>{item.sizeLabel} · Q4_K_M · GGUF</Text></View><View style={s.quickTag}><Text style={s.quickTagText}>{item.fitLabel}</Text></View></View>
      <Text style={s.quickDescription}>{item.description}</Text>
      <View style={s.quickCardBottom}><Text style={s.quickOffline}>↓  Download once · use offline</Text>
       <Pressable disabled={busy||!!pending||!!quickLoading} style={[s.quickButton,(busy||!!pending||!!quickLoading)&&s.quickButtonDisabled]} onPress={()=>existing?activate(existing):quickInstall(item)}><Text style={s.quickButtonText}>{buttonLabel}</Text></Pressable>
      </View>
     </View>;
    })}
    {!recommendedPicks.length?<Text style={s.quickSubtitle}>Reading your phone's memory profile…</Text>:null}
    {device?.totalRamMb?<Text style={s.quickFootnote}>Larger models are hidden on phones with less memory. Speed depends on your chip, free memory and context size.</Text>:null}
   </View>
   <View style={s.quickSection}>
    <View style={s.quickHeading}><View style={{flex:1}}><Text style={s.quickTitle}>Cloud chat · no download</Text><Text style={s.quickSubtitle}>Runs on Pollinations servers. Start chatting instantly; your messages leave the phone.</Text></View><Text style={s.quickSpark}>☁</Text></View>
    <View style={s.quickCard}>
     <View style={s.quickCardTop}><View style={{flex:1}}><Text style={s.quickName}>Pollinations free chat</Text><Text style={s.quickMeta}>GPT-OSS 20B · free · no account</Text></View><View style={s.quickTag}><Text style={s.quickTagText}>Instant</Text></View></View>
     <View style={s.quickCardBottom}><Text style={s.quickOffline}>Needs internet</Text><Pressable disabled={!!cloudBusy} style={[s.quickButton,!!cloudBusy&&s.quickButtonDisabled]} onPress={()=>useCloud({label:'Cloud chat (free)',baseUrl:'https://text.pollinations.ai/openai',model:'openai',needsKey:false})}><Text style={s.quickButtonText}>{cloudBusy==='openai'?'Connecting…':'Use cloud chat'}</Text></Pressable></View>
    </View>
    {cloudModels.length?<Text style={[s.quickSubtitle,{marginTop:10}]}>More cloud models (needs Pollinations connected in Settings):</Text>:null}
    {cloudModels.map(item=><Pressable key={item.model} disabled={!!cloudBusy} onPress={()=>useCloud(item)} style={s.cloudRow}><Text style={s.cloudName} numberOfLines={1}>{item.model}</Text><Text style={s.cloudLabel} numberOfLines={1}>{cloudBusy===item.model?'Connecting…':item.label}</Text></Pressable>)}
   </View>
   <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.installedList}>
    {installed.length?installed.map(item=><View key={item.id} style={[s.installedCard,item.path===activePath&&s.installedCardActive]}><Text style={s.installedName} numberOfLines={2}>{item.name}</Text><Text style={s.installedFile} numberOfLines={2}>{item.fileName}</Text><Text style={s.installedSize}>{bytesLabel(item.size)}{arch[item.path]?' · '+(arch[item.path]!.isMoe?`MoE ${arch[item.path]!.expertUsedCount}/${arch[item.path]!.expertCount}`:'Dense'):''}</Text><Pressable disabled={busy} style={[s.loadButton,item.path===activePath&&s.loadedButton]} onPress={()=>activate(item)}><Text style={[s.loadButtonText,item.path===activePath&&s.loadedButtonText]}>{item.path===activePath?'Loaded':'Load model'}</Text></Pressable>
     {item.path===activePath?<Text style={s.activeHint}>Switch to another model before deleting</Text>:<Pressable disabled={busy} style={s.removeButton} onPress={()=>removeModel(item)}><Text style={s.removeButtonText}>Remove download</Text></Pressable>}</View>):<View style={s.noModels}><Text style={s.sub}>Your installed models will appear here.</Text></View>}
   </ScrollView>
   {runtimeStatus?<Text style={s.runtimeStatus}>Last loaded runtime: {runtimeStatus}</Text>:null}
   {activePath?<View style={s.benchmarkCard}>
    <View style={s.benchmarkTop}>
     <View style={{flex:1}}><Text style={s.benchmarkTitle}>Device benchmark</Text><Text style={s.benchmarkSub}>Native llama.cpp test · 512 prompt / 128 generated tokens · 3 runs</Text></View>
     <Pressable disabled={benchmarkBusy||busy} onPress={runBenchmark} style={s.benchmarkButton}><Text style={s.benchmarkButtonText}>{benchmarkBusy?'Running…':'Run'}</Text></Pressable>
    </View>
    {benchmark?<View style={s.benchmarkMetrics}>
     <View style={s.benchmarkMetric}><Text style={s.benchmarkValue}>{benchmark.promptTokensPerSecond.toFixed(1)}</Text><Text style={s.benchmarkLabel}>Prompt tok/s</Text></View>
     <View style={s.benchmarkMetric}><Text style={s.benchmarkValue}>{benchmark.generationTokensPerSecond.toFixed(1)}</Text><Text style={s.benchmarkLabel}>Generation tok/s</Text></View>
     <View style={s.benchmarkMetric}><Text style={s.benchmarkValue}>{benchmark.gpuActive?'GPU':'CPU'}</Text><Text style={s.benchmarkLabel}>Active backend</Text></View>
    </View>:<Text style={s.benchmarkSub}>Run a benchmark to measure prompt processing and generation speed on this device.</Text>}
   </View>:null}
   <View style={s.searchBox}><TextInput value={query} onChangeText={setQuery} placeholder="Search any GGUF model…" placeholderTextColor="#777" style={s.search}/><Pressable onPress={search} disabled={busy} style={s.searchButton}><Text style={s.searchButtonText}>Search</Text></Pressable></View>
   {models.length?models.map(item=><View key={item.id} style={s.card}><Pressable onPress={()=>showFiles(item.id)}><Text style={s.modelName}>{item.id}</Text><Text style={s.meta}>{item.downloads.toLocaleString()} downloads · {item.likes.toLocaleString()} likes · GGUF</Text><Text style={s.choose}>{selected===item.id?'Hide files ↑':'Choose a quantization ↓'}</Text></Pressable>{selected===item.id?(files[item.id]||[]).length?(files[item.id]||[]).map(file=>renderFile(item,file)):<Text style={s.empty}>No GGUF files were found in this repository.</Text>:null}</View>):<View style={s.emptyWrap}><Text style={s.empty}>Search Hugging Face to browse compatible GGUF models.</Text></View>}
   <Text style={s.note}>Check each model card and license before downloading. File size is only a rough fit indicator: runtime memory also depends on context length, architecture and quantization.</Text>
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},content:{flex:1},contentContainer:{paddingBottom:24},
 quickSection:{marginHorizontal:16,marginTop:9,marginBottom:5,padding:12,borderRadius:16,backgroundColor:'#17191e',borderWidth:1,borderColor:'#303640'},
 quickHeading:{flexDirection:'row',alignItems:'center',marginBottom:9},quickTitle:{color:C.text,fontSize:13,fontWeight:'800'},quickSubtitle:{color:C.muted,fontSize:10,lineHeight:15,marginTop:3},quickSpark:{color:'#c6d7ff',fontSize:19,paddingHorizontal:5},
 quickCard:{backgroundColor:'#202329',borderWidth:1,borderColor:'#383f49',borderRadius:12,padding:11,marginTop:8},
 quickCardTop:{flexDirection:'row',alignItems:'flex-start',gap:8},quickName:{color:'#f1f2f6',fontSize:12,fontWeight:'800'},quickMeta:{color:'#a8b4c4',fontSize:9,marginTop:4},
 quickTag:{backgroundColor:'#303640',borderRadius:10,paddingHorizontal:8,paddingVertical:5},quickTagText:{color:'#d1dbee',fontSize:8,fontWeight:'700'},
 quickDescription:{color:'#b7bdc8',fontSize:10,lineHeight:15,marginTop:8},quickCardBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:9},
 quickOffline:{color:'#99bca9',fontSize:8,flex:1},quickButton:{backgroundColor:'#e9edf5',borderRadius:15,paddingHorizontal:13,paddingVertical:9},quickButtonDisabled:{opacity:0.55},quickButtonText:{color:'#13171d',fontSize:9,fontWeight:'800'},
 cloudRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:9,borderTopWidth:1,borderTopColor:'#2c3139'},cloudName:{color:'#e6e9f0',fontSize:11,fontWeight:'700',flex:1},cloudLabel:{color:'#9aa3b1',fontSize:10,flex:1,textAlign:'right'},
 quickFootnote:{color:'#777f8b',fontSize:8,lineHeight:12,marginTop:8},
 header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backGlyph:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},settings:{color:'#bfcdf0',fontSize:12,fontWeight:'700',padding:8},
 intro:{paddingHorizontal:19,paddingTop:16,paddingBottom:8},heading:{color:C.text,fontSize:22,fontWeight:'700'},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:5},installedList:{paddingHorizontal:15,paddingVertical:8,gap:9,minHeight:105},installedCard:{width:170,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,padding:10},installedCardActive:{borderColor:'#6b9d86'},installedName:{color:C.text,fontSize:12,fontWeight:'700'},installedFile:{color:C.muted,fontSize:9,marginTop:5},installedSize:{color:'#8b8b95',fontSize:9,marginTop:4},loadButton:{backgroundColor:'#eee',paddingVertical:8,borderRadius:14,alignItems:'center',marginTop:9},loadButtonText:{color:'#111',fontWeight:'700',fontSize:10},loadedButton:{backgroundColor:'#243a30'},loadedButtonText:{color:'#c6f0d9'},noModels:{justifyContent:'center',paddingHorizontal:6},runtimeStatus:{color:'#aeb8c3',fontSize:10,paddingHorizontal:17,paddingBottom:5},
 pendingPanel:{marginHorizontal:16,marginBottom:10,padding:11,borderRadius:12,backgroundColor:'#202329',borderWidth:1,borderColor:'#39414c'},pendingTitle:{color:C.text,fontSize:12,fontWeight:'800',marginBottom:6},pendingRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6},pendingName:{color:'#e6e6eb',fontSize:10,fontWeight:'700'},pendingStatus:{color:C.muted,fontSize:9,marginTop:3},pendingCancel:{paddingHorizontal:12,paddingVertical:7,borderRadius:14,backgroundColor:'#383840'},pendingCancelText:{color:'#e4e4e8',fontSize:9,fontWeight:'700'},removeButton:{alignItems:'center',paddingVertical:6,marginTop:5},removeButtonText:{color:'#e5b1b1',fontSize:9,fontWeight:'700'},activeHint:{color:'#aab4c3',fontSize:9,textAlign:'center',marginTop:6},
 benchmarkCard:{marginHorizontal:16,marginBottom:12,padding:12,borderRadius:13,backgroundColor:'#202329',borderWidth:1,borderColor:'#39414c'},
 benchmarkTop:{flexDirection:'row',alignItems:'center',gap:10},benchmarkTitle:{color:C.text,fontSize:12,fontWeight:'800'},
 benchmarkSub:{color:C.muted,fontSize:10,lineHeight:15,marginTop:4},benchmarkButton:{backgroundColor:'#e9e9ee',paddingHorizontal:16,paddingVertical:9,borderRadius:18},benchmarkButtonText:{color:'#111',fontSize:11,fontWeight:'800'},
 benchmarkMetrics:{flexDirection:'row',justifyContent:'space-between',marginTop:12},benchmarkMetric:{flex:1},benchmarkValue:{color:'#f2f2f5',fontSize:19,fontWeight:'800'},benchmarkLabel:{color:'#a8a8b1',fontSize:9,marginTop:3},
 device:{marginHorizontal:16,backgroundColor:'#20262a',borderRadius:12,padding:11,marginBottom:12},deviceTitle:{color:'#e4e9ef',fontSize:12,fontWeight:'700'},deviceInfo:{color:'#aeb8c3',fontSize:10,marginTop:4},searchBox:{marginHorizontal:16,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,paddingLeft:13,paddingRight:6,flexDirection:'row',alignItems:'center'},search:{flex:1,color:C.text,fontSize:13,paddingVertical:12},searchButton:{backgroundColor:'#eee',borderRadius:12,paddingHorizontal:15,paddingVertical:9},searchButtonText:{color:'#111',fontWeight:'700',fontSize:11},
 progress:{flexDirection:'row',gap:9,alignItems:'center',paddingHorizontal:18,paddingVertical:10},progressText:{color:C.muted,fontSize:11},progressTrack:{height:3,backgroundColor:'#35353c',marginHorizontal:16,borderRadius:2},progressFill:{height:3,backgroundColor:'#aab9d8',borderRadius:2},list:{padding:15,gap:9,paddingBottom:10},card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13},modelName:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.muted,fontSize:10,marginTop:5},choose:{color:'#b9c9e8',fontSize:11,fontWeight:'700',marginTop:10},fileRow:{flexDirection:'row',alignItems:'center',gap:9,borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},fileName:{color:'#e1e1e8',fontSize:10,fontWeight:'600'},fileSize:{color:C.muted,fontSize:10,marginTop:3},install:{backgroundColor:'#eee',borderRadius:15,paddingHorizontal:13,paddingVertical:8},installText:{color:'#111',fontSize:10,fontWeight:'700'},emptyWrap:{padding:24,alignItems:'center'},empty:{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'},note:{color:'#73737d',fontSize:9,lineHeight:14,paddingHorizontal:18,paddingBottom:9},
});
