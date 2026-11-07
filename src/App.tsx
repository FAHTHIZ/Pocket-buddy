import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,BackHandler,Modal,Pressable,ScrollView,StatusBar,StyleSheet,Text,View}from'react-native';
import{SafeAreaProvider,SafeAreaView}from'react-native-safe-area-context';
import AsyncStorage from'@react-native-async-storage/async-storage';
import ChatScreen from'./screens/ChatScreen';
import ConnectorsScreen from'./screens/ConnectorsScreen';
import ModelsScreen from'./screens/ModelsScreen';
import SettingsScreen from'./screens/SettingsScreen';
import MediaScreen from'./screens/MediaScreen';
import{runAgent,type ConfirmTool}from'./services/agent';
import{listConversations,saveConversation}from'./services/database';
import{getProviderKey,loadConfig,saveConfig,saveProviderKey}from'./services/storage';
import{discoverAndTestProvider}from'./services/providerSetup';
import{loadLocalModel,releaseLocalModel}from'./services/llm';
import{readAloud,stopSpeech}from'./services/speech';
import type{AppConfig,ChatMessage,Conversation}from'./types';

type Screen='chat'|'connectors'|'models'|'settings'|'media';
const C={bg:'#101012',panel:'#1f1f23',text:'#f4f4f5',muted:'#a1a1aa',line:'#34343b'};
function BuddyApp(){
 const[screen,setScreen]=useState<Screen>('chat'),[menuOpen,setMenuOpen]=useState(false);
 const[conversations,setConversations]=useState<Conversation[]>([]),[activeId,setActiveId]=useState('');
 const[config,setConfig]=useState<AppConfig|null>(null),[modelName,setModelName]=useState('Choose a model');
 const[messages,setMessages]=useState<ChatMessage[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const[liveText,setLiveText]=useState(''),[toolsEnabled,setToolsEnabled]=useState(true),[bootError,setBootError]=useState(''),[ready,setReady]=useState(false),[speechActive,setSpeechActive]=useState(false),[setupComplete,setSetupComplete]=useState(false);

 useEffect(()=>{
  let mounted=true;
  (async()=>{
   try{
    const [savedConfig,localUri,activeModel,setupMarker,providerKey]=await Promise.all([
     loadConfig(),
     AsyncStorage.getItem('pocket-buddy.local-model-uri'),
     AsyncStorage.getItem('pocket-buddy.active-model'),
     AsyncStorage.getItem('pocket-buddy.setup-complete'),
     getProviderKey(),
    ]);
    if(!mounted)return;
    setConfig(savedConfig);
    const localReady=savedConfig.mode==='local'&&!!localUri;
    const apiReady=savedConfig.mode==='api'&&!!savedConfig.baseUrl&&!!savedConfig.model&&(setupMarker==='true'||!!providerKey);
    setSetupComplete(apiReady);
    if(savedConfig.mode==='local'&&localUri){
     setModelName(activeModel||'Loading local model…');
     setReady(true);
     void loadLocalModel(localUri).then(()=>{
      if(mounted){setModelName(activeModel||'Local model');setSetupComplete(true);}
     }).catch(error=>{
      if(mounted){
       setModelName('Local model unavailable');
       setSetupComplete(false);
       setBootError(error instanceof Error?error.message:String(error));
      }
     });
    }else{
     setModelName(savedConfig.mode==='api'?(savedConfig.model||'Connect an AI'):'Choose a local model');
     setReady(true);
    }
   }catch(error){
    if(mounted){
     setBootError(error instanceof Error?error.message:String(error));
     setModelName('Connect an AI');
     setSetupComplete(false);
    }
   }finally{
    if(mounted)setReady(true);
   }
  })();
  return()=>{mounted=false;releaseLocalModel().catch(()=>{});};
 },[]);
 useEffect(()=>{
  if(!ready)return;
  let mounted=true;
  listConversations().then(stored=>{
   if(!mounted)return;
   setConversations(stored);
   if(stored.length){
    const recent=stored[0];
    setActiveId(recent.id);
    setMessages(recent.messages);
   }
  }).catch(error=>{
   if(mounted)setBootError('Chat history could not be loaded: '+(error instanceof Error?error.message:String(error)));
  });
  return()=>{mounted=false;};
 },[ready]);
 useEffect(()=>{
  const sub=BackHandler.addEventListener('hardwareBackPress',()=>{
   if(menuOpen){setMenuOpen(false);return true;}
   if(screen!=='chat'){setScreen('chat');return true;}
   return false;
  });
  return()=>sub.remove();
 },[menuOpen,screen]);

 const saveCurrent=async(id:string,next:ChatMessage[],title:string)=>{
  const conversation:Conversation={id,title,updatedAt:Date.now(),messages:next};
  await saveConversation(conversation);
  setConversations(old=>[conversation,...old.filter(item=>item.id!==id)].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,100));
 };
 const confirmTool:ConfirmTool=(name,args)=>new Promise(resolve=>{
  const detail=JSON.stringify(args).slice(0,650);
  Alert.alert('Allow this tool?',name+'\n\n'+detail,[{text:'Cancel',style:'cancel',onPress:()=>resolve(false)},{text:'Allow once',onPress:()=>resolve(true)}],{cancelable:false});
 });
 const send=async(text:string)=>{
  if(busy)return;
  const user:ChatMessage={id:'message-'+Date.now(),role:'user',content:text,createdAt:Date.now()};
  const next=[...messages,user],id=activeId||'chat-'+Date.now().toString(36);
  const title=conversations.find(item=>item.id===id)?.title||text.slice(0,48)||'New chat';
  setActiveId(id);setMessages(next);setLiveText('');setBusy(true);setStatus('Thinking');
  try{await saveCurrent(id,next,title);}catch(error){setBootError('Chat history could not be saved: '+(error instanceof Error?error.message:String(error)));}
  try{
   const answer=await runAgent(next,event=>{
    if(event.type==='status')setStatus(event.message);
    if(event.type==='token')setLiveText(old=>old+event.token);
    if(event.type==='clear_tokens')setLiveText('');
    if(event.type==='tool_start')setStatus('Using '+event.name);
    if(event.type==='tool_result')setStatus('Reviewing tool result');
   },confirmTool,toolsEnabled,id);
   const assistant:ChatMessage={id:'assistant-'+Date.now(),role:'assistant',content:answer,createdAt:Date.now()};
   const complete=[...next,assistant];setMessages(complete);setLiveText('');
   await saveCurrent(id,complete,title);
  }catch(error){
   const assistant:ChatMessage={id:'assistant-error-'+Date.now(),role:'assistant',content:'I could not complete that request: '+(error instanceof Error?error.message:String(error)),createdAt:Date.now(),error:true};
   const complete=[...next,assistant];setMessages(complete);setLiveText('');
   try{await saveCurrent(id,complete,title);}catch{}
  }finally{setBusy(false);setStatus('');}
 };
 const connectProvider=async(url:string,key:string,model:string)=>{
  const result=await discoverAndTestProvider(url,key,model);
  const current=config||await loadConfig();
  const next={...current,mode:'api' as const,baseUrl:result.baseUrl,model:result.model};
  await saveProviderKey(key);
  await saveConfig(next);
  await AsyncStorage.setItem('pocket-buddy.setup-complete','true');
  await releaseLocalModel();
  setConfig(next);
  setModelName(result.model);
  setSetupComplete(true);
  setBootError('');
  setScreen('chat');
 };
 const playMessage=async(content:string)=>{try{setSpeechActive(true);await readAloud(content);}catch(error){Alert.alert('Voice playback unavailable',error instanceof Error?error.message:String(error));}finally{setSpeechActive(false);}};
 const stopVoice=async()=>{try{await stopSpeech();}catch{}finally{setSpeechActive(false);}};
 const newChat=()=>{if(busy)return;setActiveId('');setMessages([]);setLiveText('');setScreen('chat');setMenuOpen(false);};
 const openScreen=(value:Screen)=>{setScreen(value);setMenuOpen(false);};
 const chooseChat=(item:Conversation)=>{if(busy)return;setActiveId(item.id);setMessages(item.messages);setLiveText('');setScreen('chat');setMenuOpen(false);};
 const deleteChat=(item:Conversation)=>Alert.alert('Delete conversation?','This permanently removes the chat from this device.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const{deleteConversation}=await import('./services/database');await deleteConversation(item.id);const next=conversations.filter(chat=>chat.id!==item.id);setConversations(next);if(activeId===item.id){setActiveId('');setMessages([]);}}}]);
 const modelLoaded=(name:string,uri:string)=>{
  setModelName(name);setScreen('chat');setSetupComplete(true);
  const update=async()=>{
   const current=await loadConfig();
   const next={...current,mode:'local' as const};
   await saveConfig(next);
   await AsyncStorage.setItem('pocket-buddy.setup-complete','true');
   setConfig(next);
  };
  update().catch(error=>setBootError(String(error)));
  AsyncStorage.setItem('pocket-buddy.local-model-uri',uri).catch(()=>{});
 };
 const settingsSaved=async(next:AppConfig)=>{
  setConfig(next);
  if(next.mode==='api'){
   await releaseLocalModel();
   const configured=!!next.baseUrl.trim()&&!!next.model.trim();
   setSetupComplete(configured);
   if(configured)await AsyncStorage.setItem('pocket-buddy.setup-complete','true');
   setModelName(next.model||'Connect an AI');
  }else{
   const uri=await AsyncStorage.getItem('pocket-buddy.local-model-uri');
   if(uri){
    try{await loadLocalModel(uri,true);setModelName((await AsyncStorage.getItem('pocket-buddy.active-model'))||'Local model');setSetupComplete(true);}
    catch(e){setModelName('Local model unavailable');setSetupComplete(false);setBootError(e instanceof Error?e.message:String(e));}
   }else{setModelName('Choose a local model');setSetupComplete(false);}
  }
  setScreen('chat');
 };
 return <SafeAreaView style={s.safe} edges={['top','left','right']}>
  <StatusBar barStyle="light-content"/>
  {!ready?<View style={s.boot}><View style={s.bootLogo}><Text style={s.bootGlyph}>✳</Text></View><Text style={s.bootTitle}>Pocket Buddy</Text><ActivityIndicator color="#9fc0ff" size="small"/><Text style={s.bootHint}>Preparing your workspace…</Text></View>:<>
  {screen==='chat'&&<ChatScreen messages={messages} onSend={send} busy={busy} status={status} modelName={modelName} liveText={liveText} toolsEnabled={toolsEnabled} onToggleTools={()=>setToolsEnabled(v=>!v)} speechActive={speechActive} onSpeak={playMessage} onStopSpeech={stopVoice} needsSetup={!setupComplete} onConnectProvider={connectProvider} onMenu={()=>{if(!busy)setMenuOpen(true);}} onModels={()=>setScreen('models')} onQuickAction={action=>setScreen(action==='models'?'models':action==='connectors'?'connectors':action==='gallery'?'media':'chat')}/>}
  {screen==='connectors'&&<ConnectorsScreen onBack={()=>setScreen('chat')} onSettings={()=>setScreen('settings')}/>}
  {screen==='models'&&<ModelsScreen onBack={()=>setScreen('chat')} onOpenSettings={()=>setScreen('settings')} onLoaded={modelLoaded}/>}
  {screen==='settings'&&<SettingsScreen onBack={()=>setScreen('chat')} onSaved={settingsSaved}/>}
  {screen==='media'&&<MediaScreen onBack={()=>setScreen('chat')}/>}
  <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={()=>setMenuOpen(false)}>
   <View style={s.menuShade}><Pressable style={StyleSheet.absoluteFill} onPress={()=>setMenuOpen(false)}/>
    <View style={s.drawer}>
     <View style={s.drawerTop}><Text style={s.drawerBrand}>Pocket Buddy</Text><Pressable onPress={newChat} style={s.newIcon}><Text style={s.newIconText}>＋</Text></Pressable></View>
     <Pressable style={s.newChat} onPress={newChat}><Text style={s.newChatText}>＋  New chat</Text></Pressable>
     <Text style={s.drawerLabel}>WORKSPACE</Text>
     <MenuItem label="Models" icon="◈" onPress={()=>openScreen('models')}/>
     <MenuItem label="Connectors" icon="⌘" onPress={()=>openScreen('connectors')}/>
     <MenuItem label="Media library" icon="▧" onPress={()=>openScreen('media')}/>
     <MenuItem label="Settings" icon="⚙" onPress={()=>openScreen('settings')}/>
     <Text style={s.drawerLabel}>RECENT CHATS</Text>
     <ScrollView style={{flex:1}}>
      {conversations.map(item=><Pressable key={item.id} onPress={()=>chooseChat(item)} onLongPress={()=>deleteChat(item)} style={[s.chatLink,item.id===activeId&&s.chatLinkActive]}><Text style={s.chatLinkText} numberOfLines={1}>{item.title}</Text></Pressable>)}
     </ScrollView>
     <View style={s.footer}><Text style={s.footerTitle}>Your AI, your choice</Text><Text style={s.footerText}>Local models and remote providers, controlled by you.</Text></View>
    </View>
   </View>
  </Modal>
  {bootError? <View style={s.toast}><Text style={s.toastText} numberOfLines={2}>{bootError}</Text><Pressable onPress={()=>setBootError('')}><Text style={s.toastClose}>×</Text></Pressable></View>:null}
  </>}
 </SafeAreaView>;
}
function MenuItem({label,icon,onPress}:{label:string;icon:string;onPress:()=>void}){
 return <Pressable onPress={onPress} style={s.menuItem}><Text style={s.menuIcon}>{icon}</Text><Text style={s.menuText}>{label}</Text><Text style={s.menuChevron}>›</Text></Pressable>;
}
export default function App(){return <SafeAreaProvider><BuddyApp/></SafeAreaProvider>;}
const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},boot:{flex:1,alignItems:'center',justifyContent:'center',gap:12},bootLogo:{width:64,height:64,borderRadius:32,backgroundColor:'#28282f',alignItems:'center',justifyContent:'center'},bootGlyph:{color:'#f4f4f5',fontSize:38},bootTitle:{color:C.text,fontSize:20,fontWeight:'800'},bootHint:{color:C.muted,fontSize:12},menuShade:{flex:1,flexDirection:'row',backgroundColor:'#0009'},
 drawer:{width:'84%',maxWidth:350,backgroundColor:'#17171b',paddingTop:17,paddingHorizontal:15,paddingBottom:13,borderRightWidth:1,borderRightColor:C.line},
 drawerTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:18},drawerBrand:{color:C.text,fontSize:19,fontWeight:'800'},
 newIcon:{width:36,height:36,borderRadius:18,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},newIconText:{color:C.text,fontSize:22,marginTop:-2},
 newChat:{backgroundColor:'#29292f',borderRadius:13,padding:13,marginBottom:17},newChatText:{color:C.text,fontSize:13,fontWeight:'700'},
 drawerLabel:{color:'#85858f',fontSize:10,fontWeight:'800',letterSpacing:1.2,marginBottom:8,marginTop:10},
 menuItem:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomColor:'#25252a',borderBottomWidth:1},
 menuIcon:{width:24,color:'#c5c5ce',fontSize:17,textAlign:'center'},menuText:{color:'#e7e7ec',fontSize:13,flex:1},menuChevron:{color:'#777781',fontSize:21},
 chatLink:{paddingVertical:10,paddingHorizontal:9,borderRadius:8},chatLinkActive:{backgroundColor:'#29292f'},chatLinkText:{color:'#bcbcc5',fontSize:12},
 footer:{backgroundColor:'#222227',borderRadius:13,padding:12,marginTop:12},footerTitle:{color:C.text,fontSize:11,fontWeight:'700'},footerText:{color:C.muted,fontSize:10,lineHeight:15,marginTop:4},
 toast:{position:'absolute',bottom:10,left:12,right:12,backgroundColor:'#3c2929',borderRadius:12,padding:10,flexDirection:'row',alignItems:'center',gap:8},
 toastText:{color:'#f1dada',fontSize:10,flex:1},toastClose:{color:'#f1dada',fontSize:19,paddingHorizontal:4},
});
