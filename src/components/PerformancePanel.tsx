import React,{useCallback,useEffect,useState}from'react';
import{ActivityIndicator,Alert,Pressable,StyleSheet,Text,View}from'react-native';
import AsyncStorage from'@react-native-async-storage/async-storage';
import type{AppConfig}from'../types';
import{saveConfig}from'../services/storage';
import{benchmarkThisPhone,buildPlan,getActivePlan,getLocalRuntimeStatus,loadLocalModel,moeEngineAvailable}from'../services/llm';
import{type BenchmarkReport,type HardwareProbe,type InferencePlan,type PerfProfile,describeDevice,formatReport,loadBenchmarkReports,measureStorage,probeHardware,recommendModels}from'../services/hardware';
import{copyToClipboard}from'../services/clipboard';

const PROFILES:{id:PerfProfile;label:string;hint:string}[]=[
 {id:'auto',label:'Automatic',hint:'Picks the profile from battery, charging and temperature, and re-checks while you chat.'},
 {id:'battery',label:'Battery Saver',hint:'Fewer threads, smaller context and memory budget. Cooler and longer battery life.'},
 {id:'balanced',label:'Balanced',hint:'Good speed while leaving plenty of RAM for other apps.'},
 {id:'max',label:'Maximum Performance',hint:'All fast cores, the largest safe context and memory budget. Android still keeps its reserve.'},
];

export default function PerformancePanel({config,patch}:{config:AppConfig;patch:(v:Partial<AppConfig>)=>void}){
 const[probe,setProbe]=useState<HardwareProbe|null>(null),[plan,setPlan]=useState<InferencePlan|null>(getActivePlan()),[status,setStatus]=useState(getLocalRuntimeStatus()),[busy,setBusy]=useState(''),[report,setReport]=useState<BenchmarkReport|null>(null),[moeOk,setMoeOk]=useState<boolean|null>(null),[showReasons,setShowReasons]=useState(false);
 const refresh=useCallback(async()=>{
  setProbe(await probeHardware(true));setMoeOk(await moeEngineAvailable());
  const active=getActivePlan();
  if(active)setPlan(active);
  else{const path=await AsyncStorage.getItem('pocket-buddy.local-model-uri');if(path){try{setPlan(await buildPlan(path,config));}catch{}}}
  setStatus(getLocalRuntimeStatus());
  const reports=await loadBenchmarkReports();if(reports[0])setReport(reports[0]);
 },[config]);
 useEffect(()=>{void refresh();},[]);// eslint-disable-line react-hooks/exhaustive-deps
 const apply=async()=>{
  const path=await AsyncStorage.getItem('pocket-buddy.local-model-uri');
  await saveConfig(config);
  if(!path){Alert.alert('Saved','Settings saved. They apply when you load a model.');return;}
  try{setBusy('Reloading model with the new plan…');await loadLocalModel(path,true,s=>setBusy(s));setPlan(getActivePlan());setStatus(getLocalRuntimeStatus());}
  catch(error){Alert.alert('Could not reload model',error instanceof Error?error.message:String(error));}
  finally{setBusy('');}
 };
 const bench=async()=>{
  try{await saveConfig(config);setBusy('Starting benchmark…');const r=await benchmarkThisPhone(s=>setBusy(s));setReport(r);setPlan(getActivePlan());setStatus(getLocalRuntimeStatus());}
  catch(error){Alert.alert('Benchmark failed',error instanceof Error?error.message:String(error));}
  finally{setBusy('');}
 };
 const storage=async()=>{
  const path=await AsyncStorage.getItem('pocket-buddy.local-model-uri');if(!path){Alert.alert('No model','Download a model first, then measure storage with it.');return;}
  try{setBusy('Reading the model file at 1, 2 and 4 lanes…');const r=await measureStorage(path);if(r)Alert.alert('Storage speed',`Sequential: ${r.sequentialMBps.toFixed(0)} MB/s\n`+r.random.map(x=>`Random 512 KB, ${x.lanes} lane${x.lanes>1?'s':''}: ${x.randomMBps.toFixed(0)} MB/s`).join('\n')+`\n\nMoE streaming will use ${r.bestLanes} read lane${r.bestLanes>1?'s':''}. ${r.note}`);}
  catch(error){Alert.alert('Storage test failed',error instanceof Error?error.message:String(error));}
  finally{setBusy('');}
 };
 const rec=probe?recommendModels(probe.memory.totalMb):null;
 return <View style={s.box}>
  <Text style={s.title}>Performance</Text>
  <View style={s.row}>{PROFILES.map(p=><Pressable key={p.id} onPress={()=>patch({perfProfile:p.id})} style={[s.chip,(config.perfProfile||'auto')===p.id&&s.chipOn]}><Text style={[s.chipText,(config.perfProfile||'auto')===p.id&&s.chipTextOn]}>{p.label}</Text></Pressable>)}</View>
  <Text style={s.help}>{PROFILES.find(p=>p.id===(config.perfProfile||'auto'))?.hint}</Text>
  <Text style={s.label}>MoE expert streaming</Text>
  <View style={s.row}>{(['auto','off'] as const).map(m=><Pressable key={m} onPress={()=>patch({moeMode:m})} style={[s.chip,(config.moeMode||'auto')===m&&s.chipOn]}><Text style={[s.chipText,(config.moeMode||'auto')===m&&s.chipTextOn]}>{m==='auto'?'Automatic':'Off'}</Text></Pressable>)}</View>
  <Text style={s.help}>{moeOk===false?'Not available on this phone (needs ARM64 and Android 10+). MoE models still run with the standard engine.':'Used only when the model file is a Mixture-of-Experts model that does not fit in the RAM budget. Dense models such as Qwen3.8 2B always use the standard engine.'}</Text>
  <Text style={s.label}>Context window</Text>
  <View style={s.row}>
   <Pressable onPress={()=>patch({autoContext:true})} style={[s.chip,config.autoContext!==false&&s.chipOn]}><Text style={[s.chipText,config.autoContext!==false&&s.chipTextOn]}>Auto</Text></Pressable>
   {[2048,4096,8192,16384].map(v=><Pressable key={v} onPress={()=>patch({autoContext:false,nCtx:v})} style={[s.chip,config.autoContext===false&&config.nCtx===v&&s.chipOn]}><Text style={[s.chipText,config.autoContext===false&&config.nCtx===v&&s.chipTextOn]}>{v/1024+'K'}</Text></Pressable>)}
  </View>
  <Text style={s.help}>Auto sizes the context and KV cache from free RAM and the model's own layout.</Text>

  <View style={s.card}><Text style={s.cardTitle}>This phone</Text><Text style={s.mono}>{probe?describeDevice(probe):'Reading hardware…'}</Text>{rec?<Text style={s.help}>{rec.note}{'\n'}Dense pick: {rec.dense}{rec.moe?'\nMoE pick: '+rec.moe:''}</Text>:null}</View>

  <View style={s.card}>
   <Text style={s.cardTitle}>{getActivePlan()?'Active plan':'Plan for your model'}</Text>
   {plan?<>
    <Text style={s.mono}>{`Engine: ${plan.engine==='moe-stream'?'MoE expert streaming':'llama.rn (standard)'}\nProfile: ${plan.profile}${plan.requestedProfile==='auto'?' (automatic)':''}\nThreads ${plan.nThreads} · context ${plan.nCtx} · KV ${plan.kvType} · batch ${plan.nBatch}/${plan.nUbatch}\nRAM budget ${plan.budgetMb} MB · Android reserve ${plan.reserveMb} MB${plan.moe?`\nExpert cache ${plan.moe.cacheMb} MB · ${plan.moe.ioLanes} read lanes`:''}${plan.architecture?`\nModel: ${plan.architecture.architecture} ${plan.architecture.isMoe?`MoE ${plan.architecture.expertUsedCount}/${plan.architecture.expertCount} experts`:'dense'}`:''}`}</Text>
    <Pressable onPress={()=>setShowReasons(v=>!v)}><Text style={s.link}>{showReasons?'Hide reasons':'Why these settings?'}</Text></Pressable>
    {showReasons?plan.reasons.map((r,i)=><Text key={i} style={s.help}>• {r}</Text>):null}
   </>:<Text style={s.help}>Load a model to see its plan.</Text>}
   {status?<Text style={s.help}>Runtime: {status}</Text>:null}
  </View>

  {busy?<View style={s.busy}><ActivityIndicator color="#9fc0ff" size="small"/><Text style={s.help}>{busy}</Text></View>:null}
  <Pressable style={s.btn} disabled={!!busy} onPress={apply}><Text style={s.btnText}>Save & reload model</Text></Pressable>
  <Pressable style={s.btn} disabled={!!busy} onPress={bench}><Text style={s.btnText}>Benchmark this phone (previous vs adaptive)</Text></Pressable>
  <Pressable style={s.btn} disabled={!!busy} onPress={storage}><Text style={s.btnText}>Measure storage speed</Text></Pressable>
  {report?<View style={s.card}>
   <Text style={s.cardTitle}>Last benchmark · {new Date(report.ranAt).toLocaleString()}</Text>
   {report.runs.map((r,i)=><Text key={i} style={s.mono}>{r.error?`${r.label}: failed – ${r.error}`:`${r.label}\n  load ${(r.loadMs/1000).toFixed(1)} s · first token ${(r.ttftMs/1000).toFixed(2)} s\n  prefill ${r.prefillTps.toFixed(1)} tok/s · decode ${r.decodeTps.toFixed(2)} tok/s\n  RAM ${Math.round(r.rssMb)} MB · ${r.threads||'default'} threads · ctx ${r.nCtx}`}</Text>)}
   {report.notes.map((n,i)=><Text key={'n'+i} style={s.help}>{n}</Text>)}
   <Pressable onPress={()=>copyToClipboard(formatReport(report)).then(()=>Alert.alert('Copied','Benchmark results copied.')).catch(e=>Alert.alert('Copy failed',String(e)))}><Text style={s.link}>Copy results</Text></Pressable>
  </View>:null}
 </View>;
}
const s=StyleSheet.create({
 box:{marginTop:16},title:{color:'#f4f4f5',fontSize:13,fontWeight:'800',marginBottom:8},label:{color:'#d1d1d8',fontSize:12,fontWeight:'700',marginTop:12,marginBottom:7},
 row:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{borderWidth:1,borderColor:'#34343b',backgroundColor:'#16161a',paddingHorizontal:12,paddingVertical:9,borderRadius:18},chipOn:{backgroundColor:'#e7e7eb',borderColor:'#e7e7eb'},chipText:{color:'#c5c5ce',fontSize:11,fontWeight:'700'},chipTextOn:{color:'#111'},
 help:{color:'#878791',fontSize:11,lineHeight:17,marginTop:6},card:{backgroundColor:'#16161a',borderRadius:12,padding:12,marginTop:12,borderWidth:1,borderColor:'#2c2c33'},cardTitle:{color:'#e4e4e7',fontSize:12,fontWeight:'800',marginBottom:6},
 mono:{color:'#cfd3dc',fontSize:11,lineHeight:17,fontFamily:'monospace',marginTop:4},link:{color:'#b9c9e8',fontSize:11,fontWeight:'700',marginTop:8},
 btn:{backgroundColor:'#303039',borderRadius:12,padding:13,alignItems:'center',marginTop:10},btnText:{color:'#e8e8ee',fontSize:12,fontWeight:'700'},busy:{flexDirection:'row',gap:8,alignItems:'center',marginTop:10},
});
