import React,{useEffect,useState}from'react';
import{ActivityIndicator,Alert,Linking,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View}from'react-native';
import type{AppConfig}from'../types';
import{getComfyToken,getProviderKey,getVoiceKey,getHuggingFaceToken,loadConfig,saveComfyToken,saveConfig,saveProviderKey,saveVoiceKey,saveHuggingFaceToken,getPollinationsKey,savePollinationsKey}from'../services/storage';
import{getPollinationsAccount,pollPollinationsSignIn,startPollinationsSignIn,verifyPollinationsKey,POLLINATIONS_KEYS_URL,POLLINATIONS_VOICES,type DeviceSignIn}from'../services/pollinations';
import{useMediaModels}from'../components/MediaViews';
import{testProviderConnection}from'../services/llm';
import{testMediaSetup}from'../services/media';
const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void;onSaved:(config:AppConfig)=>void};
export default function SettingsScreen({onBack,onSaved}:Props){
 const[config,setConfig]=useState<AppConfig|null>(null),[key,setKey]=useState(''),[comfyToken,setComfyToken]=useState(''),[voiceKey,setVoiceKey]=useState(''),[hfToken,setHfToken]=useState(''),[saving,setSaving]=useState(false),[testing,setTesting]=useState(false);
 useEffect(()=>{Promise.all([loadConfig(),getProviderKey(),getComfyToken(),getVoiceKey(),getHuggingFaceToken()]).then(([c,k,t,v,h])=>{setConfig(c);setKey(k);setComfyToken(t);setVoiceKey(v);setHfToken(h);});},[]);
 const patch=(value:Partial<AppConfig>)=>setConfig(old=>old?{...old,...value}:old);
 const models=useMediaModels();
 const[pollKey,setPollKey]=useState(''),[pollAccount,setPollAccount]=useState(''),[pasteKey,setPasteKey]=useState(''),[signIn,setSignIn]=useState<DeviceSignIn|null>(null),[pollBusy,setPollBusy]=useState(false);
 const signInRef=React.useRef<DeviceSignIn|null>(null);
 const describeAccount=(key:string)=>{getPollinationsAccount(key).then(account=>setPollAccount((account.name||"Connected")+(typeof account.balance==='number'?' · '+account.balance.toFixed(2)+' pollen':''))).catch(()=>setPollAccount('Connected'));};
 useEffect(()=>{getPollinationsKey().then(key=>{setPollKey(key);if(key)describeAccount(key);}).catch(()=>{});return()=>{signInRef.current=null;};},[]);
 const finishKey=async(key:string)=>{await savePollinationsKey(key);setPollKey(key);setSignIn(null);signInRef.current=null;setPasteKey('');describeAccount(key);Alert.alert('Pollinations connected','Video, music, speech and faster images are ready. Paid models use pollen from your Pollinations balance.');};
 const connectPollinations=async()=>{
  try{
   setPollBusy(true);const session=await startPollinationsSignIn();setSignIn(session);signInRef.current=session;
   Linking.openURL(session.verificationUrl).catch(()=>{});
   while(signInRef.current===session&&Date.now()<session.expiresAt){
    await new Promise<void>(resolve=>setTimeout(()=>resolve(),Math.max(3,session.interval)*1000));
    if(signInRef.current!==session)return;
    const key=await pollPollinationsSignIn(session.deviceCode).catch(error=>{throw error;});
    if(key){await finishKey(key);return;}
   }
   if(signInRef.current===session){setSignIn(null);Alert.alert('Sign-in expired','Tap Connect Pollinations to try again.');}
  }catch(error){setSignIn(null);signInRef.current=null;Alert.alert('Could not connect Pollinations',error instanceof Error?error.message:String(error));}
  finally{setPollBusy(false);}
 };
 const usePastedKey=async()=>{const key=pasteKey.trim();if(!key)return;try{setPollBusy(true);await verifyPollinationsKey(key);await finishKey(key);}catch(error){Alert.alert('Key not accepted',error instanceof Error?error.message:String(error));}finally{setPollBusy(false);}};
 const disconnect=()=>Alert.alert('Disconnect Pollinations?','Video and music will stop working until you connect again. Free images keep working.',[{text:'Cancel',style:'cancel'},{text:'Disconnect',style:'destructive',onPress:async()=>{await savePollinationsKey('');setPollKey('');setPollAccount('');}}]);
 const modelChoices=(kind:'image'|'video'|'audio',style?:string)=>models.filter(item=>item.kind===kind&&(!style||item.audioStyle===style));
 const save=async()=>{if(!config)return;try{setSaving(true);await Promise.all([saveConfig(config),saveProviderKey(key),saveComfyToken(comfyToken),saveVoiceKey(voiceKey),saveHuggingFaceToken(hfToken)]);onSaved(config);Alert.alert('Saved','Your settings and credentials have been saved. Credentials are stored in Android secure storage.');}catch(e){Alert.alert('Could not save',e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
 const testApi=async()=>{try{if(!config)return;setTesting(true);await saveConfig(config);await saveProviderKey(key);const result=await testProviderConnection();Alert.alert('Provider connected',result);}catch(error){Alert.alert('Provider test failed',error instanceof Error?error.message:String(error));}finally{setTesting(false);}};
 const checkMedia=async()=>{try{if(!config)return;setTesting(true);await saveConfig(config);await saveComfyToken(comfyToken);const report=await testMediaSetup();Alert.alert('Media setup check',report.join('\n\n'));}catch(error){Alert.alert('Media setup check failed',error instanceof Error?error.message:String(error));}finally{setTesting(false);}};
 if(!config)return <View style={s.root}><Text style={s.text}>Loading settings…</Text></View>;
 return <View style={s.root}>
  <View style={s.header}><Pressable onPress={onBack} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.title}>Settings</Text><Pressable style={s.save} onPress={save}><Text style={s.saveText}>{saving?'Saving…':'Save'}</Text></Pressable></View>
  <ScrollView contentContainerStyle={s.content}>
   <Text style={s.section}>MODEL PROVIDER</Text>
   <View style={s.modeRow}>
    <Pressable style={[s.mode,config.mode==='local'&&s.modeActive]} onPress={()=>patch({mode:'local'})}><Text style={[s.modeText,config.mode==='local'&&s.modeTextActive]}>On-device</Text></Pressable>
    <Pressable style={[s.mode,config.mode==='api'&&s.modeActive]} onPress={()=>patch({mode:'api'})}><Text style={[s.modeText,config.mode==='api'&&s.modeTextActive]}>API provider</Text></Pressable>
   </View>
   {config.mode==='api'?<>
    <Text style={s.label}>OpenAI-compatible API base URL</Text><TextInput value={config.baseUrl} onChangeText={v=>patch({baseUrl:v})} placeholder="https://api.openai.com/v1" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
    <Text style={s.label}>Model identifier</Text><TextInput value={config.model} onChangeText={v=>patch({model:v})} placeholder="model-name" placeholderTextColor="#777" style={s.input}/>
    <Text style={s.label}>API key (optional for unauthenticated endpoints)</Text><TextInput value={key} onChangeText={setKey} placeholder="Paste your API key, if required" placeholderTextColor="#777" secureTextEntry style={s.input}/>
    <Text style={s.helper}>Use an HTTPS OpenAI-compatible endpoint. Self-hosted endpoints that do not require authentication may leave the key blank. Your key is stored using Android secure storage.</Text>
    <Pressable style={s.testButton} onPress={testApi} disabled={testing}><Text style={s.testButtonText}>{testing?'Testing connection…':'Test API connection'}</Text></Pressable>
   </>:<View style={s.info}>
    <Text style={s.infoTitle}>Local model mode</Text><Text style={s.helper}>Install a GGUF model from Models. Pocket Buddy uses llama.cpp through llama.rn. Runtime memory depends on model, context and quantization.</Text>
    <Text style={s.label}>Context window</Text><View style={s.choiceRow}>{[2048,4096,8192,16384].map(value=><Pressable key={value} onPress={()=>patch({nCtx:value})} style={[s.choice,config.nCtx===value&&s.choiceActive]}><Text style={[s.choiceText,config.nCtx===value&&s.choiceTextActive]}>{(value/1024)+'K'}</Text></Pressable>)}</View>
    <Text style={s.helper}>Larger context uses more RAM. Start at 2K on a 4 GB phone; try 4K on a 6 GB phone only if it remains stable.</Text>
    <Text style={s.label}>GPU layer offload</Text><View style={s.choiceRow}>{[0,16,32,64,99].map(value=><Pressable key={value} onPress={()=>patch({nGpuLayers:value})} style={[s.choice,config.nGpuLayers===value&&s.choiceActive]}><Text style={[s.choiceText,config.nGpuLayers===value&&s.choiceTextActive]}>{value===0?'CPU':value===99?'Max':String(value)}</Text></Pressable>)}</View>
    <Text style={s.helper}>Android GPU acceleration is device and quantization dependent. llama.rn OpenCL support is limited to supported Qualcomm Adreno devices and Q4_0/Q6_K formats. A requested offload level does not guarantee it activated.</Text>
   </View>}
   <Text style={[s.section,{marginTop:25}]}>MEDIA CREATION</Text>
   <View style={s.modeRow}>
    <Pressable style={[s.mode,config.mediaEngine==='pollinations'&&s.modeActive]} onPress={()=>patch({mediaEngine:'pollinations'})}><Text style={[s.modeText,config.mediaEngine==='pollinations'&&s.modeTextActive]}>Built-in (Pollinations)</Text></Pressable>
    <Pressable style={[s.mode,config.mediaEngine==='comfyui'&&s.modeActive]} onPress={()=>patch({mediaEngine:'comfyui'})}><Text style={[s.modeText,config.mediaEngine==='comfyui'&&s.modeTextActive]}>My ComfyUI server</Text></Pressable>
   </View>
   {config.mediaEngine==='pollinations'?<View style={s.info}>
    <Text style={s.infoTitle}>{pollKey?'Pollinations connected':'Pollinations not connected'}</Text>
    <Text style={s.helper}>{pollKey?(pollAccount||'Checking account…'):'Images already work without an account (about one every 45 seconds). Connect a free Pollinations account for fast parallel images, speech, and pay-as-you-go video and music.'}</Text>
    {signIn?<View style={s.codeBox}><Text style={s.helper}>Approve Pocket Buddy in the browser. If asked, enter this code:</Text><Text style={s.code}>{signIn.userCode}</Text><View style={{flexDirection:'row',gap:8,alignItems:'center'}}><ActivityIndicator color="#9fc0ff" size="small"/><Text style={s.helper}>Waiting for approval…</Text></View>
     <Pressable style={s.testButton} onPress={()=>Linking.openURL(signIn.verificationUrl).catch(()=>{})}><Text style={s.testButtonText}>Open sign-in page again</Text></Pressable>
     <Pressable style={s.linkButton} onPress={()=>{signInRef.current=null;setSignIn(null);}}><Text style={s.linkText}>Cancel</Text></Pressable></View>:null}
    {!signIn&&!pollKey?<Pressable style={s.primaryButton} onPress={connectPollinations} disabled={pollBusy}><Text style={s.primaryButtonText}>{pollBusy?'Connecting…':'Connect Pollinations'}</Text></Pressable>:null}
    {pollKey&&!signIn?<View style={{flexDirection:'row',gap:8}}><Pressable style={[s.testButton,{flex:1}]} onPress={connectPollinations}><Text style={s.testButtonText}>Reconnect</Text></Pressable><Pressable style={[s.testButton,{flex:1}]} onPress={disconnect}><Text style={s.testButtonText}>Disconnect</Text></Pressable></View>:null}
    <Text style={s.label}>Or paste a Pollinations key</Text>
    <View style={{flexDirection:'row',gap:8}}><TextInput value={pasteKey} onChangeText={setPasteKey} placeholder="sk_…" placeholderTextColor="#777" secureTextEntry autoCapitalize="none" autoCorrect={false} style={[s.input,{flex:1}]}/><Pressable style={s.pasteButton} onPress={usePastedKey} disabled={pollBusy}><Text style={s.testButtonText}>Use</Text></Pressable></View>
    <Pressable style={s.linkButton} onPress={()=>Linking.openURL(POLLINATIONS_KEYS_URL).catch(()=>{})}><Text style={s.linkText}>Manage keys and pollen at enter.pollinations.ai →</Text></Pressable>
   </View>:<Text style={s.helper}>Pocket Buddy will queue jobs on the ComfyUI server configured further below.</Text>}
   {config.mediaEngine==='pollinations'?<>
    <ModelPicker label="Default image model" value={config.imageModel} options={modelChoices('image')} onPick={v=>patch({imageModel:v})}/>
    <Text style={s.label}>Default image shape</Text><View style={s.choiceRow}>{(['square','portrait','landscape'] as const).map(value=><Pressable key={value} onPress={()=>patch({imageShape:value})} style={[s.choice,config.imageShape===value&&s.choiceActive]}><Text style={[s.choiceText,config.imageShape===value&&s.choiceTextActive]}>{value}</Text></Pressable>)}</View>
    <ModelPicker label="Default video model" value={config.videoModel} options={modelChoices('video')} onPick={v=>{const model=models.find(item=>item.id===v);patch({videoModel:v,...(model?.durations?.length&&!model.durations.includes(config.videoDuration)?{videoDuration:model.durations[0]}:{})});}}/>
    <View style={s.switchRow}><View style={{flex:1}}><Text style={s.text}>Video with sound</Text><Text style={s.helper}>Used by models that can generate audio (e.g. Veo).</Text></View><Switch value={config.videoAudio} onValueChange={v=>patch({videoAudio:v})} trackColor={{true:'#64748b'}}/></View>
    <ModelPicker label="Default music model" value={config.musicModel} options={modelChoices('audio','music')} onPick={v=>patch({musicModel:v})}/>
    <ModelPicker label="Default speech model" value={config.speechModel} options={modelChoices('audio','speech')} onPick={v=>patch({speechModel:v})}/>
    <Text style={s.label}>Speech voice</Text><View style={s.choiceRow}>{POLLINATIONS_VOICES.map(value=><Pressable key={value} onPress={()=>patch({mediaVoice:value})} style={[s.choice,config.mediaVoice===value&&s.choiceActive]}><Text style={[s.choiceText,config.mediaVoice===value&&s.choiceTextActive]}>{value}</Text></Pressable>)}</View>
    <ModelPicker label="Default sound-effect model" value={config.sfxModel} options={modelChoices('audio','sfx')} onPick={v=>patch({sfxModel:v})}/>
    <Text style={s.helper}>Free models cost nothing. Paid models (all video and music) use pollen from your Pollinations balance. Tap Save at the top to keep your defaults.</Text>
   </>:null}
   <Text style={[s.section,{marginTop:25}]}>HUGGING FACE MODEL ACCESS</Text><Text style={s.label}>Read token (optional)</Text>
   <TextInput value={hfToken} onChangeText={setHfToken} placeholder="hf_… for gated models" placeholderTextColor="#777" secureTextEntry autoCapitalize="none" autoCorrect={false} style={s.input}/>
   <Text style={s.helper}>A read token lets you download models your account is permitted to access. It is stored securely and sent only to Hugging Face.</Text>
   <Text style={[s.section,{marginTop:25}]}>BUILT-IN WEB TOOLS</Text>
   <View style={s.switchRow}><View style={{flex:1}}><Text style={s.text}>Enable web search</Text><Text style={s.helper}>Adds web search and webpage reading to the agent.</Text></View><Switch value={config.useWebSearch} onValueChange={v=>patch({useWebSearch:v})} trackColor={{true:'#64748b'}}/></View>
   <Text style={s.label}>SearXNG instance URL</Text><TextInput value={config.searxngUrl} onChangeText={v=>patch({searxngUrl:v})} placeholder="https://your-searxng.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.helper}>Use a SearXNG instance you operate or trust. Search requests go to this address.</Text>
   <Text style={[s.section,{marginTop:25}]}>COMFYUI (ADVANCED)</Text><Text style={s.label}>ComfyUI server URL</Text>
   <TextInput value={config.comfyUrl} onChangeText={v=>patch({comfyUrl:v})} placeholder="https://your-comfyui-host.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.label}>ComfyUI access token (optional)</Text><TextInput value={comfyToken} onChangeText={setComfyToken} placeholder="Reverse proxy bearer token" placeholderTextColor="#777" secureTextEntry style={s.input}/>
   <Text style={s.label}>Image workflow · API JSON</Text><TextInput value={config.imageWorkflow} onChangeText={v=>patch({imageWorkflow:v})} placeholder={'Paste API workflow JSON. Use {{prompt}} in the positive prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.label}>Video workflow · API JSON</Text><TextInput value={config.videoWorkflow} onChangeText={v=>patch({videoWorkflow:v})} placeholder={'Paste video API workflow JSON. Use {{prompt}} in the prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.label}>Audio workflow · API JSON</Text><TextInput value={config.audioWorkflow} onChangeText={v=>patch({audioWorkflow:v})} placeholder={'Paste audio API workflow JSON. Use {{prompt}} in the text/prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.helper}>Generation depends on the configured workflow, model weights, nodes and available compute. ComfyUI runs separately; Pocket Buddy queues jobs and tracks status.</Text>
   <Pressable style={s.testButton} onPress={checkMedia} disabled={testing}><Text style={s.testButtonText}>{testing?'Checking server…':'Test media server & workflows'}</Text></Pressable>
   <Text style={[s.section,{marginTop:25}]}>VOICE INPUT</Text>
   <Text style={s.helper}>Use the microphone button in chat to dictate a message. Pocket Buddy requests offline recognition from Android where supported, but offline availability and language support depend on the speech service installed on this device. Review that provider's privacy settings.</Text>
   <Text style={[s.section,{marginTop:25}]}>VOICE OUTPUT</Text><Text style={s.label}>Neural voice API key (optional)</Text>
   <TextInput value={voiceKey} onChangeText={setVoiceKey} placeholder="Paste your voice provider API key" placeholderTextColor="#777" secureTextEntry style={s.input}/>
   <Text style={s.label}>Voice ID</Text><TextInput value={config.voiceId} onChangeText={v=>patch({voiceId:v})} placeholder="Your provider voice ID" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.label}>Speech model</Text><TextInput value={config.voiceModel} onChangeText={v=>patch({voiceModel:v})} placeholder="speech-model-id" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.helper}>Read aloud uses your phone's installed voice by default. With a voice key and voice ID, it can use the configured neural speech provider instead.</Text>
   <Text style={[s.section,{marginTop:25}]}>PERSONAL ASSISTANT</Text>
   <Text style={s.label}>Assistant name</Text>
   <TextInput value={config.assistantName} onChangeText={v=>patch({assistantName:v})} placeholder="Pocket Buddy" placeholderTextColor="#777" style={s.input}/>
   <Text style={s.label}>Personality and instructions</Text>
   <TextInput value={config.systemPrompt} onChangeText={v=>patch({systemPrompt:v})} placeholder="Describe how your assistant should respond, what it should prioritize, and any preferences to follow." placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.helper}>These instructions are included with each conversation. Keep them concise; long instructions use part of the model context window.</Text>
   <Text style={[s.section,{marginTop:25}]}>PRIVACY</Text>
   <View style={s.info}><Text style={s.infoTitle}>You choose where requests go</Text><Text style={s.helper}>Local prompts are processed on-device. API prompts go to the endpoint you set. Search goes to your SearXNG URL. MCP arguments go to the selected MCP server. Media prompts go to Pollinations (built-in engine) or your ComfyUI server.</Text></View>
  </ScrollView>
 </View>;
}
function ModelPicker({label,value,options,onPick}:{label:string;value:string;options:{id:string;title:string;paid:boolean}[];onPick:(value:string)=>void}){
 const[open,setOpen]=useState(false);const current=options.find(item=>item.id===value);
 return <View><Text style={s.label}>{label}</Text>
  <Pressable style={s.picker} onPress={()=>setOpen(v=>!v)}><Text style={s.pickerText} numberOfLines={1}>{current?current.title+(current.paid?' · Paid':' · Free'):value}</Text><Text style={s.pickerText}>{open?'⌃':'⌄'}</Text></Pressable>
  {open?options.map(item=><Pressable key={item.id} style={[s.pickerRow,item.id===value&&s.pickerRowActive]} onPress={()=>{onPick(item.id);setOpen(false);}}><Text style={s.pickerRowText} numberOfLines={1}>{item.title}</Text><Text style={[s.pickerBadge,item.paid?{color:'#f0c88a'}:{color:'#8fe0b5'}]}>{item.paid?'Paid':'Free'}</Text></Pressable>):null}
 </View>;
}
const s=StyleSheet.create({
 picker:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:12,paddingVertical:12,gap:8},pickerText:{color:C.text,fontSize:13,flexShrink:1},
 pickerRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:'#26262c'},pickerRowActive:{backgroundColor:'#22293a'},pickerRowText:{color:'#ddd',fontSize:12,flex:1},pickerBadge:{fontSize:10,fontWeight:'800',marginLeft:8},
 codeBox:{marginTop:10,padding:12,borderRadius:12,backgroundColor:'#16161a',borderWidth:1,borderColor:'#3d4b6b'},code:{color:'#fff',fontSize:26,fontWeight:'800',letterSpacing:4,textAlign:'center',marginVertical:10},
 primaryButton:{backgroundColor:'#f0f0f2',borderRadius:13,padding:13,alignItems:'center',marginTop:12},primaryButtonText:{color:'#111',fontSize:13,fontWeight:'800'},
 pasteButton:{backgroundColor:'#303039',borderRadius:12,paddingHorizontal:16,justifyContent:'center'},linkButton:{paddingVertical:10,alignItems:'center'},linkText:{color:'#b9c9e8',fontSize:11,fontWeight:'700'},
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},
 title:{color:C.text,fontSize:17,fontWeight:'700'},save:{backgroundColor:'#ededf0',borderRadius:17,paddingHorizontal:17,paddingVertical:8},saveText:{color:'#111',fontWeight:'700'},content:{padding:18,paddingBottom:42},section:{color:'#d6d6dc',fontSize:12,fontWeight:'800',letterSpacing:1,marginBottom:12},
 modeRow:{flexDirection:'row',backgroundColor:C.panel,borderRadius:14,padding:4,marginBottom:14},mode:{flex:1,padding:11,alignItems:'center',borderRadius:11},modeActive:{backgroundColor:'#414149'},modeText:{color:C.muted,fontSize:12,fontWeight:'600'},modeTextActive:{color:C.text},
 label:{color:'#d1d1d8',fontSize:12,fontWeight:'700',marginTop:12,marginBottom:7},input:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,color:C.text,paddingHorizontal:12,paddingVertical:12,fontSize:13},multiline:{minHeight:120,textAlignVertical:'top'},helper:{color:'#878791',fontSize:11,lineHeight:17,marginTop:7},text:{color:C.text,fontSize:13,fontWeight:'600'},switchRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8},info:{backgroundColor:C.panel,borderRadius:14,padding:14,borderWidth:1,borderColor:C.line},infoTitle:{color:C.text,fontSize:13,fontWeight:'700',marginBottom:5},
 choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:7},choice:{borderWidth:1,borderColor:C.line,backgroundColor:'#16161a',paddingHorizontal:13,paddingVertical:9,borderRadius:18},choiceActive:{backgroundColor:'#e7e7eb',borderColor:'#e7e7eb'},choiceText:{color:'#c5c5ce',fontSize:11,fontWeight:'700'},choiceTextActive:{color:'#111'},
 testButton:{backgroundColor:'#303039',borderRadius:12,padding:13,alignItems:'center',marginTop:12},testButtonText:{color:'#e8e8ee',fontSize:12,fontWeight:'700'},
});
