import React,{useEffect,useState}from'react';
import{Alert,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View}from'react-native';
import type{AppConfig}from'../types';
import{getComfyToken,getProviderKey,getVoiceKey,getHuggingFaceToken,loadConfig,saveComfyToken,saveConfig,saveProviderKey,saveVoiceKey,saveHuggingFaceToken}from'../services/storage';
import{testProviderConnection}from'../services/llm';
import{testMediaSetup}from'../services/media';
const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void;onSaved:(config:AppConfig)=>void};
export default function SettingsScreen({onBack,onSaved}:Props){
 const[config,setConfig]=useState<AppConfig|null>(null),[key,setKey]=useState(''),[comfyToken,setComfyToken]=useState(''),[voiceKey,setVoiceKey]=useState(''),[hfToken,setHfToken]=useState(''),[saving,setSaving]=useState(false),[testing,setTesting]=useState(false);
 useEffect(()=>{Promise.all([loadConfig(),getProviderKey(),getComfyToken(),getVoiceKey(),getHuggingFaceToken()]).then(([c,k,t,v,h])=>{setConfig(c);setKey(k);setComfyToken(t);setVoiceKey(v);setHfToken(h);});},[]);
 const patch=(value:Partial<AppConfig>)=>setConfig(old=>old?{...old,...value}:old);
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
    <Text style={s.helper}>Larger context uses more RAM. This runtime allocation cannot exceed a model's trained context limit or bypass its positional-encoding settings. Start at 4K on a modest phone and increase only if stable.</Text>
    <Text style={s.label}>GPU layer offload</Text><View style={s.choiceRow}>{[0,16,32,64,99].map(value=><Pressable key={value} onPress={()=>patch({nGpuLayers:value})} style={[s.choice,config.nGpuLayers===value&&s.choiceActive]}><Text style={[s.choiceText,config.nGpuLayers===value&&s.choiceTextActive]}>{value===0?'CPU':value===99?'Max':String(value)}</Text></Pressable>)}</View>
    <Text style={s.helper}>Android GPU acceleration is device and quantization dependent. llama.rn OpenCL support is limited to supported Qualcomm Adreno devices and Q4_0/Q6_K formats. A requested offload level does not guarantee it activated.</Text>
   </View>}
   <Text style={[s.section,{marginTop:25}]}>HUGGING FACE MODEL ACCESS</Text><Text style={s.label}>Read token (optional)</Text>
   <TextInput value={hfToken} onChangeText={setHfToken} placeholder="hf_… for gated models" placeholderTextColor="#777" secureTextEntry autoCapitalize="none" autoCorrect={false} style={s.input}/>
   <Text style={s.helper}>A read token lets you download models your account is permitted to access. It is stored securely and sent only to Hugging Face.</Text>
   <Text style={[s.section,{marginTop:25}]}>BUILT-IN WEB TOOLS</Text>
   <View style={s.switchRow}><View style={{flex:1}}><Text style={s.text}>Enable web search</Text><Text style={s.helper}>Adds web search and webpage reading to the agent.</Text></View><Switch value={config.useWebSearch} onValueChange={v=>patch({useWebSearch:v})} trackColor={{true:'#64748b'}}/></View>
   <Text style={s.label}>SearXNG instance URL</Text><TextInput value={config.searxngUrl} onChangeText={v=>patch({searxngUrl:v})} placeholder="https://your-searxng.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.helper}>Use a SearXNG instance you operate or trust. Search requests go to this address.</Text>
   <Text style={[s.section,{marginTop:25}]}>IMAGE & VIDEO GENERATION</Text><Text style={s.label}>ComfyUI server URL</Text>
   <TextInput value={config.comfyUrl} onChangeText={v=>patch({comfyUrl:v})} placeholder="https://your-comfyui-host.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.label}>ComfyUI access token (optional)</Text><TextInput value={comfyToken} onChangeText={setComfyToken} placeholder="Reverse proxy bearer token" placeholderTextColor="#777" secureTextEntry style={s.input}/>
   <Text style={s.label}>Image workflow · API JSON</Text><TextInput value={config.imageWorkflow} onChangeText={v=>patch({imageWorkflow:v})} placeholder={'Paste API workflow JSON. Use {{prompt}} in the positive prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.label}>Video workflow · API JSON</Text><TextInput value={config.videoWorkflow} onChangeText={v=>patch({videoWorkflow:v})} placeholder={'Paste video API workflow JSON. Use {{prompt}} in the prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.helper}>Generation depends on the configured workflow, model weights, nodes and available compute. ComfyUI runs separately; Pocket Buddy queues jobs and tracks status.</Text>
   <Pressable style={s.testButton} onPress={checkMedia} disabled={testing}><Text style={s.testButtonText}>{testing?'Checking server…':'Test media server & workflows'}</Text></Pressable>
   <Text style={[s.section,{marginTop:25}]}>VOICE OUTPUT</Text><Text style={s.label}>Neural voice API key (optional)</Text>
   <TextInput value={voiceKey} onChangeText={setVoiceKey} placeholder="Paste your voice provider API key" placeholderTextColor="#777" secureTextEntry style={s.input}/>
   <Text style={s.label}>Voice ID</Text><TextInput value={config.voiceId} onChangeText={v=>patch({voiceId:v})} placeholder="Your provider voice ID" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.label}>Speech model</Text><TextInput value={config.voiceModel} onChangeText={v=>patch({voiceModel:v})} placeholder="speech-model-id" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.helper}>Read aloud uses your phone's installed voice by default. With a voice key and voice ID, it can use the configured neural speech provider instead.</Text>
   <Text style={[s.section,{marginTop:25}]}>PRIVACY</Text>
   <View style={s.info}><Text style={s.infoTitle}>You choose where requests go</Text><Text style={s.helper}>Local prompts are processed on-device. API prompts go to the endpoint you set. Search goes to your SearXNG URL. MCP arguments go to the selected MCP server. ComfyUI prompts and workflows go to your configured server.</Text></View>
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},
 title:{color:C.text,fontSize:17,fontWeight:'700'},save:{backgroundColor:'#ededf0',borderRadius:17,paddingHorizontal:17,paddingVertical:8},saveText:{color:'#111',fontWeight:'700'},content:{padding:18,paddingBottom:42},section:{color:'#d6d6dc',fontSize:12,fontWeight:'800',letterSpacing:1,marginBottom:12},
 modeRow:{flexDirection:'row',backgroundColor:C.panel,borderRadius:14,padding:4,marginBottom:14},mode:{flex:1,padding:11,alignItems:'center',borderRadius:11},modeActive:{backgroundColor:'#414149'},modeText:{color:C.muted,fontSize:12,fontWeight:'600'},modeTextActive:{color:C.text},
 label:{color:'#d1d1d8',fontSize:12,fontWeight:'700',marginTop:12,marginBottom:7},input:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,color:C.text,paddingHorizontal:12,paddingVertical:12,fontSize:13},multiline:{minHeight:120,textAlignVertical:'top'},helper:{color:'#878791',fontSize:11,lineHeight:17,marginTop:7},text:{color:C.text,fontSize:13,fontWeight:'600'},switchRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8},info:{backgroundColor:C.panel,borderRadius:14,padding:14,borderWidth:1,borderColor:C.line},infoTitle:{color:C.text,fontSize:13,fontWeight:'700',marginBottom:5},
 choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:7},choice:{borderWidth:1,borderColor:C.line,backgroundColor:'#16161a',paddingHorizontal:13,paddingVertical:9,borderRadius:18},choiceActive:{backgroundColor:'#e7e7eb',borderColor:'#e7e7eb'},choiceText:{color:'#c5c5ce',fontSize:11,fontWeight:'700'},choiceTextActive:{color:'#111'},
 testButton:{backgroundColor:'#303039',borderRadius:12,padding:13,alignItems:'center',marginTop:12},testButtonText:{color:'#e8e8ee',fontSize:12,fontWeight:'700'},
});
