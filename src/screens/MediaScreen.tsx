import React,{useCallback,useEffect,useState}from'react';
import{Alert,Linking,Pressable,ScrollView,StyleSheet,Text,View}from'react-native';
import type{GenerationJob}from'../types';
import{cancelMediaJob,readMediaJobs,refreshMediaJob}from'../services/media';
import{loadConfig}from'../services/storage';

const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void};
type Output={filename:string;subfolder:string;type:string};
export default function MediaScreen({onBack}:Props){
 const[jobs,setJobs]=useState<GenerationJob[]>([]),[busy,setBusy]=useState(false),[base,setBase]=useState('');
 const reload=useCallback(async()=>{
  const items=await readMediaJobs();const config=await loadConfig();setBase(config.comfyUrl.replace(/\/+$/,''));
  const active=items.filter(item=>item.status==='queued'||item.status==='running');
  if(active.length){await Promise.all(active.map(item=>refreshMediaJob(item.promptId).catch(()=>'')));}
  setJobs(await readMediaJobs());
 },[]);
 useEffect(()=>{
  reload().catch(()=>{});
  const timer=setInterval(()=>reload().catch(()=>{}),8000);
  return()=>clearInterval(timer);
 },[reload]);
 const refresh=async(job:GenerationJob)=>{
  try{setBusy(true);await refreshMediaJob(job.promptId);await reload();}
  catch(error){Alert.alert('Could not refresh',error instanceof Error?error.message:String(error));}
  finally{setBusy(false);}
 };
 const cancel=async(job:GenerationJob)=>{
  try{setBusy(true);await cancelMediaJob(job.promptId);await reload();}
  catch(error){Alert.alert('Could not cancel',error instanceof Error?error.message:String(error));}
  finally{setBusy(false);}
 };
 const openOutput=(raw:string)=>{
  if(!base)return;
  let file:Output;
  try{file=JSON.parse(raw);}catch{file={filename:raw,subfolder:'',type:'output'};}
  const url=base+'/view?filename='+encodeURIComponent(file.filename)+'&subfolder='+encodeURIComponent(file.subfolder)+'&type='+encodeURIComponent(file.type);
  Linking.openURL(url).catch(()=>Alert.alert('Could not open output','Check that your ComfyUI server is reachable.'));
 };
 return <View style={s.root}>
  <View style={s.header}><Pressable style={s.back} onPress={onBack}><Text style={s.backText}>‹</Text></Pressable><Text style={s.title}>Media library</Text><Pressable onPress={()=>reload()}><Text style={s.refresh}>Refresh</Text></Pressable></View>
  <View style={s.intro}><Text style={s.heading}>Your creations</Text><Text style={s.sub}>Image and video jobs submitted from your conversations appear here. Status refreshes automatically while this screen is open.</Text></View>
  <ScrollView contentContainerStyle={s.content}>
   {!jobs.length?<View style={s.empty}><Text style={s.emptyIcon}>▧</Text><Text style={s.emptyTitle}>Nothing here yet</Text><Text style={s.sub}>Ask Pocket Buddy to create an image or video after configuring a ComfyUI workflow in Settings.</Text></View>:jobs.map(job=><View key={job.id} style={s.card}>
    <View style={s.cardTop}><View style={s.kind}><Text style={s.kindIcon}>{job.kind==='image'?'▧':'▶'}</Text></View><View style={{flex:1}}><Text style={s.kindTitle}>{job.kind==='image'?'Image generation':'Video generation'}</Text><Text style={s.meta}>{new Date(job.createdAt).toLocaleString()}</Text></View><View style={[s.status,job.status==='complete'&&s.statusDone,job.status==='failed'&&s.statusFailed]}><Text style={s.statusText}>{job.status}</Text></View></View>
    <Text style={s.prompt}>{job.prompt}</Text><Text style={s.jobId}>ComfyUI ID · {job.promptId}</Text>
    {job.outputs.map((output,index)=><Pressable key={output+index} onPress={()=>openOutput(output)} style={s.output}><Text style={s.outputText} numberOfLines={1}>{(()=>{try{return(JSON.parse(output)as Output).filename;}catch{return output;}})()}</Text><Text style={s.open}>Open ›</Text></Pressable>)}
    <View style={s.actions}>
     {job.status!=='complete'&&job.status!=='cancelled'&&job.status!=='failed'?<Pressable style={s.actionButton} onPress={()=>refresh(job)} disabled={busy}><Text style={s.actionText}>Check status</Text></Pressable>:null}
     {['queued','running'].includes(job.status)?<Pressable style={s.cancelButton} onPress={()=>cancel(job)} disabled={busy}><Text style={s.cancelText}>Cancel job</Text></Pressable>:null}
    </View>
   </View>)}
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},
 back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},refresh:{color:'#bdcbed',fontSize:12,fontWeight:'700',padding:8},
 intro:{paddingHorizontal:19,paddingTop:19,paddingBottom:7},heading:{color:C.text,fontSize:22,fontWeight:'700'},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:6},
 content:{padding:15,gap:11,paddingBottom:28},empty:{alignItems:'center',paddingHorizontal:22,paddingVertical:70},emptyIcon:{color:'#92929d',fontSize:38},emptyTitle:{color:C.text,fontSize:17,fontWeight:'700',marginTop:12},
 card:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:15,padding:13},cardTop:{flexDirection:'row',alignItems:'center',gap:10},
 kind:{width:36,height:36,borderRadius:11,backgroundColor:'#303039',alignItems:'center',justifyContent:'center'},kindIcon:{color:'#eee',fontSize:18},
 kindTitle:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.muted,fontSize:10,marginTop:3},
 status:{backgroundColor:'#36363e',borderRadius:12,paddingHorizontal:9,paddingVertical:5},statusDone:{backgroundColor:'#17392c'},statusFailed:{backgroundColor:'#432525'},statusText:{color:'#d7d7de',fontSize:9,fontWeight:'700'},
 prompt:{color:'#dddde3',fontSize:12,lineHeight:18,marginTop:12},jobId:{color:'#777782',fontSize:9,marginTop:7},
 output:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#29292f',borderRadius:9,padding:9,marginTop:8},
 outputText:{color:'#c9c9d1',fontSize:10,flex:1},open:{color:'#b9c8e7',fontSize:10,fontWeight:'700',marginLeft:8},
 actions:{flexDirection:'row',gap:8,marginTop:11},actionButton:{backgroundColor:'#e9e9ed',paddingHorizontal:12,paddingVertical:8,borderRadius:16},actionText:{color:'#111',fontSize:10,fontWeight:'700'},
 cancelButton:{backgroundColor:'#3b2a2a',paddingHorizontal:12,paddingVertical:8,borderRadius:16},cancelText:{color:'#f1b1b1',fontSize:10,fontWeight:'700'},
});
