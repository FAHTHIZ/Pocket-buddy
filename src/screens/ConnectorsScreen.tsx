import React,{useMemo,useState}from'react';
import{Alert,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View}from'react-native';
import{getGitHubToken,loadMcpServers,removeMcpToken,saveGitHubToken,saveMcpServers,saveMcpToken,type McpServerConfig}from'../services/storage';
import{testMcpServer}from'../services/mcp';

const C={bg:'#101012',panel:'#1d1d21',line:'#34343b',text:'#f4f4f5',muted:'#a1a1aa'};
const CATALOG=[
 {name:'GitHub',category:'Developer tools',icon:'◉',kind:'github'},
 {name:'MCP server',category:'Agent tools',icon:'⌘',kind:'mcp'},
 {name:'SearXNG',category:'Web search',icon:'⌕',kind:'search'},
 {name:'ComfyUI',category:'Image and video',icon:'▧',kind:'media'},
 {name:'GitLab',category:'Developer tools',icon:'◆'},
 {name:'Bitbucket',category:'Developer tools',icon:'▣'},
 {name:'Confluence',category:'Knowledge',icon:'◈'},
 {name:'Dropbox',category:'Files',icon:'◇'},
 {name:'Google Drive',category:'Files',icon:'△'},
 {name:'DynamoDB',category:'Developer tools',icon:'▱'},
 {name:'Gmail',category:'Productivity',icon:'M'},
 {name:'Google Calendar',category:'Productivity',icon:'▦'},
 {name:'Google Docs',category:'Productivity',icon:'▤'},
 {name:'Notion',category:'Knowledge',icon:'N'},
 {name:'Slack',category:'Productivity',icon:'#'},
 {name:'Linear',category:'Productivity',icon:'↗'},
 {name:'Trello',category:'Productivity',icon:'▤'},
];
type Props={onBack:()=>void;onSettings:()=>void};
export default function ConnectorsScreen({onBack,onSettings}:Props){
 const[tab,setTab]=useState<'connectors'|'mcp'>('connectors'),[query,setQuery]=useState(''),[servers,setServers]=useState<McpServerConfig[]>([]);
 const[showGitHub,setShowGitHub]=useState(false),[showMcp,setShowMcp]=useState(false),[token,setToken]=useState('');
 const[name,setName]=useState(''),[url,setUrl]=useState(''),[mcpToken,setMcpTokenValue]=useState(''),[busy,setBusy]=useState(false),[githubConnected,setGithubConnected]=useState(false);
 React.useEffect(()=>{loadMcpServers().then(setServers);getGitHubToken().then(value=>setGithubConnected(!!value));},[]);
 const filtered=useMemo(()=>CATALOG.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())||item.category.toLowerCase().includes(query.toLowerCase())),[query]);
 const connectGitHub=async()=>{
  if(!token.trim())return Alert.alert('Token required','Paste a GitHub personal access token.');
  try{
   setBusy(true);
   const response=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+token.trim(),Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
   const data=await response.json();if(!response.ok)throw new Error(data.message||'GitHub authentication failed.');
   await saveGitHubToken(token);setGithubConnected(true);setShowGitHub(false);setToken('');
   Alert.alert('GitHub connected','Connected as '+(data.login||'your account')+'. Repository reads are enabled; issue creation always asks for confirmation.');
  }catch(e){Alert.alert('Could not connect',e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const disconnectGitHub=async()=>{await saveGitHubToken('');setGithubConnected(false);};
 const connectMcp=async()=>{
  if(!name.trim()||!url.trim())return Alert.alert('Missing details','Enter a server name and Streamable HTTP endpoint.');
  let parsed:URL;try{parsed=new URL(url.trim());}catch{return Alert.alert('Invalid URL','Enter a complete server URL.');}
  if(parsed.protocol!=='https:')return Alert.alert('HTTPS required','For security, Pocket Buddy accepts remote MCP endpoints over HTTPS only.');
  const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+Date.now().toString(36);
  const server:McpServerConfig={id,name:name.trim(),url:url.trim(),enabled:true};
  try{
   setBusy(true);await saveMcpToken(id,mcpToken);
   const tools=await testMcpServer(server),next=[...servers,server];
   await saveMcpServers(next);setServers(next);setShowMcp(false);setName('');setUrl('');setMcpTokenValue('');
   Alert.alert('MCP connected',server.name+' is connected. Discovered '+tools.length+' tools. Remote tools require approval each time.');
  }catch(e){await removeMcpToken(id);Alert.alert('Connection failed',e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const remove=async(id:string)=>{const next=servers.filter(item=>item.id!==id);await saveMcpServers(next);await removeMcpToken(id);setServers(next);};
 const act=(kind?:string)=>{if(kind==='github'){setToken('');setShowGitHub(true);return;}if(kind==='mcp'){setShowMcp(true);return;}if(kind==='search'||kind==='media')onSettings();};
 return <View style={s.root}>
  <View style={s.header}><Pressable onPress={onBack} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.title}>Connectors</Text><View style={{width:40}}/></View>
  <View style={s.tabs}>
   <Pressable style={[s.tab,tab==='connectors'&&s.activeTab]} onPress={()=>setTab('connectors')}><Text style={[s.tabText,tab==='connectors'&&s.activeTabText]}>Connectors</Text></Pressable>
   <Pressable style={[s.tab,tab==='mcp'&&s.activeTab]} onPress={()=>setTab('mcp')}><Text style={[s.tabText,tab==='mcp'&&s.activeTabText]}>MCP</Text></Pressable>
  </View>
  {tab==='connectors'?<ScrollView contentContainerStyle={s.content}>
   <Text style={s.section}>CONNECTED</Text>
   {githubConnected?<View style={s.connectedRow}><Text style={s.icon}>◉</Text><View style={{flex:1}}><Text style={s.rowName}>GitHub</Text><Text style={s.rowSub}>Personal access token saved securely</Text></View><Pressable onPress={disconnectGitHub}><Text style={s.remove}>Remove</Text></Pressable></View>:null}
   {servers.map(server=><View key={server.id} style={s.connectedRow}><Text style={s.icon}>⌘</Text><View style={{flex:1}}><Text style={s.rowName}>{server.name}</Text><Text style={s.rowSub} numberOfLines={1}>{server.url}</Text></View><Pressable onPress={()=>remove(server.id)}><Text style={s.remove}>Remove</Text></Pressable></View>)}
   {!githubConnected&&!servers.length?<Text style={s.empty}>Nothing connected yet. Connect a service to add its tools to your agent.</Text>:null}
   <Text style={[s.section,{marginTop:24}]}>ALL CONNECTORS</Text>
   {filtered.map(item=>{
    const connected=(item.kind==='github'&&githubConnected)||(item.kind==='mcp'&&servers.length>0);
    const action=item.kind?(connected?'Manage':(item.kind==='search'||item.kind==='media'?'Configure':'Connect')):'Coming soon';
    return <View key={item.name} style={s.item}>
     <View style={s.appIcon}><Text style={s.appGlyph}>{item.icon}</Text></View>
     <View style={{flex:1}}><Text style={s.rowName}>{item.name}</Text><Text style={s.rowSub}>{item.category}</Text></View>
     <Pressable disabled={!item.kind} style={[s.actionButton,(!item.kind||connected)&&s.actionMuted]} onPress={()=>act(item.kind)}><Text style={[s.actionText,(!item.kind||connected)&&s.actionTextMuted]}>{action}</Text></Pressable>
    </View>;
   })}
   <Text style={s.note}>OAuth-based connectors not yet implemented are marked Coming soon. MCP supports current and legacy Streamable HTTP. GitHub uses a user-supplied token with its own permissions.</Text>
  </ScrollView>:<ScrollView contentContainerStyle={s.content}>
   <Text style={s.section}>MODEL CONTEXT PROTOCOL</Text>
   <Text style={s.intro}>Connect MCP-compatible servers over Streamable HTTP. Pocket Buddy negotiates the current stateless protocol or falls back to legacy 2025 servers. Remote tool calls always require approval.</Text>
   {servers.map(server=><View key={server.id} style={s.connectedRow}><Text style={s.icon}>⌘</Text><View style={{flex:1}}><Text style={s.rowName}>{server.name}</Text><Text style={s.rowSub} numberOfLines={1}>{server.url}</Text></View><Pressable onPress={()=>remove(server.id)}><Text style={s.remove}>Remove</Text></Pressable></View>)}
   <Pressable style={s.addButton} onPress={()=>setShowMcp(true)}><Text style={s.addText}>＋  Add MCP server</Text></Pressable>
   <Text style={s.note}>Only connect servers you trust. Their tools may access remote services with the permissions granted to that server. Tokens are stored in Android secure storage.</Text>
  </ScrollView>}
  <View style={s.searchBar}><Text style={s.searchGlyph}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search connectors..." placeholderTextColor="#85858f" style={s.search}/></View>
  <Modal visible={showGitHub} transparent animationType="slide" onRequestClose={()=>setShowGitHub(false)}>
   <View style={s.modalShade}><View style={s.modal}>
    <Text style={s.modalTitle}>{githubConnected?'Update GitHub connection':'Connect GitHub'}</Text><Text style={s.modalHelp}>Paste a GitHub personal access token. Use minimum repository read permissions. Issue creation needs Issues: Read and write.</Text>
    <TextInput value={token} onChangeText={setToken} placeholder="github_pat_…" placeholderTextColor="#777" secureTextEntry autoCapitalize="none" style={s.field}/>
    <View style={s.modalActions}><Pressable onPress={()=>setShowGitHub(false)} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable><Pressable onPress={connectGitHub} disabled={busy} style={s.primary}><Text style={s.primaryText}>{busy?'Checking…':'Connect'}</Text></Pressable></View>
   </View></View>
  </Modal>
  <Modal visible={showMcp} transparent animationType="slide" onRequestClose={()=>setShowMcp(false)}>
   <View style={s.modalShade}><View style={s.modal}>
    <Text style={s.modalTitle}>Add MCP server</Text><Text style={s.modalHelp}>Connect an MCP Streamable HTTP endpoint over HTTPS.</Text>
    <TextInput value={name} onChangeText={setName} placeholder="Server name" placeholderTextColor="#777" style={s.field}/>
    <TextInput value={url} onChangeText={setUrl} placeholder="https://example.com/mcp" placeholderTextColor="#777" autoCapitalize="none" keyboardType="url" style={s.field}/>
    <TextInput value={mcpToken} onChangeText={setMcpTokenValue} placeholder="Bearer token (optional)" placeholderTextColor="#777" secureTextEntry style={s.field}/>
    <View style={s.modalActions}><Pressable onPress={()=>setShowMcp(false)} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable><Pressable onPress={connectMcp} disabled={busy} style={s.primary}><Text style={s.primaryText}>{busy?'Connecting…':'Test & connect'}</Text></Pressable></View>
   </View></View>
  </Modal>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomColor:'#25252b',borderBottomWidth:1},
 back:{width:40,height:40,borderRadius:20,backgroundColor:C.panel,alignItems:'center',justifyContent:'center'},backText:{color:C.text,fontSize:30,marginTop:-3},title:{color:C.text,fontSize:17,fontWeight:'700'},
 tabs:{flexDirection:'row',alignSelf:'center',backgroundColor:C.panel,borderRadius:23,padding:4,marginTop:15,marginBottom:6},
 tab:{paddingHorizontal:22,paddingVertical:9,borderRadius:19},activeTab:{backgroundColor:'#37373e'},tabText:{color:C.muted,fontSize:13,fontWeight:'600'},activeTabText:{color:C.text},
 content:{paddingHorizontal:18,paddingTop:15,paddingBottom:105},section:{color:'#d7d7dd',fontSize:12,fontWeight:'800',letterSpacing:1,marginBottom:12},
 empty:{color:C.muted,fontSize:12,lineHeight:18,padding:14,backgroundColor:C.panel,borderRadius:13},
 connectedRow:{flexDirection:'row',alignItems:'center',gap:11,padding:12,backgroundColor:'#2a2a30',borderRadius:16,marginBottom:8},
 icon:{color:'#eee',fontSize:21,width:25,textAlign:'center'},rowName:{color:C.text,fontSize:13,fontWeight:'600'},rowSub:{color:'#868691',fontSize:10,marginTop:3},
 remove:{color:'#f09a9a',fontSize:11,fontWeight:'700'},item:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:11},
 appIcon:{width:34,height:34,borderRadius:17,backgroundColor:'#29292f',alignItems:'center',justifyContent:'center'},appGlyph:{color:'#ddd',fontSize:17,fontWeight:'700'},
 actionButton:{backgroundColor:'#eeeef0',borderRadius:19,paddingHorizontal:17,paddingVertical:9},actionMuted:{backgroundColor:'#2a2a30'},actionText:{color:'#111',fontSize:11,fontWeight:'700'},actionTextMuted:{color:'#a1a1aa'},
 intro:{color:C.muted,fontSize:12,lineHeight:19,marginBottom:17},addButton:{borderWidth:1,borderColor:'#51515a',borderRadius:18,padding:13,alignItems:'center',marginTop:12},addText:{color:C.text,fontSize:13,fontWeight:'700'},
 note:{color:'#797983',fontSize:10,lineHeight:16,marginTop:18},searchBar:{position:'absolute',bottom:12,left:24,right:24,height:52,borderRadius:26,backgroundColor:'#242428',flexDirection:'row',alignItems:'center',paddingHorizontal:16},
 searchGlyph:{color:'#98a8c7',fontSize:23,marginRight:10},search:{flex:1,color:C.text,fontSize:14},
 modalShade:{flex:1,backgroundColor:'#000a',justifyContent:'flex-end'},modal:{backgroundColor:'#1f1f23',borderTopLeftRadius:22,borderTopRightRadius:22,padding:20,gap:10},
 modalTitle:{color:C.text,fontSize:18,fontWeight:'700'},modalHelp:{color:C.muted,fontSize:11,lineHeight:16},field:{backgroundColor:'#111115',borderWidth:1,borderColor:C.line,borderRadius:12,color:C.text,paddingHorizontal:12,paddingVertical:12,fontSize:13},
 modalActions:{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:10,marginTop:7},cancel:{paddingHorizontal:16,paddingVertical:10},cancelText:{color:C.muted,fontWeight:'600'},primary:{backgroundColor:'#eee',borderRadius:18,paddingHorizontal:19,paddingVertical:10},primaryText:{color:'#111',fontWeight:'700'},
});