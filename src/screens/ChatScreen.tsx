import React,{useEffect,useRef,useState}from'react';
import{ActivityIndicator,FlatList,KeyboardAvoidingView,Linking,Modal,Platform,Pressable,StyleSheet,Text,TextInput,View}from'react-native';
import Markdown from'react-native-markdown-display';
import type{ChatMessage}from'../types';

const C={bg:'#101012',panel:'#1d1d21',panel2:'#29292f',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa',blue:'#9fc0ff'};
type Props={
 messages:ChatMessage[];onSend:(text:string)=>void;busy:boolean;status:string;modelName:string;
 liveText:string;toolsEnabled:boolean;onToggleTools:()=>void;onMenu:()=>void;onModels:()=>void;
 onQuickAction:(action:'image'|'video'|'models'|'connectors'|'gallery')=>void;
 onSpeak:(text:string)=>void;onStopSpeech:()=>void;speechActive:boolean;
};
export default function ChatScreen(p:Props){
 const[draft,setDraft]=useState(''),[actions,setActions]=useState(false);
 const list=useRef<FlatList<ChatMessage>>(null);
 useEffect(()=>{const timer=setTimeout(()=>list.current?.scrollToEnd({animated:true}),90);return()=>clearTimeout(timer);},[p.messages.length,p.liveText,p.busy]);
 const send=()=>{const value=draft.trim();if(!value||p.busy)return;setDraft('');p.onSend(value);};
 const quick=(action:'image'|'video'|'models'|'connectors'|'gallery')=>{setActions(false);if(action==='image')setDraft('Create an image of ');else if(action==='video')setDraft('Create a video of ');else p.onQuickAction(action);};
 const empty=p.messages.length===0&&!p.liveText;
 return <KeyboardAvoidingView style={s.root} behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={0}>
  <View style={s.topbar}>
   <Pressable style={s.menuButton} onPress={p.onMenu}><Text style={s.menuIcon}>☰</Text></Pressable>
   <Text style={s.brand}>Pocket Buddy</Text>
   {p.speechActive?<Pressable style={s.stopSpeech} onPress={p.onStopSpeech}><Text style={s.stopSpeechText}>Stop voice</Text></Pressable>:null}
   <Pressable style={s.topAction} onPress={p.onModels}><Text style={s.topActionText}>＋</Text></Pressable>
  </View>
  {empty?<View style={s.welcome}>
    <View style={s.logo}><Text style={s.logoGlyph}>✳</Text></View>
    <Text style={s.welcomeTitle}>What can I do for you today?</Text>
    <Text style={s.welcomeSubtitle}>Your personal AI. Run a model on this phone or connect the provider you prefer.</Text>
    <View style={s.suggestions}>
     <Pressable style={s.suggestion} onPress={()=>setDraft('Explain a complex topic in simple terms')}><Text style={s.suggestionText}>Explain a complex topic</Text><Text style={s.suggestionArrow}>↗</Text></Pressable>
     <Pressable style={s.suggestion} onPress={()=>setDraft('Search the web for the latest developments in ')}><Text style={s.suggestionText}>Search the web</Text><Text style={s.suggestionArrow}>↗</Text></Pressable>
     <Pressable style={s.suggestion} onPress={()=>setDraft('Create an image of ')}><Text style={s.suggestionText}>Create images and videos</Text><Text style={s.suggestionArrow}>↗</Text></Pressable>
    </View>
   </View>:<FlatList ref={list} style={s.messages} contentContainerStyle={s.messageList} data={p.messages} keyExtractor={m=>m.id}
    renderItem={({item})=><View style={[s.messageRow,item.role==='user'?s.userRow:s.assistantRow]}>
      {item.role==='assistant'&&<View style={s.avatar}><Text style={s.avatarGlyph}>✳</Text></View>}
      <View style={[s.bubble,item.role==='user'?s.userBubble:s.assistantBubble]}>
       <Markdown style={markdown} onLinkPress={url=>{Linking.openURL(url).catch(()=>{});return false;}}>{item.content}</Markdown>
       {item.error&&<Text style={s.error}>This response may be incomplete. You can retry your request.</Text>}
       {item.role==='assistant'?<Pressable style={s.speechButton} onPress={()=>p.onSpeak(item.content)}><Text style={s.speechButtonText}>◖  Read aloud</Text></Pressable>:null}
      </View>
     </View>}
    ListFooterComponent={p.liveText?<View style={s.liveRow}><View style={s.avatar}><Text style={s.avatarGlyph}>✳</Text></View><View style={s.liveBubble}><Markdown style={markdown}>{p.liveText}</Markdown></View></View>:p.busy?<View style={s.thinking}><ActivityIndicator color={C.muted} size="small"/><Text style={s.thinkingText}>{p.status||'Thinking'}</Text></View>:undefined}
   />}
  <View style={s.composerWrap}>
   <View style={s.modelStrip}>
    <Pressable style={s.modelPill} onPress={p.onModels}><View style={s.modelDot}/><Text style={s.modelText} numberOfLines={1}>{p.modelName}</Text><Text style={s.modelChevron}>⌄</Text></Pressable>
    <Pressable style={[s.toolsPill,p.toolsEnabled&&s.toolsPillActive]} onPress={p.onToggleTools}><Text style={[s.toolsText,p.toolsEnabled&&s.toolsTextActive]}>✧ Tools {p.toolsEnabled?'On':'Off'}</Text></Pressable>
   </View>
   <View style={s.composer}>
    <TextInput value={draft} onChangeText={setDraft} placeholder="Message Pocket Buddy" placeholderTextColor="#92929b" multiline maxLength={16000} editable={!p.busy} style={s.input} onSubmitEditing={send} blurOnSubmit={false}/>
    <View style={s.composerBottom}>
     <Pressable style={s.plusButton} onPress={()=>setActions(true)}><Text style={s.plus}>＋</Text></Pressable>
     <Text style={s.inputHint}>Local or API · Your choice</Text>
     <Pressable style={[s.sendButton,(!draft.trim()||p.busy)&&s.sendDisabled]} onPress={send} disabled={!draft.trim()||p.busy}><Text style={s.sendArrow}>{p.busy?'…':'↑'}</Text></Pressable>
    </View>
   </View>
   <Text style={s.disclaimer}>Pocket Buddy can make mistakes. Check important information.</Text>
  </View>
  <Modal visible={actions} transparent animationType="fade" onRequestClose={()=>setActions(false)}>
   <Pressable style={s.modalShade} onPress={()=>setActions(false)}>
    <View style={s.actionSheet}>
     <Text style={s.sheetTitle}>Add to your session</Text>
     <Action label="Generate image" detail="Use the built-in image workflow" icon="▧" onPress={()=>quick('image')}/>
     <Action label="Generate video" detail="Create a video through your media engine" icon="▶" onPress={()=>quick('video')}/>
     <Action label="Choose a model" detail="Install or switch a local model" icon="◈" onPress={()=>quick('models')}/>
     <Action label="Connectors" detail="GitHub, MCP and external tools" icon="⌘" onPress={()=>quick('connectors')}/>
     <Action label="Media library" detail="Review generation jobs" icon="▤" onPress={()=>quick('gallery')}/>
    </View>
   </Pressable>
  </Modal>
 </KeyboardAvoidingView>;
}
function Action({label,detail,icon,onPress}:{label:string;detail:string;icon:string;onPress:()=>void}){
 return <Pressable style={s.actionRow} onPress={onPress}><View style={s.actionIcon}><Text style={s.actionGlyph}>{icon}</Text></View><View style={{flex:1}}><Text style={s.actionLabel}>{label}</Text><Text style={s.actionDetail}>{detail}</Text></View><Text style={s.actionArrow}>›</Text></Pressable>;
}
const markdown:any={
 body:{color:'#f1f1f4',fontSize:15,lineHeight:23},paragraph:{marginTop:0,marginBottom:9},
 heading1:{color:'#fff',fontSize:23,fontWeight:'700',marginTop:12,marginBottom:7},
 heading2:{color:'#fff',fontSize:19,fontWeight:'700',marginTop:10,marginBottom:6},
 heading3:{color:'#fff',fontSize:16,fontWeight:'700',marginTop:8,marginBottom:5},
 code_inline:{backgroundColor:'#303039',color:'#e5e5ee',borderRadius:4,paddingHorizontal:4},
 code_block:{backgroundColor:'#17171b',color:'#e5e5ee',borderRadius:9,padding:11},
 fence:{backgroundColor:'#17171b',color:'#e5e5ee',borderRadius:9,padding:11},
 link:{color:C.blue,textDecorationLine:'underline'},bullet_list:{marginBottom:9},ordered_list:{marginBottom:9},
 blockquote:{backgroundColor:'#25252b',borderLeftColor:'#888895',borderLeftWidth:3,paddingLeft:10},
};
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},topbar:{height:56,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:10,borderBottomWidth:1,borderBottomColor:'#222226'},
 menuButton:{width:38,height:38,borderRadius:19,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},
 menuIcon:{color:C.text,fontSize:19},brand:{flex:1,color:C.text,fontSize:17,fontWeight:'700'},
 topAction:{width:36,height:36,borderRadius:18,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},topActionText:{color:C.text,fontSize:23,marginTop:-2},
 welcome:{flex:1,justifyContent:'center',alignItems:'center',paddingHorizontal:22,paddingBottom:32},
 logo:{width:66,height:66,borderRadius:33,backgroundColor:'#242429',alignItems:'center',justifyContent:'center',marginBottom:19},
 logoGlyph:{color:'#fff',fontSize:38},welcomeTitle:{color:C.text,fontWeight:'700',fontSize:25,textAlign:'center'},
 welcomeSubtitle:{color:C.muted,fontSize:13,lineHeight:20,textAlign:'center',marginTop:10,maxWidth:315},
 suggestions:{width:'100%',gap:8,marginTop:25},suggestion:{borderWidth:1,borderColor:C.line,backgroundColor:'#17171b',borderRadius:14,paddingHorizontal:15,paddingVertical:13,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 suggestionText:{color:'#d8d8df',fontSize:13},suggestionArrow:{color:C.muted,fontSize:16},
 messages:{flex:1},messageList:{paddingHorizontal:15,paddingTop:17,paddingBottom:18,gap:15},
 messageRow:{flexDirection:'row',alignItems:'flex-start',gap:9},userRow:{justifyContent:'flex-end'},assistantRow:{justifyContent:'flex-start'},
 avatar:{width:27,height:27,borderRadius:14,backgroundColor:'#26262c',alignItems:'center',justifyContent:'center',marginTop:3},
 avatarGlyph:{color:'#f5f5f6',fontSize:16},bubble:{maxWidth:'88%',borderRadius:18,paddingHorizontal:13,paddingVertical:10},
 userBubble:{backgroundColor:'#29292f',borderTopRightRadius:5},assistantBubble:{backgroundColor:'transparent',paddingHorizontal:1,maxWidth:'90%'},
 liveRow:{flexDirection:'row',gap:9,alignItems:'flex-start',paddingVertical:8},liveBubble:{flex:1,paddingRight:6},
 thinking:{paddingLeft:36,flexDirection:'row',alignItems:'center',gap:9,paddingVertical:10},thinkingText:{color:C.muted,fontSize:12},
 error:{color:'#f0a0a0',fontSize:11,marginTop:6},
 speechButton:{alignSelf:'flex-start',marginTop:5,paddingVertical:5,paddingHorizontal:9,borderRadius:14,backgroundColor:'#25252b'},speechButtonText:{color:'#c7d3eb',fontSize:10,fontWeight:'700'},
 stopSpeech:{backgroundColor:'#3a2929',borderRadius:14,paddingHorizontal:10,paddingVertical:6},stopSpeechText:{color:'#f0c2c2',fontSize:10,fontWeight:'700'},
 composerWrap:{paddingHorizontal:12,paddingTop:7,paddingBottom:8,backgroundColor:C.bg},
 modelStrip:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8,marginLeft:2},
 modelPill:{flexDirection:'row',alignItems:'center',gap:7,maxWidth:220,backgroundColor:'#242429',borderRadius:20,paddingHorizontal:12,paddingVertical:8},
 modelDot:{width:7,height:7,borderRadius:4,backgroundColor:'#53c99a'},modelText:{color:'#e5e5ea',fontSize:12,fontWeight:'600',flexShrink:1},modelChevron:{color:C.muted,fontSize:13},
 toolsPill:{borderWidth:1,borderColor:'#42424a',borderRadius:18,paddingHorizontal:12,paddingVertical:7},
 toolsPillActive:{backgroundColor:'#292930',borderColor:'#5b5b65'},toolsText:{color:C.muted,fontSize:11,fontWeight:'600'},toolsTextActive:{color:'#efeff3'},
 composer:{backgroundColor:'#202024',borderRadius:25,paddingHorizontal:13,paddingTop:12,paddingBottom:9,borderWidth:1,borderColor:'#2d2d33'},
 input:{color:C.text,fontSize:16,minHeight:38,maxHeight:125,paddingHorizontal:4,paddingTop:3,textAlignVertical:'top'},
 composerBottom:{flexDirection:'row',alignItems:'center',gap:10,marginTop:6},
 plusButton:{width:34,height:34,borderRadius:17,borderWidth:1,borderColor:'#64646d',alignItems:'center',justifyContent:'center'},
 plus:{color:'#f0f0f4',fontSize:23,lineHeight:26},inputHint:{color:'#7e7e88',fontSize:10,flex:1},
 sendButton:{width:37,height:37,borderRadius:19,backgroundColor:'#f0f0f2',alignItems:'center',justifyContent:'center'},
 sendDisabled:{backgroundColor:'#4b4b52'},sendArrow:{color:'#111',fontSize:24,fontWeight:'700',marginTop:-2},
 disclaimer:{textAlign:'center',color:'#707078',fontSize:10,paddingTop:7},
 modalShade:{flex:1,backgroundColor:'#000a',justifyContent:'flex-end'},actionSheet:{backgroundColor:'#1e1e22',borderTopLeftRadius:23,borderTopRightRadius:23,padding:19,paddingBottom:25},
 sheetTitle:{color:C.text,fontSize:18,fontWeight:'700',marginBottom:10},actionRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:11},
 actionIcon:{width:39,height:39,borderRadius:12,backgroundColor:'#2b2b32',alignItems:'center',justifyContent:'center'},
 actionGlyph:{color:'#ededf2',fontSize:18},actionLabel:{color:C.text,fontSize:13,fontWeight:'600'},actionDetail:{color:C.muted,fontSize:10,marginTop:3},actionArrow:{color:C.muted,fontSize:22},
});
