import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,FlatList,Pressable,ScrollView,StyleSheet,Text,TextInput,View}from'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import{downloadModel,getDeviceProfile,getModelFiles,searchHuggingFaceModels,listInstalledModels,registerInstalledModel,getModelBenchmark,saveModelBenchmark,deleteInstalledModelFile,refreshPendingModelDownloads,cancelModelDownload,type HubFile,type HubModel}from'../services/modelLibrary';
import{getLocalRuntimeStatus,loadLocalModel,runLocalBenchmark}from'../services/llm';
import type{DeviceProfile,LocalBenchmark,LocalModelRecord,PendingModelDownloadState}from'../types';
const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void;onOpenSettings:()=>void;onLoaded:(name:string,uri:string)=>void};
function bytesLabel(value?:number):string{return value?(value/1024/1024/1024).toFixed(2)+' GB':'Size unknown';}
type QuickPick={id:string;name:string;repo:string;fileName:string;sizeLabel:string;description:string;fitLabel:string;minRamMb:number};
const QUICK_PICKS:QuickPick[]=[
 {id:'qwen3-0.6b',name:'Qwen3 0.6B Instruct',repo:'tensorblock/Qwen_Qwen3-0.6B-GGUF',fileName:'Qwen3-0.6B-Q4_K_M.gguf',sizeLabel:'~484 MB',description:'A sensible first model for older Android phones. Good for short chats, summaries and everyday questions.',fitLabel:'Best starting point',minRamMb:3500},
 {id:'smollm2-360m',name:'SmolLM2 360M Instruct',repo:'bartowski/SmolLM2-360M-Instruct-GGUF',fileName:'SmolLM2-360M-Instruct-Q4_K_M.gguf',sizeLabel:'~271 MB',description:'The lightest download here. Choose this when keeping memory use and download size low matters most.',fitLabel:'Lightweight option',minRamMb:2500},
 {id:'qwen3-1.7b',name:'Qwen3 1.7B Instruct',repo:'tensorblock/Qwen_Qwen3-1.7B-GGUF',fileName:'Qwen3-1.7B-Q4_K_M.gguf',sizeLabel:'~1.28 GB',description:'A more capable but heavier option. Only shown on devices with about 6 GB RAM; it may run slowly or need a smaller context.',fitLabel:'For 6 GB devices · heavier',minRamMb:5120}
];
export default function ModelsScreen({onBack,onOpenSettings,onLoaded}:Props){
 const[query,setQuery]=useState(''),[models,setModels]=useState<HubModel[]>([]),[files,setFiles]=useState<Record<string,HubFile[]>>({});
 const[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[device,setDevice]=useState<DeviceProfile|null>(null),[downloading,setDownloading]=useState('');
 const[installed,setInstalled]=useState<LocalModelRecord[]>([]),[activePath,setActivePath]=useState(''),[runtimeStatus,setRuntimeStatus]=useState(''),[benchmark,setBenchmark]=useState<LocalBenchmark|null>(null),[benchmarkBusy,setBenchmarkBusy]=useState(false),[pendingDownloads,setPendingDownloads]=useState<PendingModelDownloadState[]>([]),[quickLoading,setQuickLoading]=useState('');
 const refreshLibrary=async()=>{const [next,items]=await Promise.all([listInstalledModels(),refreshPendingModelDownloads()]);setInstalled(next);setPendingDownloads(items);};
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
  try{setBusy(true);await cancelModelDownload(id);await refreshLibrary();}
  catch(error){Alert.alert('Could not cancel download',error instanceof Error?error.message:String(error));}
  finally{setBusy(false);}
 };
 const search=async()=>{try{setBusy(true);setModels(await searchHuggingFaceModels(query));}catch(e){Alert.alert('Search failed',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const showFiles=async(id:string)=>{if(files[id]){setSelected(selected===id?'':id);return;}try{setBusy(true);const items=await getModelFiles(id);setFiles(old=>({...old,[id]:items}));setSelected(id);}catch(e){Alert.alert('Model files unavailable',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const activate=async(item:LocalModelRecord)=>{try{setBusy(true);await loadLocalModel(item.path);await AsyncStorage.setItem('pocket-buddy.local-model-uri',item.path);await AsyncStorage.setItem('pocket-buddy.active-model',item.name);setActivePath(item.path);setRuntimeStatus(getLocalRuntimeStatus());onLoaded(item.name,item.path);}catch(error){Alert.alert('Could not load model',error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 const install=async(modelId:string,file:HubFile,quickStart=false,displayName?:string)=>{
  const free=device?.availableStorageMb||0,need=file.size?file.size/1048576:0,ram=device?.availableRamMb||0,warnings:string[]=[];
  if(need&&free&&need*1.15>free)warnings.push('The download may exceed available device storage.');
  const estimatedRuntimeMb=need*1.18+384;
  // GGUF weights and inference buffers are native allocations; Android's Java memoryClass is not a useful cap for them.
  const safeRamBudget=device?Math.max(0,(device.availableRamMb||0)*0.68):0;
  if(need&&ram&&estimatedRuntimeMb>safeRamBudget)warnings.push('Rough fit estimate: this model may exceed the memory currently available to the phone after runtime and context overhead. Close other apps or choose a smaller model/context. This is a heuristic, not a guarantee.');
  const start=async()=>{try{setBusy(true);setDownloading(file.name);setProgress(0);const uri=await downloadModel(modelId,file.name,setProgress,undefined,file.size),modelName=displayName||modelId.split('/').pop()||'Local model';
   const record:LocalModelRecord={id:modelId+'::'+file.name,modelId,name:modelName,fileName:file.name,path:uri,size:file.size,addedAt:Date.now()};
   setInstalled(await registerInstalledModel(record));await AsyncStorage.setItem('pocket-buddy.local-model-uri',uri);await AsyncStorage.setItem('pocket-buddy.active-model',modelName);
   await loadLocalModel(uri);setActivePath(uri);setRuntimeStatus(getLocalRuntimeStatus());onLoaded(modelName,uri);
  }catch(e){Alert.alert('Could not install model',e instanceof Error?e.message:String(e));}finally{setBusy(false);setDownloading('');}};
  if(warnings.length)Alert.alert('Check device compatibility',warnings.join('\n\n'),[{text:'Cancel',style:'cancel'},{text:'Try anyway',onPress:start}]);
  else if(quickStart)await start();
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
 const recommendedPicks=QUICK_PICKS.filter(item=>item.minRamMb<=(device?.totalRamMb||3500));
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
  <View style={s.intro}><Text style={s.heading}>Your models</Text><Text style={s.sub}>Pick a model sized for this phone. Download once, and Pocket Buddy loads it straight into your chat. No API key needed.</Text></View>
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
      <Pressable disabled={busy||!!pending} style={[s.quickButton,(busy||!!pending)&&s.quickButtonDisabled]} onPress={()=>existing?activate(existing):quickInstall(item)}><Text style={s.quickButtonText}>{buttonLabel}</Text></Pressable>
     </View>
    </View>;
   })}
   {!recommendedPicks.length?<Text style={s.quickSubtitle}>Reading your phone's memory profile…</Text>:null}
   {device?.totalRamMb?<Text style={s.quickFootnote}>Recommendations use detected physical RAM. The larger model is hidden on devices below 6 GB; actual speed and fit still depend on free memory, context size and thermal limits.</Text>:null}
  </View>
  {pendingDownloads.length?<View style={s.pendingPanel}>
   <Text style={s.pendingTitle}>Downloads</Text>
   {pendingDownloads.map(item=><View key={item.downloadId} style={s.pendingRow}>
    <View style={{flex:1}}><Text style={s.pendingName} numberOfLines={1}>{item.name} · {item.fileName}</Text><Text style={s.pendingStatus}>{item.status==='failed'?'Download failed':item.status==='unknown'?'Checking system download':item.status+' · '+Math.round(item.progress*100)+'%'}</Text></View>
    {item.status!=='failed'?<Pressable disabled={busy} style={s.pendingCancel} onPress={()=>cancelPending(item.downloadId)}><Text style={s.pendingCancelText}>Cancel</Text></Pressable>:null}
   </View>)}
  </View>:null}
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.installedList}>
   {installed.length?installed.map(item=><View key={item.id} style={[s.installedCard,item.path===activePath&&s.installedCardActive]}><Text style={s.installedName} numberOfLines={2}>{item.name}</Text><Text style={s.installedFile} numberOfLines={2}>{item.fileName}</Text><Text style={s.installedSize}>{bytesLabel(item.size)}</Text><Pressable disabled={busy} style={[s.loadButton,item.path===activePath&&s.loadedButton]} onPress={()=>activate(item)}><Text style={[s.loadButtonText,item.path===activePath&&s.loadedButtonText]}>{item.path===activePath?'Loaded':'Load model'}</Text></Pressable>
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
  {device?<View style={s.device}><Text style={s.deviceTitle}>{device.manufacturer} {device.model}</Text><Text style={s.deviceInfo}>{(device.totalRamMb/1024).toFixed(1)} GB RAM · {Math.round(device.availableRamMb)} MB free now · {Math.round(device.availableStorageMb)} MB free storage · {device.soc||'SoC unknown'}</Text></View>:null}
  <View style={s.searchBox}><TextInput value={query} onChangeText={setQuery} placeholder="Search any GGUF model…" placeholderTextColor="#777" style={s.search}/><Pressable onPress={search} style={s.searchButton}><Text style={s.searchButtonText}>Search</Text></Pressable></View>
  {busy?<View style={s.progress}><ActivityIndicator color="#eee"/><Text style={s.sub}>{downloading?'Downloading '+downloading:'Working…'} {progress>0?progress+'%':''}</Text></View>:null}
  {downloading?<View style={s.progressTrack}><View style={[s.progressFill,{width:progress+'%'}]}/></View>:null}
  <FlatList data={models} keyExtractor={item=>item.id} contentContainerStyle={s.list} renderItem={({item})=><View style={s.card}><Pressable onPress={()=>showFiles(item.id)}><Text style={s.modelName}>{item.id}</Text><Text style={s.meta}>{item.downloads.toLocaleString()} downloads · {item.likes.toLocaleString()} likes · GGUF</Text><Text style={s.choose}>{selected===item.id?'Hide files ↑':'Choose a quantization ↓'}</Text></Pressable>{selected===item.id?(files[item.id]||[]).length?(files[item.id]||[]).map(file=>renderFile(item,file)):<Text style={s.empty}>No GGUF files were found in this repository.</Text>:null}</View>} ListEmptyComponent={<View style={s.emptyWrap}><Text style={s.empty}>Search Hugging Face to browse compatible GGUF models.</Text></View>}/>
  <Text style={s.note}>Check each model card and license before downloading. File size is only a rough fit indicator: runtime memory also depends on context length, architecture and quantization.</Text>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},
 quickSection:{marginHorizontal:16,marginTop:9,marginBottom:5,padding:12,borderRadius:16,backgroundColor:'#17191e',borderWidth:1,borderColor:'#303640'},
 quickHeading:{flexDirection:'row',alignItems:'center',marginBottom:9},quickTitle:{color:C.text,fontSize:13,fontWeight:'800'},quickSubtitle:{color:C.muted,fontSize:10,lineHeight:15,marginTop:3},quickSpark:{color:'#c6d7ff',fontSize:19,paddingHorizontal:5},
 quickCard:{backgroundColor:'#202329',borderWidth:1,borderColor:'#383f49',borderRadius:12,padding:11,marginTop:8},
 quickCardTop:{flexDirection:'row',alignItems:'flex-start',gap:8},quickName:{color:'#f1f2f6',fontSize:12,fontWeight:'800'},quickMeta:{color:'#a8b4c4',fontSize:9,marginTop:4},
 quickTag:{backgroundColor:'#303640',borderRadius:10,paddingHorizontal:8,paddingVertical:5},quickTagText:{color:'#d1dbee',fontSize:8,fontWeight:'700'},
 quickDescription:{color:'#b7bdc8',fontSize:10,lineHeight:15,marginTop:8},quickCardBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:9},
 quickOffline:{color:'#99bca9',fontSize:8,flex:1},quickButton:{backgroundColor:'#e9edf5',borderRadius:15,paddingHorizontal:13,paddingVertical:9},quickButtonDisabled:{opacity:0.55},quickButtonText:{color:'#13171d',fontSize:9,fontWeight:'800'},
 quickFootnote:{color:'#777f8b',fontSize:8,lineHeight:12,marginTop:8},
 header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backGlyph:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},settings:{color:'#bfcdf0',fontSize:12,fontWeight:'700',padding:8},
 intro:{paddingHorizontal:19,paddingTop:16,paddingBottom:8},heading:{color:C.text,fontSize:22,fontWeight:'700'},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:5},installedList:{paddingHorizontal:15,paddingVertical:8,gap:9,minHeight:105},installedCard:{width:170,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,padding:10},installedCardActive:{borderColor:'#6b9d86'},installedName:{color:C.text,fontSize:12,fontWeight:'700'},installedFile:{color:C.muted,fontSize:9,marginTop:5},installedSize:{color:'#8b8b95',fontSize:9,marginTop:4},loadButton:{backgroundColor:'#eee',paddingVertical:8,borderRadius:14,alignItems:'center',marginTop:9},loadButtonText:{color:'#111',fontWeight:'700',fontSize:10},loadedButton:{backgroundColor:'#243a30'},loadedButtonText:{color:'#c6f0d9'},noModels:{justifyContent:'center',paddingHorizontal:6},runtimeStatus:{color:'#aeb8c3',fontSize:10,paddingHorizontal:17,paddingBottom:5},
 pendingPanel:{marginHorizontal:16,marginBottom:10,padding:11,borderRadius:12,backgroundColor:'#202329',borderWidth:1,borderColor:'#39414c'},pendingTitle:{color:C.text,fontSize:12,fontWeight:'800',marginBottom:6},pendingRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6},pendingName:{color:'#e6e6eb',fontSize:10,fontWeight:'700'},pendingStatus:{color:C.muted,fontSize:9,marginTop:3},pendingCancel:{paddingHorizontal:12,paddingVertical:7,borderRadius:14,backgroundColor:'#383840'},pendingCancelText:{color:'#e4e4e8',fontSize:9,fontWeight:'700'},removeButton:{alignItems:'center',paddingVertical:6,marginTop:5},removeButtonText:{color:'#e5b1b1',fontSize:9,fontWeight:'700'},activeHint:{color:'#aab4c3',fontSize:9,textAlign:'center',marginTop:6},
 benchmarkCard:{marginHorizontal:16,marginBottom:12,padding:12,borderRadius:13,backgroundColor:'#202329',borderWidth:1,borderColor:'#39414c'},
 benchmarkTop:{flexDirection:'row',alignItems:'center',gap:10},benchmarkTitle:{color:C.text,fontSize:12,fontWeight:'800'},
 benchmarkSub:{color:C.muted,fontSize:10,lineHeight:15,marginTop:4},benchmarkButton:{backgroundColor:'#e9e9ee',paddingHorizontal:16,paddingVertical:9,borderRadius:18},benchmarkButtonText:{color:'#111',fontSize:11,fontWeight:'800'},
 benchmarkMetrics:{flexDirection:'row',justifyContent:'space-between',marginTop:12},benchmarkMetric:{flex:1},benchmarkValue:{color:'#f2f2f5',fontSize:19,fontWeight:'800'},benchmarkLabel:{color:'#a8a8b1',fontSize:9,marginTop:3},
 device:{marginHorizontal:16,backgroundColor:'#20262a',borderRadius:12,padding:11,marginBottom:12},deviceTitle:{color:'#e4e9ef',fontSize:12,fontWeight:'700'},deviceInfo:{color:'#aeb8c3',fontSize:10,marginTop:4},searchBox:{marginHorizontal:16,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,paddingLeft:13,paddingRight:6,flexDirection:'row',alignItems:'center'},search:{flex:1,color:C.text,fontSize:13,paddingVertical:12},searchButton:{backgroundColor:'#eee',borderRadius:12,paddingHorizontal:15,paddingVertical:9},searchButtonText:{color:'#111',fontWeight:'700',fontSize:11},
 progress:{flexDirection:'row',gap:9,alignItems:'center',paddingHorizontal:18,paddingVertical:10},progressTrack:{height:3,backgroundColor:'#35353c',marginHorizontal:16,borderRadius:2},progressFill:{height:3,backgroundColor:'#aab9d8',borderRadius:2},list:{padding:15,gap:9,paddingBottom:10},card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13},modelName:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.muted,fontSize:10,marginTop:5},choose:{color:'#b9c9e8',fontSize:11,fontWeight:'700',marginTop:10},fileRow:{flexDirection:'row',alignItems:'center',gap:9,borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},fileName:{color:'#e1e1e8',fontSize:10,fontWeight:'600'},fileSize:{color:C.muted,fontSize:10,marginTop:3},install:{backgroundColor:'#eee',borderRadius:15,paddingHorizontal:13,paddingVertical:8},installText:{color:'#111',fontSize:10,fontWeight:'700'},emptyWrap:{padding:24,alignItems:'center'},empty:{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'},note:{color:'#73737d',fontSize:9,lineHeight:14,paddingHorizontal:18,paddingBottom:9},
});
