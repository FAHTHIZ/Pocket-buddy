import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,FlatList,Pressable,StyleSheet,Text,TextInput,View}from'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import{downloadModel,getDeviceProfile,getModelFiles,searchHuggingFaceModels,type HubFile,type HubModel}from'../services/modelLibrary';
import{loadLocalModel}from'../services/llm';
import type{DeviceProfile}from'../types';

const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void;onOpenSettings:()=>void;onLoaded:(name:string,uri:string)=>void};
function bytesLabel(value?:number):string{return value?(value/1024/1024/1024).toFixed(2)+' GB':'Size unknown';}
export default function ModelsScreen({onBack,onOpenSettings,onLoaded}:Props){
 const[query,setQuery]=useState('Qwen Instruct GGUF'),[models,setModels]=useState<HubModel[]>([]),[files,setFiles]=useState<Record<string,HubFile[]>>({});
 const[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[device,setDevice]=useState<DeviceProfile|null>(null),[downloading,setDownloading]=useState('');
 useEffect(()=>{getDeviceProfile().then(setDevice).catch(()=>{});},[]);
 const search=async()=>{try{setBusy(true);setModels(await searchHuggingFaceModels(query));}catch(e){Alert.alert('Search failed',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const showFiles=async(id:string)=>{if(files[id]){setSelected(selected===id?'':id);return;}try{setBusy(true);const items=await getModelFiles(id);setFiles(old=>({...old,[id]:items}));setSelected(id);}catch(e){Alert.alert('Model files unavailable',e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const install=async(modelId:string,file:HubFile)=>{
  const free=device?.availableStorageMb||0,need=file.size?file.size/1048576:0,ram=device?.availableRamMb||0;
  const warnings:string[]=[];
  if(need&&free&&need*1.15>free)warnings.push('The download may exceed available device storage.');
  if(need&&ram&&need*1.35>ram)warnings.push('This model file is larger than the currently available RAM estimate. It may fail to load or make the phone unresponsive.');
  const start=async()=>{
   try{setBusy(true);setDownloading(file.name);setProgress(0);
    const uri=await downloadModel(modelId,file.name,setProgress);
    await AsyncStorage.setItem('pocket-buddy.local-model-uri',uri);
    await AsyncStorage.setItem('pocket-buddy.active-model',modelId.split('/').pop()||'Local model');
    await loadLocalModel(uri);
    onLoaded(modelId.split('/').pop()||'Local model',uri);
   }catch(e){Alert.alert('Could not install model',e instanceof Error?e.message:String(e));}
   finally{setBusy(false);setDownloading('');}
  };
  if(warnings.length)Alert.alert('Check device compatibility',warnings.join('\n\n'),[{text:'Cancel',style:'cancel'},{text:'Try anyway',onPress:start}]);
  else Alert.alert('Download model?',modelId+'\n'+file.name+'\n'+bytesLabel(file.size),[{text:'Cancel',style:'cancel'},{text:'Download',onPress:start}]);
 };
 const renderFile=(model:HubModel,file:HubFile)=><View key={file.name} style={s.fileRow}>
  <View style={{flex:1}}><Text style={s.fileName}>{file.name}</Text><Text style={s.fileSize}>{bytesLabel(file.size)}</Text></View>
  <Pressable disabled={busy} style={s.install} onPress={()=>install(model.id,file)}><Text style={s.installText}>Install</Text></Pressable>
 </View>;
 return <View style={s.root}>
  <View style={s.header}><Pressable style={s.back} onPress={onBack}><Text style={s.backGlyph}>‹</Text></Pressable><Text style={s.title}>Models</Text><Pressable onPress={onOpenSettings}><Text style={s.settings}>API</Text></Pressable></View>
  <View style={s.intro}><Text style={s.heading}>Choose your model</Text><Text style={s.sub}>Browse GGUF models from Hugging Face. Download once, then chat locally on your phone.</Text></View>
  {device?<View style={s.device}><Text style={s.deviceTitle}>{device.manufacturer} {device.model}</Text><Text style={s.deviceInfo}>{Math.round(device.availableRamMb)} MB free RAM · {Math.round(device.availableStorageMb)} MB free storage · Thermal status {device.thermalStatus<0?'not available':device.thermalStatus}</Text></View>:null}
  <View style={s.searchBox}><TextInput value={query} onChangeText={setQuery} placeholder="Search GGUF models…" placeholderTextColor="#777" style={s.search}/><Pressable onPress={search} style={s.searchButton}><Text style={s.searchButtonText}>Search</Text></Pressable></View>
  {busy?<View style={s.progress}><ActivityIndicator color="#eee"/><Text style={s.sub}>{downloading?'Downloading '+downloading:'Working…'} {progress>0?progress+'%':''}</Text></View>:null}
  {downloading?<View style={s.progressTrack}><View style={[s.progressFill,{width:progress+'%'}]}/></View>:null}
  <FlatList data={models} keyExtractor={item=>item.id} contentContainerStyle={s.list}
   renderItem={({item})=><View style={s.card}>
    <Pressable onPress={()=>showFiles(item.id)}><Text style={s.modelName}>{item.id}</Text><Text style={s.meta}>{item.downloads.toLocaleString()} downloads · {item.likes.toLocaleString()} likes · GGUF</Text><Text style={s.choose}>{selected===item.id?'Hide files ↑':'Choose a quantization ↓'}</Text></Pressable>
    {selected===item.id?(files[item.id]||[]).length?(files[item.id]||[]).map(file=>renderFile(item,file)):<Text style={s.empty}>No GGUF files were found in this repository.</Text>:null}
   </View>}
   ListEmptyComponent={<View style={s.emptyWrap}><Text style={s.empty}>Search Hugging Face to find compatible GGUF models.</Text></View>}/>
  <Text style={s.note}>Model weights have their own licenses and hardware requirements. Check the model card before downloading. Quantized models can still exceed the available RAM after the model is loaded and the context cache is allocated.</Text>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},
 back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backGlyph:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},settings:{color:'#bfcdf0',fontSize:12,fontWeight:'700',padding:8},
 intro:{paddingHorizontal:19,paddingTop:20,paddingBottom:11},heading:{color:C.text,fontSize:22,fontWeight:'700'},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:5},
 device:{marginHorizontal:16,backgroundColor:'#20262a',borderRadius:12,padding:11,marginBottom:12},deviceTitle:{color:'#e4e9ef',fontSize:12,fontWeight:'700'},deviceInfo:{color:'#aeb8c3',fontSize:10,marginTop:4},
 searchBox:{marginHorizontal:16,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,paddingLeft:13,paddingRight:6,flexDirection:'row',alignItems:'center'},
 search:{flex:1,color:C.text,fontSize:13,paddingVertical:12},searchButton:{backgroundColor:'#eee',borderRadius:12,paddingHorizontal:15,paddingVertical:9},searchButtonText:{color:'#111',fontWeight:'700',fontSize:11},
 progress:{flexDirection:'row',gap:9,alignItems:'center',paddingHorizontal:18,paddingVertical:10},progressTrack:{height:3,backgroundColor:'#35353c',marginHorizontal:16,borderRadius:2},progressFill:{height:3,backgroundColor:'#aab9d8',borderRadius:2},
 list:{padding:15,gap:9,paddingBottom:10},card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13},
 modelName:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.muted,fontSize:10,marginTop:5},choose:{color:'#b9c9e8',fontSize:11,fontWeight:'700',marginTop:10},
 fileRow:{flexDirection:'row',alignItems:'center',gap:9,borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},
 fileName:{color:'#e1e1e8',fontSize:10,fontWeight:'600'},fileSize:{color:C.muted,fontSize:10,marginTop:3},
 install:{backgroundColor:'#eee',borderRadius:15,paddingHorizontal:13,paddingVertical:8},installText:{color:'#111',fontSize:10,fontWeight:'700'},
 emptyWrap:{padding:24,alignItems:'center'},empty:{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'},note:{color:'#73737d',fontSize:9,lineHeight:14,paddingHorizontal:18,paddingBottom:9},
});
