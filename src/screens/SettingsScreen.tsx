import React,{useEffect,useState}from'react';
import{Alert,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View}from'react-native';
import type{AppConfig}from'../types';
import{getComfyToken,getProviderKey,loadConfig,saveComfyToken,saveConfig,saveProviderKey}from'../services/storage';
const C={bg:'#101012',panel:'#1e1e22',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
type Props={onBack:()=>void;onSaved:(config:AppConfig)=>void};
export default function SettingsScreen({onBack,onSaved}:Props){
 const[config,setConfig]=useState<AppConfig|null>(null),[key,setKey]=useState(''),[comfyToken,setComfyToken]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{Promise.all([loadConfig(),getProviderKey(),getComfyToken()]).then(([c,k,t])=>{setConfig(c);setKey(k);setComfyToken(t);});},[]);
 const patch=(value:Partial<AppConfig>)=>setConfig(old=>old?{...old,...value}:old);
 const save=async()=>{if(!config)return;try{setSaving(true);await Promise.all([saveConfig(config),saveProviderKey(key),saveComfyToken(comfyToken)]);onSaved(config);Alert.alert('Saved','Your settings have been saved. API credentials are stored in Android secure storage.');}catch(e){Alert.alert('Could not save',e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
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
    <Text style={s.label}>Model identifier</Text><TextInput value={config.model} onChangeText={v=>patch({model:v})} placeholder="gpt-4o-mini" placeholderTextColor="#777" style={s.input}/>
    <Text style={s.label}>API key</Text><TextInput value={key} onChangeText={setKey} placeholder="Paste your API key" placeholderTextColor="#777" secureTextEntry style={s.input}/>
    <Text style={s.helper}>Compatible endpoints include OpenAI-compatible gateways, Ollama's OpenAI endpoint and self-hosted inference servers. Your key is stored using Android Keystore-backed secure storage.</Text>
   </>:<View style={s.info}><Text style={s.infoTitle}>Local model mode</Text><Text style={s.helper}>Install a GGUF model from Models. Pocket Buddy uses llama.cpp through llama.rn. Local inference can use substantial RAM, battery and storage; performance depends on your device and the selected model.</Text></View>}
   <Text style={[s.section,{marginTop:25}]}>BUILT-IN WEB TOOLS</Text>
   <View style={s.switchRow}><View style={{flex:1}}><Text style={s.text}>Enable web search</Text><Text style={s.helper}>Adds web search and webpage reading to the agent.</Text></View><Switch value={config.useWebSearch} onValueChange={v=>patch({useWebSearch:v})} trackColor={{true:'#64748b'}}/></View>
   <Text style={s.label}>SearXNG instance URL</Text><TextInput value={config.searxngUrl} onChangeText={v=>patch({searxngUrl:v})} placeholder="https://your-searxng.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.helper}>Use a SearXNG instance you operate or trust. Search requests go to this address. Web search is disabled until a URL is configured.</Text>
   <Text style={[s.section,{marginTop:25}]}>IMAGE & VIDEO GENERATION</Text>
   <Text style={s.label}>ComfyUI server URL</Text><TextInput value={config.comfyUrl} onChangeText={v=>patch({comfyUrl:v})} placeholder="https://your-comfyui-host.example" placeholderTextColor="#777" autoCapitalize="none" style={s.input}/>
   <Text style={s.label}>ComfyUI access token (optional)</Text><TextInput value={comfyToken} onChangeText={setComfyToken} placeholder="Reverse proxy bearer token" placeholderTextColor="#777" secureTextEntry style={s.input}/>
   <Text style={s.label}>Image workflow · API JSON</Text><TextInput value={config.imageWorkflow} onChangeText={v=>patch({imageWorkflow:v})} placeholder={'Paste API workflow JSON. Use {{prompt}} in the positive prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.label}>Video workflow · API JSON</Text><TextInput value={config.videoWorkflow} onChangeText={v=>patch({videoWorkflow:v})} placeholder={'Paste video API workflow JSON. Use {{prompt}} in the prompt input.'} placeholderTextColor="#777" multiline style={[s.input,s.multiline]}/>
   <Text style={s.helper}>The workflow, nodes, model weights, output dimensions, length and available compute determine generation. Pocket Buddy queues jobs independently from the chat model. Prefer HTTPS for remote access; plain HTTP is disabled in the Android app.</Text>
   <Text style={[s.section,{marginTop:25}]}>PRIVACY</Text>
   <View style={s.info}><Text style={s.infoTitle}>You choose where requests go</Text><Text style={s.helper}>Local prompts are processed on-device. API prompts go to the endpoint you set. Search goes to your SearXNG URL. MCP tool arguments go to the selected MCP server. ComfyUI prompts and workflows go to your configured server. Pocket Buddy has no hidden hosted inference service.</Text></View>
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},
 back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},
 title:{color:C.text,fontSize:17,fontWeight:'700'},save:{backgroundColor:'#ededf0',borderRadius:17,paddingHorizontal:17,paddingVertical:8},saveText:{color:'#111',fontWeight:'700'},
 content:{padding:18,paddingBottom:42},section:{color:'#d6d6dc',fontSize:12,fontWeight:'800',letterSpacing:1,marginBottom:12},
 modeRow:{flexDirection:'row',backgroundColor:C.panel,borderRadius:14,padding:4,marginBottom:14},mode:{flex:1,padding:11,alignItems:'center',borderRadius:11},
 modeActive:{backgroundColor:'#414149'},modeText:{color:C.muted,fontSize:12,fontWeight:'600'},modeTextActive:{color:C.text},
 label:{color:'#d1d1d8',fontSize:12,fontWeight:'700',marginTop:12,marginBottom:7},
 input:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,color:C.text,paddingHorizontal:12,paddingVertical:12,fontSize:13},
 multiline:{minHeight:120,textAlignVertical:'top'},helper:{color:'#878791',fontSize:11,lineHeight:17,marginTop:7},text:{color:C.text,fontSize:13,fontWeight:'600'},
 switchRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8},info:{backgroundColor:C.panel,borderRadius:14,padding:14,borderWidth:1,borderColor:C.line},
 infoTitle:{color:C.text,fontSize:13,fontWeight:'700',marginBottom:5},
});
