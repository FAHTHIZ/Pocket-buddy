import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,Dimensions,FlatList,Image,Modal,Pressable,ScrollView,StyleSheet,Text,View}from'react-native';
import type{AudioStyle,ImageShape,MediaKind,MediaRequest,MessageAttachment}from'../types';
import{openAttachment,playAudioAttachment,playVideoAttachment,saveAttachment,shareAttachment,stopAudioPlayback}from'../services/media';
import{fallbackModels,listMediaModels,MEDIA_VOICES,type MediaModel}from'../services/mediaModels';

const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
let activeAudio='';const audioListeners=new Set<(id:string)=>void>();
function setActiveAudio(id:string){activeAudio=id;audioListeners.forEach(listener=>listener(id));}

export async function saveWithFeedback(item:MessageAttachment){
 try{await saveAttachment(item);Alert.alert('Saved','Saved to your gallery in the “Pocket Buddy” album.');}
 catch(error){Alert.alert('Could not save',errorText(error));}
}
export function shareWithFeedback(item:MessageAttachment){shareAttachment(item).catch(error=>Alert.alert('Could not share',errorText(error)));}

function AudioCard({item}:{item:MessageAttachment}){
 const[playing,setPlaying]=useState(activeAudio===item.id);
 useEffect(()=>{const listener=(id:string)=>setPlaying(id===item.id);audioListeners.add(listener);return()=>{audioListeners.delete(listener);};},[item.id]);
 const toggle=async()=>{
  if(playing){await stopAudioPlayback().catch(()=>{});setActiveAudio('');return;}
  setActiveAudio(item.id);
  try{await playAudioAttachment(item);}catch(error){Alert.alert('Could not play audio',errorText(error));}
  finally{if(activeAudio===item.id)setActiveAudio('');}
 };
 return <View style={s.audioCard}>
  <Pressable onPress={toggle} style={s.audioPlay}><Text style={s.audioPlayGlyph}>{playing?'■':'▶'}</Text></Pressable>
  <View style={{flex:1}}><Text style={s.audioTitle} numberOfLines={1}>{item.prompt||item.name}</Text><Text style={s.audioMeta} numberOfLines={1}>{playing?'Playing…':(item.model||'Audio')+(item.size?' · '+Math.max(1,Math.round(item.size/1024))+' KB':'')}</Text></View>
  <Pressable onPress={()=>saveWithFeedback(item)} style={s.smallButton}><Text style={s.smallButtonText}>Save</Text></Pressable>
  <Pressable onPress={()=>shareWithFeedback(item)} style={s.smallButton}><Text style={s.smallButtonText}>Share</Text></Pressable>
 </View>;
}
function VideoTile({item,width}:{item:MessageAttachment;width:number}){
 const play=()=>playVideoAttachment(item).catch(()=>openAttachment(item).catch(error=>Alert.alert('Could not play video',errorText(error))));
 return <View style={{width}}>
  <Pressable onPress={play} style={[s.videoTile,{width,height:width*9/16}]}>
   {item.thumbnail?<Image source={{uri:item.thumbnail}} style={StyleSheet.absoluteFill} resizeMode="cover"/>:null}
   <View style={s.playBadge}><Text style={s.playGlyph}>▶</Text></View>
  </Pressable>
  <View style={s.rowActions}>
   <Pressable onPress={play} style={s.smallButton}><Text style={s.smallButtonText}>Play</Text></Pressable>
   <Pressable onPress={()=>saveWithFeedback(item)} style={s.smallButton}><Text style={s.smallButtonText}>Save</Text></Pressable>
   <Pressable onPress={()=>shareWithFeedback(item)} style={s.smallButton}><Text style={s.smallButtonText}>Share</Text></Pressable>
  </View>
 </View>;
}
export function AttachmentGallery({items,pending=0}:{items:MessageAttachment[];pending?:number}){
 const[viewer,setViewer]=useState<number|null>(null);
 const width=Math.min(Dimensions.get('window').width-60,520);
 const images=items.filter(item=>(item.kind||kindOf(item.mimeType))==='image');
 const videos=items.filter(item=>(item.kind||kindOf(item.mimeType))==='video');
 const audios=items.filter(item=>(item.kind||kindOf(item.mimeType))==='audio');
 const columns=images.length+pending===1?1:2,gap=6,tile=(width-gap*(columns-1))/columns;
 return <View style={s.gallery}>
  {images.length||pending?<View style={[s.grid,{width,gap}]}>
   {images.map((item,index)=><Pressable key={item.id} onPress={()=>setViewer(index)} style={[s.tile,{width:tile,height:tile}]}><Image source={{uri:item.uri}} style={s.tileImage} resizeMode="cover"/></Pressable>)}
   {Array.from({length:pending}).map((_,index)=><View key={'pending-'+index} style={[s.tile,s.pendingTile,{width:tile,height:tile}]}><ActivityIndicator color="#9fc0ff"/></View>)}
  </View>:null}
  {videos.map(item=><VideoTile key={item.id} item={item} width={width}/>)}
  {audios.map(item=><AudioCard key={item.id} item={item}/>)}
  {viewer!==null?<ImageViewer items={images} start={viewer} onClose={()=>setViewer(null)}/>:null}
 </View>;
}
export function kindOf(mime:string):MediaKind{return mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'image';}
export function ImageViewer({items,start,onClose}:{items:MessageAttachment[];start:number;onClose:()=>void}){
 const{width,height}=Dimensions.get('window');const[index,setIndex]=useState(start);
 const current=items[index];
 return <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
  <View style={s.viewer}>
   <FlatList data={items} horizontal pagingEnabled initialScrollIndex={start} getItemLayout={(_,i)=>({length:width,offset:width*i,index:i})} keyExtractor={item=>item.id} showsHorizontalScrollIndicator={false}
    onMomentumScrollEnd={event=>setIndex(Math.round(event.nativeEvent.contentOffset.x/width))}
    renderItem={({item})=><View style={{width,height:height-150,justifyContent:'center'}}><Image source={{uri:item.uri}} style={{width,height:height-150}} resizeMode="contain"/></View>}/>
   <View style={s.viewerBar}>
    <Text style={s.viewerCount}>{index+1} / {items.length}</Text>
    <Text style={s.viewerPrompt} numberOfLines={2}>{current?.prompt||''}</Text>
    <View style={s.rowActions}>
     <Pressable onPress={()=>current&&saveWithFeedback(current)} style={s.viewerButton}><Text style={s.viewerButtonText}>Save</Text></Pressable>
     <Pressable onPress={()=>current&&shareWithFeedback(current)} style={s.viewerButton}><Text style={s.viewerButtonText}>Share</Text></Pressable>
     <Pressable onPress={()=>current&&openAttachment(current).catch(error=>Alert.alert('Could not open',errorText(error)))} style={s.viewerButton}><Text style={s.viewerButtonText}>Open</Text></Pressable>
     <Pressable onPress={onClose} style={[s.viewerButton,s.viewerClose]}><Text style={[s.viewerButtonText,{color:'#111'}]}>Close</Text></Pressable>
    </View>
   </View>
  </View>
 </Modal>;
}

export type CreateMode={kind:MediaKind;count:number;model:string;shape:ImageShape;audioStyle:AudioStyle;duration:number;voice:string};
export function modeLabel(mode:CreateMode,models:MediaModel[]):string{
 const model=models.find(item=>item.id===mode.model);const name=model?.title||mode.model.split('/').pop()||mode.model;
 const kind=mode.kind==='image'?'Image':mode.kind==='video'?'Video':mode.audioStyle==='speech'?'Speech':mode.audioStyle==='sfx'?'Sound FX':'Music';
 return kind+(mode.count>1?' ×'+mode.count:'')+' · '+name;
}
export function modeToRequest(mode:CreateMode,prompt:string,inputAttachments:MessageAttachment[]=[]):MediaRequest{
 return{kind:mode.kind,prompt,count:mode.count,model:mode.model,shape:mode.shape,audioStyle:mode.kind==='audio'?mode.audioStyle:undefined,duration:mode.kind==='image'?undefined:mode.duration||undefined,voice:mode.voice,...(inputAttachments.length?{inputAttachments}:{})};
}
export function useMediaModels(){
 const[models,setModels]=useState<MediaModel[]>(fallbackModels());
 useEffect(()=>{let live=true;listMediaModels().then(items=>{if(live&&items.length)setModels(items);}).catch(()=>{});return()=>{live=false;};},[]);
 return models;
}
export function CreateOptions({mode,models,onChange,onClose,connected,onConnect}:{mode:CreateMode;models:MediaModel[];onChange:(mode:CreateMode)=>void;onClose:()=>void;connected:boolean;onConnect:()=>void}){
 const list=models.filter(item=>item.kind===mode.kind&&(mode.kind!=='audio'||item.audioStyle===mode.audioStyle));
 const max=mode.kind==='image'?20:4;
 const selected=models.find(item=>item.id===mode.model);
 const durations=mode.kind==='video'?(selected?.durations?.length?selected.durations:[selected?.minDuration||4,6,8,10,selected?.maxDuration||10].filter((value,index,all)=>all.indexOf(value)===index&&value>=(selected?.minDuration||1)&&value<=(selected?.maxDuration||10)).sort((a,b)=>a-b)):mode.kind==='audio'&&mode.audioStyle!=='speech'?[0,10,30,60]:[];
 const pickStyle=(style:AudioStyle)=>{const first=models.find(item=>item.kind==='audio'&&item.audioStyle===style);onChange({...mode,audioStyle:style,model:first?.id||mode.model});};
 return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
  <Pressable style={s.shade} onPress={onClose}/>
  <View style={s.sheet}>
   <ScrollView contentContainerStyle={{paddingBottom:12}}>
    <Text style={s.sheetTitle}>{mode.kind==='image'?'Image options':mode.kind==='video'?'Video options':'Audio options'}</Text>
    {mode.kind==='audio'?<><Text style={s.label}>Type</Text><View style={s.chips}>{(['music','speech','sfx'] as AudioStyle[]).map(style=><Chip key={style} label={style==='music'?'Music / song':style==='speech'?'Speech':'Sound effect'} active={mode.audioStyle===style} onPress={()=>pickStyle(style)}/>)}</View></>:null}
    <Text style={s.label}>How many</Text>
    <View style={s.stepper}>
     <Pressable style={s.stepButton} onPress={()=>onChange({...mode,count:Math.max(1,mode.count-1)})}><Text style={s.stepText}>−</Text></Pressable>
     <Text style={s.stepValue}>{mode.count}</Text>
     <Pressable style={s.stepButton} onPress={()=>onChange({...mode,count:Math.min(max,mode.count+1)})}><Text style={s.stepText}>＋</Text></Pressable>
     {mode.kind==='image'?<View style={s.chips}>{[1,4,10,20].map(value=><Chip key={value} label={String(value)} active={mode.count===value} onPress={()=>onChange({...mode,count:value})}/>)}</View>:null}
    </View>
    {mode.kind!=='audio'?<><Text style={s.label}>Shape</Text><View style={s.chips}>{(mode.kind==='video'?['landscape','portrait']:['square','portrait','landscape'] as ImageShape[]).map(shape=><Chip key={shape} label={shape==='square'?'Square':shape==='portrait'?'Portrait 9:16':'Landscape 16:9'} active={mode.shape===shape} onPress={()=>onChange({...mode,shape:shape as ImageShape})}/>)}</View></>:null}
    {durations.length?<><Text style={s.label}>Length</Text><View style={s.chips}>{durations.map(value=><Chip key={value} label={value?value+' s':'Auto'} active={mode.duration===value} onPress={()=>onChange({...mode,duration:value})}/>)}</View></>:null}
    {mode.kind==='audio'&&mode.audioStyle==='speech'?<><Text style={s.label}>Voice</Text><View style={s.chips}>{MEDIA_VOICES.map(voice=><Chip key={voice} label={voice} active={mode.voice===voice} onPress={()=>onChange({...mode,voice})}/>)}</View></>:null}
    <Text style={s.label}>Model</Text>
    {!connected?<Pressable onPress={onConnect} style={s.notice}><Text style={s.noticeText}>Connect your own ComfyUI server in Settings and add the matching workflow. Generation runs on that computer, not on this phone.</Text></Pressable>:null}
    {list.map(item=><Pressable key={item.id} onPress={()=>onChange({...mode,model:item.id,duration:item.kind==='video'&&item.durations?.length&&!item.durations.includes(mode.duration)?item.durations[0]:mode.duration})} style={[s.modelRow,mode.model===item.id&&s.modelRowActive]}>
     <View style={{flex:1}}><Text style={s.modelName}>{item.title}</Text><Text style={s.modelDesc} numberOfLines={2}>{item.description||item.id}</Text></View>
     <View style={s.badge}><Text style={s.badgeText}>{item.licenseLabel}</Text></View>
    </Pressable>)}
    {!list.length?<Text style={s.modelDesc}>No models available for this type right now.</Text>:null}
   </ScrollView>
   <Pressable onPress={onClose} style={s.done}><Text style={s.doneText}>Done</Text></Pressable>
  </View>
 </Modal>;
}
function Chip({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){return <Pressable onPress={onPress} style={[s.chip,active&&s.chipActive]}><Text style={[s.chipText,active&&s.chipTextActive]}>{label}</Text></Pressable>;}

const s=StyleSheet.create({
 gallery:{gap:8,marginTop:6},grid:{flexDirection:'row',flexWrap:'wrap'},
 tile:{borderRadius:12,overflow:'hidden',backgroundColor:'#232329'},tileImage:{width:'100%',height:'100%'},pendingTile:{alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#34343b'},
 videoTile:{borderRadius:12,overflow:'hidden',backgroundColor:'#1b1b20',alignItems:'center',justifyContent:'center'},
 playBadge:{width:56,height:56,borderRadius:28,backgroundColor:'#000a',alignItems:'center',justifyContent:'center'},playGlyph:{color:'#fff',fontSize:24,marginLeft:4},
 rowActions:{flexDirection:'row',gap:7,marginTop:7,flexWrap:'wrap'},
 smallButton:{paddingVertical:6,paddingHorizontal:11,borderRadius:13,backgroundColor:'#2a2a31'},smallButtonText:{color:'#d6e0f5',fontSize:11,fontWeight:'700'},
 audioCard:{flexDirection:'row',alignItems:'center',gap:9,backgroundColor:'#1d1d22',borderWidth:1,borderColor:'#34343b',borderRadius:14,padding:10},
 audioPlay:{width:40,height:40,borderRadius:20,backgroundColor:'#f0f0f2',alignItems:'center',justifyContent:'center'},audioPlayGlyph:{color:'#111',fontSize:16,fontWeight:'800'},
 audioTitle:{color:'#f0f0f4',fontSize:12,fontWeight:'700'},audioMeta:{color:'#9a9aa4',fontSize:10,marginTop:3},
 viewer:{flex:1,backgroundColor:'#000'},viewerBar:{position:'absolute',left:0,right:0,bottom:0,padding:14,paddingBottom:22,backgroundColor:'#000c'},
 viewerCount:{color:'#bbb',fontSize:11},viewerPrompt:{color:'#eee',fontSize:12,marginTop:4},
 viewerButton:{paddingVertical:9,paddingHorizontal:15,borderRadius:16,backgroundColor:'#2c2c33'},viewerButtonText:{color:'#eef',fontSize:12,fontWeight:'700'},viewerClose:{backgroundColor:'#f0f0f2',marginLeft:'auto'},
 shade:{flex:1,backgroundColor:'#000a'},sheet:{maxHeight:'82%',backgroundColor:'#1c1c21',borderTopLeftRadius:22,borderTopRightRadius:22,padding:18},
 sheetTitle:{color:'#f4f4f5',fontSize:18,fontWeight:'800',marginBottom:4},label:{color:'#a7a7b2',fontSize:10,fontWeight:'800',letterSpacing:1,marginTop:14,marginBottom:7,textTransform:'uppercase'},
 chips:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{paddingHorizontal:12,paddingVertical:7,borderRadius:15,borderWidth:1,borderColor:'#42424b'},chipActive:{backgroundColor:'#e9edf5',borderColor:'#e9edf5'},
 chipText:{color:'#d3d3dc',fontSize:11,fontWeight:'600'},chipTextActive:{color:'#111'},
 stepper:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'},stepButton:{width:36,height:36,borderRadius:18,backgroundColor:'#2c2c33',alignItems:'center',justifyContent:'center'},stepText:{color:'#fff',fontSize:19},stepValue:{color:'#fff',fontSize:18,fontWeight:'800',minWidth:28,textAlign:'center'},
 modelRow:{flexDirection:'row',alignItems:'center',gap:10,padding:11,borderRadius:12,borderWidth:1,borderColor:'#2f2f36',marginBottom:7},modelRowActive:{borderColor:'#9fc0ff',backgroundColor:'#20242d'},
 modelName:{color:'#f0f0f4',fontSize:12,fontWeight:'700'},modelDesc:{color:'#9a9aa4',fontSize:10,marginTop:3,lineHeight:14},
 badge:{paddingHorizontal:8,paddingVertical:4,borderRadius:9},badgeFree:{backgroundColor:'#1f3a2e'},badgePaid:{backgroundColor:'#3a2f1f'},badgeText:{color:'#e8e8ea',fontSize:9,fontWeight:'800'},
 notice:{backgroundColor:'#2a2620',borderRadius:12,padding:10,marginBottom:9},noticeText:{color:'#f0dcb8',fontSize:11,lineHeight:16},
 done:{backgroundColor:'#f0f0f2',borderRadius:14,paddingVertical:12,alignItems:'center',marginTop:6},doneText:{color:'#111',fontWeight:'800',fontSize:13},
});
