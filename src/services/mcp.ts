import type{ToolDefinition}from'../types';
import{getMcpToken,loadMcpServers,type McpServerConfig}from'./storage';

type RpcPayload={result?:any;error?:{code?:number;message?:string;data?:any}};
type Connection={era:'modern'|'legacy';version:string;sessionId?:string};
const MODERN='2026-07-28';
const LEGACY='2025-11-25';
const VERSION_KEY='io.modelcontextprotocol/protocolVersion';
const INFO_KEY='io.modelcontextprotocol/clientInfo';
const CAPS_KEY='io.modelcontextprotocol/clientCapabilities';

function safeName(value:string):string{return value.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,45);}
function isAscii(value:string):boolean{return /^[\x20-\x7E]+$/.test(value);}
function meta(version:string){return{[VERSION_KEY]:version,[INFO_KEY]:{name:'Pocket Buddy',version:'0.1.0'},[CAPS_KEY]:{}};}
function customParameterHeaders(schema:any,args:Record<string,unknown>):Record<string,string>{
 const headers:Record<string,string>={};
 for(const [name,definition]of Object.entries(schema?.properties||{}) as Array<[string,any]>){
  const header=definition?.['x-mcp-header'],value=args[name];
  if(typeof header!=='string'||!header||value===undefined||value===null)continue;
  if(!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(header)||!['string','integer','boolean'].includes(definition?.type))continue;
  const text=String(value);if(isAscii(text))headers['Mcp-Param-'+header]=text;
 }
 return headers;
}
async function rpc(server:McpServerConfig,method:string,params:Record<string,unknown>={},connection?:Connection,argsForHeaders?:Record<string,unknown>,schemaForHeaders?:any):Promise<{payload?:RpcPayload;connection:Connection}>{
 const token=await getMcpToken(server.id),headers:Record<string,string>={Accept:'application/json, text/event-stream','Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const modern=connection?.era==='modern'||(!connection&&method==='server/discover'),version=connection?.version||(modern?MODERN:LEGACY);
 if(modern){
  headers['MCP-Protocol-Version']=version;headers['Mcp-Method']=method;
  if(method==='tools/call'&&typeof params.name==='string'){
   if(!isAscii(params.name))throw new Error('This MCP tool name cannot safely be represented in an HTTP header.');
   headers['Mcp-Name']=params.name;
  }
  if(argsForHeaders&&schemaForHeaders)Object.assign(headers,customParameterHeaders(schemaForHeaders,argsForHeaders));
 }else if(connection){
  if(connection.sessionId)headers['Mcp-Session-Id']=connection.sessionId;
  if(connection.version>='2025-06-18')headers['MCP-Protocol-Version']=connection.version;
 }
 const requestParams=modern?{...params,_meta:meta(version)}:params;
 const body:Record<string,unknown>={jsonrpc:'2.0',method,params:requestParams};
 if(!method.startsWith('notifications/'))body.id='pb-'+Date.now()+'-'+Math.floor(Math.random()*10000);
 const response=await fetch(server.url,{method:'POST',headers,body:JSON.stringify(body)});
 if(!response.ok&&response.status!==202)throw new Error('MCP server '+server.name+' returned HTTP '+response.status);
 const next:Connection={era:connection?.era||(modern?'modern':'legacy'),version:connection?.version||version,sessionId:response.headers.get('Mcp-Session-Id')||connection?.sessionId};
 if(response.status===202||response.status===204)return{connection:next};
 const raw=await response.text();if(!raw.trim())return{connection:next};
 let payload:RpcPayload|undefined;
 if((response.headers.get('content-type')||'').includes('text/event-stream')||raw.trimStart().startsWith('data:')){
  const data=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean).pop();
  if(data&&data!=='[DONE]')payload=JSON.parse(data);
 }else payload=JSON.parse(raw);
 if(payload?.error)throw new Error(payload.error.message||'MCP request failed');
 return{payload,connection:next};
}
async function connect(server:McpServerConfig):Promise<Connection>{
 try{
  const found=await rpc(server,'server/discover',{}),supported=found.payload?.result?.supportedVersions;
  if(Array.isArray(supported)){
   if(supported.includes(MODERN))return{era:'modern',version:MODERN};
   const older=supported.filter((value:any)=>typeof value==='string'&&value.startsWith('2025-')).sort().reverse()[0];
   if(older){
    const initialized=await rpc(server,'initialize',{protocolVersion:older,capabilities:{},clientInfo:{name:'Pocket Buddy',version:'0.1.0'}});
    const version=initialized.payload?.result?.protocolVersion||older,legacy:Connection={era:'legacy',version,sessionId:initialized.connection.sessionId};
    await rpc(server,'notifications/initialized',{},legacy);return legacy;
   }
  }
 }catch{
  // Legacy 2025 servers do not implement server/discover.
 }
 const initialized=await rpc(server,'initialize',{protocolVersion:LEGACY,capabilities:{},clientInfo:{name:'Pocket Buddy',version:'0.1.0'}});
 const version=initialized.payload?.result?.protocolVersion||LEGACY,legacy:Connection={era:'legacy',version,sessionId:initialized.connection.sessionId};
 await rpc(server,'notifications/initialized',{},legacy);return legacy;
}
export async function listMcpTools():Promise<ToolDefinition[]>{
 const servers=(await loadMcpServers()).filter(item=>item.enabled),definitions:ToolDefinition[]=[];
 for(const server of servers){
  try{
   const connection=await connect(server),listed=await rpc(server,'tools/list',{},connection);
   for(const tool of listed.payload?.result?.tools||[]){
    const name=String(tool.name||'');if(!name)continue;
    definitions.push({type:'function',function:{name:'mcp_'+safeName(server.id)+'__'+safeName(name),description:'['+server.name+'] '+String(tool.description||name).slice(0,450),parameters:tool.inputSchema||{type:'object',properties:{}}},requiresConfirmation:true});
   }
  }catch{/* Keep other connected tools available when this server is offline. */}
 }
 return definitions;
}
export async function callMcpTool(fullName:string,args:Record<string,unknown>):Promise<string>{
 if(!fullName.startsWith('mcp_'))throw new Error('Invalid MCP tool identifier.');
 const servers=(await loadMcpServers()).filter(item=>item.enabled),server=servers.find(item=>fullName.startsWith('mcp_'+safeName(item.id)+'__'));
 if(!server)throw new Error('This MCP server is no longer connected.');
 const alias=fullName.slice(('mcp_'+safeName(server.id)+'__').length),connection=await connect(server);
 const listed=await rpc(server,'tools/list',{},connection),tool=(listed.payload?.result?.tools||[]).find((item:any)=>safeName(String(item.name))===alias);
 if(!tool)throw new Error('The MCP tool is no longer available.');
 const result=await rpc(server,'tools/call',{name:tool.name,arguments:args},connection,args,tool.inputSchema),payload=result.payload?.result;
 if(payload?.isError)throw new Error((payload.content||[]).map((item:any)=>item.text||'').join('\n')||'MCP tool failed.');
 return(payload?.content||[]).map((item:any)=>item.text||'['+String(item.type||'content')+' result]').join('\n').slice(0,20000)||JSON.stringify(payload||{});
}
export async function testMcpServer(server:McpServerConfig):Promise<string[]>{
 const connection=await connect(server),listed=await rpc(server,'tools/list',{},connection);
 return(listed.payload?.result?.tools||[]).map((tool:any)=>String(tool.name));
}