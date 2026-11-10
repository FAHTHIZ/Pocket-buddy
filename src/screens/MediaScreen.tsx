import React,{useCallback,useEffect,useRef,useState}from'react';
import{Alert,Dimensions,Image,Linking,Pressable,ScrollView,StyleSheet,Text,View}from'react-native';
import type{GenerationJob}from'../types';
import{attachmentsFromJob,cacheMediaJobOutputs,cancelMediaJob,deleteLocalMedia,playAudioAttachment,playVideoAttachment,readMediaJobs,refreshMediaJob,stopAudioPlayback}from'../services/media';
import{ImageViewer,saveWithFeedback,shareWithFeedback}from'../components/MediaViews';
import type{MessageAttachment}from'../types';
import{getComfyToken,loadConfig}from'../services/storage';

const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void};
type Output={filename:string;subfolder:string;type:string};
export default function MediaScreen({onBack}:Props){
 const[jobs,setJobs]=useState<GenerationJob[]>([]),[busy,setBusy]=useState(false),[base,setBase]=useState(''),[comfyToken,setComfyToken]=useState('');
 const reloadLock=useRef(false),mounted=useRef(true);
 const[filter,setFilter]=useState<'all'|'image'|'video'|'audio'>('all'),[viewer,setViewer]=useState<number|null>(null),[playing,setPlaying]=useState('');
 const reload=useCallback(async()=>{
  if(reloadLock.current)return;
  reloadLock.current=true;
  try{
   const items=await readMediaJobs();
   const [config,token]=await Promise.all([loadConfig(),getComfyToken()]);
   if(!mounted.current)return;
   setBase(config.comfyUrl.replace(/\/+$/,''));setComfyToken(token);
   const active=items.filter(item=>!attachmentsFromJob(item).length&&(item.status==='queued'||item.status==='running'));
   if(active.length)await Promise.all(active.map(item=>refreshMediaJob(item.promptId).catch(()=>'')));
   const latest=await readMediaJobs();
   const completed=latest.filter(item=>item.status==='complete'&&item.outputs.length>0&&!attachmentsFromJob(item).length);
   for(const job of completed)await cacheMediaJobOutputs(job).catch(()=>0);
   const refreshed=completed.length?await readMediaJobs():latest;
   if(mounted.current)setJobs(refreshed);
  }finally{reloadLock.current=false;}
 },[]);
 useEffect(()=>{
  mounted.current=true;
  reload().catch(()=>{});
  const timer=setInterval(()=>reload().catch(()=>{}),8000);
  return()=>{mounted.current=false;clearInterval(timer);};
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
 const parseOutput=(raw:string):Output=>{
  try{return JSON.parse(raw) as Output;}catch{return{filename:raw,subfolder:'',type:'output'};}
 };
 const outputUrl=(raw:string)=>{
  if(!base)return '';
  const file=parseOutput(raw);
  return base+'/view?filename='+encodeURIComponent(file.filename)+'&subfolder='+encodeURIComponent(file.subfolder)+'&type='+encodeURIComponent(file.type);
 };
 const openOutput=(raw:string)=>{
  const url=outputUrl(raw);if(!url)return;
  if(comfyToken){
   Alert.alert('Protected ComfyUI output','Pocket Buddy can use your saved token for in-app image previews. Android browser links do not receive that token, so opening protected video or audio files in another app is not supported yet.');
   return;
  }
  Linking.openURL(url).catch(()=>Alert.alert('Could not open output','Check that your ComfyUI server is reachable.'));
 };
 const local=jobs.flatMap(job=>attachmentsFromJob(job).map(item=>({job,item}))).filter(entry=>filter==='all'||entry.job.kind===filter);
 const remote=jobs.filter(job=>!attachmentsFromJob(job).length);
 const images=local.filter(entry=>entry.job.kind==='image').map(entry=>entry.item);
 const tile=(Dimensions.get('window').width-30-12)/3;
 const remove=(job:GenerationJob,item:MessageAttachment)=>Alert.alert('Delete this file?','It will be removed from Pocket Buddy. Other files from the same batch will stay. Copies saved to your gallery stay.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{await deleteLocalMedia(job,item).catch(()=>{});await reload();}}]);
 const open=(job:GenerationJob,item:MessageAttachment)=>{
  if(job.kind==='image'){setViewer(images.findIndex(image=>image.id===item.id));return;}
  if(job.kind==='video'){playVideoAttachment(item).catch(error=>Alert.alert('Could not play',String(error)));return;}
  if(playing===item.id){stopAudioPlayback().catch(()=>{});setPlaying('');return;}
  setPlaying(item.id);playAudioAttachment(item).catch(error=>Alert.alert('Could not play',String(error))).finally(()=>setPlaying(old=>old===item.id?'':old));
 };
 const actions=(job:GenerationJob,item:MessageAttachment)=>Alert.alert(job.kind==='image'?'Image':job.kind==='video'?'Video':'Audio',job.prompt.slice(0,300),[{text:'Save to gallery',onPress:()=>saveWithFeedback(item)},{text:'Share',onPress:()=>shareWithFeedback(item)},{text:'Delete',style:'destructive',onPress:()=>remove(job,item)},{text:'Close',style:'cancel'}]);
 return <View style={s.root}>
  <View style={s.header}><Pressable style={s.back} onPress={onBack}><Text style={s.backText}>‹</Text></Pressable><Text style={s.title}>Media library</Text><Pressable onPress={()=>reload()}><Text style={s.refresh}>Refresh</Text></Pressable></View>
  <ScrollView contentContainerStyle={s.content}>
   <Text style={s.heading}>Your creations</Text><Text style={s.sub}>Everything you generate is kept here on your phone. Tap to view or play; long-press to save, share or delete.</Text>
   <View style={s.filters}>{(['all','image','video','audio'] as const).map(value=><Pressable key={value} onPress={()=>setFilter(value)} style={[s.filter,filter===value&&s.filterActive]}><Text style={[s.filterText,filter===value&&s.filterTextActive]}>{value==='all'?'All':value==='image'?'Images':value==='video'?'Videos':'Audio'}</Text></Pressable>)}</View>
   {!local.length&&!remote.length?<View style={s.empty}><Text style={s.emptyIcon}>▧</Text><Text style={s.emptyTitle}>Nothing here yet</Text><Text style={s.sub}>In chat, tap ＋ → Create images, or type “create 4 images of a dragon over Dhaka”.</Text></View>:null}
   <View style={s.grid}>
    {local.map(({job,item})=><Pressable key={job.id} onPress={()=>open(job,item)} onLongPress={()=>actions(job,item)} style={[s.tile,{width:tile,height:tile}]}>
     {job.kind==='image'?<Image source={{uri:item.uri}} style={s.tileImage}/>:job.kind==='video'?<>{item.thumbnail?<Image source={{uri:item.thumbnail}} style={s.tileImage}/>:null}<View style={s.tileBadge}><Text style={s.tileBadgeText}>▶</Text></View></>:<View style={s.audioTile}><Text style={s.audioGlyph}>{playing===item.id?'■':'♫'}</Text><Text style={s.audioText} numberOfLines={3}>{job.prompt}</Text></View>}
    </Pressable>)}
   </View>
   {remote.length?<Text style={[s.heading,{fontSize:15,marginTop:18}]}>ComfyUI jobs</Text>:null}
   {remote.map(job=><View key={job.id} style={s.card}>
    <View style={s.cardTop}><View style={s.kind}><Text style={s.kindIcon}>{job.kind==='image'?'▧':job.kind==='video'?'▶':'♫'}</Text></View><View style={{flex:1}}><Text style={s.kindTitle}>{job.kind==='image'?'Image generation':job.kind==='video'?'Video generation':'Audio generation'}</Text><Text style={s.meta}>{new Date(job.createdAt).toLocaleString()}</Text></View><View style={[s.status,job.status==='complete'&&s.statusDone,job.status==='failed'&&s.statusFailed]}><Text style={s.statusText}>{job.status}</Text></View></View>
    <Text style={s.prompt}>{job.prompt}</Text><Text style={s.jobId}>ComfyUI ID · {job.promptId}</Text>
    {job.outputs.map((output,index)=>{
     const file=parseOutput(output),url=outputUrl(output);
     return <View key={output+index}>
      {job.kind==='image'&&url?<Pressable onPress={()=>openOutput(output)} style={s.previewWrap}>
       <Image source={{uri:url,headers:comfyToken?{Authorization:'Bearer '+comfyToken}:undefined}} style={s.preview} resizeMode="cover"/>
      </Pressable>:null}
      <Pressable onPress={()=>openOutput(output)} style={s.output}>
       <Text style={s.outputText} numberOfLines={1}>{file.filename}</Text><Text style={s.open}>Open ›</Text>
      </Pressable>
     </View>;
    })}
    <View style={s.actions}>
     {job.status!=='complete'&&job.status!=='cancelled'&&job.status!=='failed'?<Pressable style={s.actionButton} onPress={()=>refresh(job)} disabled={busy}><Text style={s.actionText}>Check status</Text></Pressable>:null}
     {job.status==='queued'?<Pressable style={s.cancelButton} onPress={()=>cancel(job)} disabled={busy}><Text style={s.cancelText}>Cancel queued job</Text></Pressable>:null}
    </View>
   </View>)}
  </ScrollView>
  {viewer!==null&&viewer>=0?<ImageViewer items={images} start={viewer} onClose={()=>setViewer(null)}/>:null}
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},
 back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},refresh:{color:'#bdcbed',fontSize:12,fontWeight:'700',padding:8},
 intro:{paddingHorizontal:19,paddingTop:19,paddingBottom:7},heading:{color:C.text,fontSize:22,fontWeight:'700'},sub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:6},
 content:{padding:15,gap:11,paddingBottom:28},filters:{flexDirection:'row',gap:7,marginTop:4},filter:{paddingHorizontal:13,paddingVertical:7,borderRadius:15,borderWidth:1,borderColor:C.line},filterActive:{backgroundColor:'#e9edf5',borderColor:'#e9edf5'},filterText:{color:'#ccc',fontSize:11,fontWeight:'700'},filterTextActive:{color:'#111'},
 grid:{flexDirection:'row',flexWrap:'wrap',gap:6},tile:{borderRadius:10,overflow:'hidden',backgroundColor:'#1e1e23',alignItems:'center',justifyContent:'center'},tileImage:{position:'absolute',width:'100%',height:'100%'},tileBadge:{width:34,height:34,borderRadius:17,backgroundColor:'#000a',alignItems:'center',justifyContent:'center'},tileBadgeText:{color:'#fff',fontSize:14,marginLeft:2},audioTile:{flex:1,width:'100%',padding:8,backgroundColor:'#262035',alignItems:'center',justifyContent:'center'},audioGlyph:{color:'#e6d9ff',fontSize:22},audioText:{color:'#cfc6e0',fontSize:9,textAlign:'center',marginTop:5},empty:{alignItems:'center',paddingHorizontal:22,paddingVertical:70},emptyIcon:{color:'#92929d',fontSize:38},emptyTitle:{color:C.text,fontSize:17,fontWeight:'700',marginTop:12},
 card:{backgroundColor:C.panel,borderColor:C.line,borderWidth:1,borderRadius:15,padding:13},cardTop:{flexDirection:'row',alignItems:'center',gap:10},
 kind:{width:36,height:36,borderRadius:11,backgroundColor:'#303039',alignItems:'center',justifyContent:'center'},kindIcon:{color:'#eee',fontSize:18},
 kindTitle:{color:C.text,fontSize:13,fontWeight:'700'},meta:{color:C.muted,fontSize:10,marginTop:3},
 status:{backgroundColor:'#36363e',borderRadius:12,paddingHorizontal:9,paddingVertical:5},statusDone:{backgroundColor:'#17392c'},statusFailed:{backgroundColor:'#432525'},statusText:{color:'#d7d7de',fontSize:9,fontWeight:'700'},
 prompt:{color:'#dddde3',fontSize:12,lineHeight:18,marginTop:12},jobId:{color:'#777782',fontSize:9,marginTop:7},
 previewWrap:{marginTop:10,borderRadius:11,overflow:'hidden',backgroundColor:'#151519'},preview:{width:'100%',height:210},
 output:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#29292f',borderRadius:9,padding:9,marginTop:8},
 outputText:{color:'#c9c9d1',fontSize:10,flex:1},open:{color:'#b9c8e7',fontSize:10,fontWeight:'700',marginLeft:8},
 actions:{flexDirection:'row',gap:8,marginTop:11},actionButton:{backgroundColor:'#e9e9ed',paddingHorizontal:12,paddingVertical:8,borderRadius:16},actionText:{color:'#111',fontSize:10,fontWeight:'700'},
 cancelButton:{backgroundColor:'#3b2a2a',paddingHorizontal:12,paddingVertical:8,borderRadius:16},cancelText:{color:'#f1b1b1',fontSize:10,fontWeight:'700'},
});
