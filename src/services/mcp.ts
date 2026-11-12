import{isPrivateComfyHost}from'./net';
import type{ToolDefinition}from'../types';
import{getMcpToken,loadMcpServers,type McpServerConfig}from'./storage';

type RpcPayload={result?:any;error?:{code?:number;message?:string;data?:any}};
type Connection={era:'modern'|'legacy';version:string;sessionId?:string};
type HeaderSpec={name:string;path:string[];type:'string'|'integer'|'boolean'};
const MODERN='2026-07-28';
const LEGACY='2025-11-25';
const VERSION_KEY='io.modelcontextprotocol/protocolVersion';
const INFO_KEY='io.modelcontextprotocol/clientInfo';
const CAPS_KEY='io.modelcontextprotocol/clientCapabilities';

class McpRequestError extends Error{
 status:number;
 payload?:RpcPayload;
 constructor(status:number,message:string,payload?:RpcPayload){
  super(message);this.name='McpRequestError';this.status=status;this.payload=payload;
 }
}
function shortHash(value:string):string{
 let hash=2166136261;
 for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
 return(hash>>>0).toString(36).padStart(7,'0');
}
function safeName(value:string,maxLength=40):string{
 const normalized=value.replace(/[^a-zA-Z0-9_-]/g,'_')||'tool';
 const suffix=shortHash(value),stemLength=Math.max(1,maxLength-suffix.length-1);
 return normalized.slice(0,stemLength)+'_'+suffix;
}
function serverAlias(id:string):string{return safeName(id,12);}
function toolAlias(name:string):string{return safeName(name,40);}
function isAscii(value:string):boolean{return /^[\x20-\x7E]*$/.test(value);}
function utf8Base64(value:string):string{
 const bytes:number[]=[];
 for(const character of value){
  const point=character.codePointAt(0)||0;
  if(point<=0x7f)bytes.push(point);
  else if(point<=0x7ff)bytes.push(0xc0|(point>>6),0x80|(point&0x3f));
  else if(point<=0xffff)bytes.push(0xe0|(point>>12),0x80|((point>>6)&0x3f),0x80|(point&0x3f));
  else bytes.push(0xf0|(point>>18),0x80|((point>>12)&0x3f),0x80|((point>>6)&0x3f),0x80|(point&0x3f));
 }
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let output='';
 for(let index=0;index<bytes.length;index+=3){
  const a=bytes[index],b=bytes[index+1],c=bytes[index+2];
  output+=alphabet[a>>2];
  output+=alphabet[((a&3)<<4)|(b===undefined?0:b>>4)];
  output+=b===undefined?'=':alphabet[((b&15)<<2)|(c===undefined?0:c>>6)];
  output+=c===undefined?'=':alphabet[c&63];
 }
 return output;
}
function encodedHeaderValue(value:string):string{
 const sentinel=value.startsWith('=?base64?')&&value.endsWith('?=');
 if(isAscii(value)&&value.trim()===value&&!sentinel)return value;
 return'=?base64?'+utf8Base64(value)+'?=';
}
function meta(version:string){return{[VERSION_KEY]:version,[INFO_KEY]:{name:'Pocket Buddy',version:'0.1.0'},[CAPS_KEY]:{}};}

function collectHeaderSpecs(schema:any):{valid:boolean;specs:HeaderSpec[]}{
 const specs:HeaderSpec[]=[],seen=new Set<string>();let valid=true;
 function inspect(node:any,isPropertySchema:boolean,canWalkProperties:boolean):void{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)inspect(item,false,false);return;}
  if(Object.prototype.hasOwnProperty.call(node,'x-mcp-header')&&!isPropertySchema)valid=false;
  for(const [key,value]of Object.entries(node)){
   if(key==='properties'&&canWalkProperties&&value&&typeof value==='object'&&!Array.isArray(value)){
    for(const child of Object.values(value))inspect(child,true,true);
   }else if(value&&typeof value==='object')inspect(value,false,false);
  }
 }
 inspect(schema,false,true);
 function collect(node:any,path:string[]):void{
  for(const [property,definition]of Object.entries(node?.properties||{})as Array<[string,any]>){
   const nextPath=[...path,property];
   if(Object.prototype.hasOwnProperty.call(definition||{},'x-mcp-header')){
    const name=definition?.['x-mcp-header'],type=definition?.type;
    const token=typeof name==='string'&&/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name);
    if(!token||!['string','integer','boolean'].includes(type)||seen.has(String(name).toLowerCase()))valid=false;
    else{seen.add(String(name).toLowerCase());specs.push({name,path:nextPath,type});}
   }
   if(definition?.properties)collect(definition,nextPath);
  }
 }
 collect(schema,[]);
 return{valid,specs};
}
function customParameterHeaders(schema:any,args:Record<string,unknown>):Record<string,string>{
 const collected=collectHeaderSpecs(schema);
 if(!collected.valid)throw new Error('The MCP tool contains an invalid x-mcp-header parameter definition.');
 const headers:Record<string,string>={};
 for(const spec of collected.specs){
  let value:unknown=args;
  for(const key of spec.path)value=value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined;
  if(value===undefined||value===null)continue;
  if(spec.type==='string'&&typeof value!=='string')throw new Error('MCP header parameter '+spec.name+' must be a string.');
  if(spec.type==='integer'&&(typeof value!=='number'||!Number.isSafeInteger(value)))throw new Error('MCP header parameter '+spec.name+' must be a safe integer.');
  if(spec.type==='boolean'&&typeof value!=='boolean')throw new Error('MCP header parameter '+spec.name+' must be a boolean.');
  headers['Mcp-Param-'+spec.name]=encodedHeaderValue(String(value));
 }
 return headers;
}
function parsePayload(raw:string,contentType:string):RpcPayload|undefined{
 if(!raw.trim())return undefined;
 if(contentType.includes('text/event-stream')||raw.trimStart().startsWith('data:')){
  const data=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean).pop();
  if(!data||data==='[DONE]')return undefined;
  return JSON.parse(data) as RpcPayload;
 }
 return JSON.parse(raw) as RpcPayload;
}
async function rpc(server:McpServerConfig,method:string,params:Record<string,unknown>={},connection?:Connection,argsForHeaders?:Record<string,unknown>,schemaForHeaders?:any):Promise<{payload?:RpcPayload;connection:Connection}>{
 const token=await getMcpToken(server.id),headers:Record<string,string>={Accept:'application/json, text/event-stream','Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const modern=connection?.era==='modern'||(!connection&&method==='server/discover'),version=connection?.version||(modern?MODERN:LEGACY);
 if(modern){
  headers['MCP-Protocol-Version']=version;headers['Mcp-Method']=method;
  if(method==='tools/call'&&typeof params.name==='string')headers['Mcp-Name']=encodedHeaderValue(params.name);
  if(argsForHeaders&&schemaForHeaders)Object.assign(headers,customParameterHeaders(schemaForHeaders,argsForHeaders));
 }else if(connection){
  if(connection.sessionId)headers['Mcp-Session-Id']=connection.sessionId;
  if(connection.version>='2025-06-18')headers['MCP-Protocol-Version']=connection.version;
 }
 const requestParams=modern?{...params,_meta:meta(version)}:params;
 const body:Record<string,unknown>={jsonrpc:'2.0',method,params:requestParams};
 if(!method.startsWith('notifications/'))body.id='pb-'+Date.now()+'-'+Math.floor(Math.random()*10000);
 let endpoint:URL;try{endpoint=new URL(server.url);}catch{throw new Error('MCP server '+server.name+' has an invalid URL.');}
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&isPrivateComfyHost(endpoint.hostname)))throw new Error('MCP server '+server.name+' must use HTTPS. Plain HTTP is allowed only for servers on your own Wi-Fi/LAN.');
 const response=await fetch(server.url,{method:'POST',headers,body:JSON.stringify(body)});
 if(response.status===202||response.status===204){
  return{connection:{era:connection?.era||(modern?'modern':'legacy'),version:connection?.version||version,sessionId:connection?.sessionId}};
 }
 const raw=await response.text();let payload:RpcPayload|undefined;
 try{payload=parsePayload(raw,response.headers.get('content-type')||'');}
 catch(error){
  if(!response.ok)throw new McpRequestError(response.status,'MCP server '+server.name+' returned HTTP '+response.status+'.');
  throw new Error('MCP server '+server.name+' returned an invalid JSON-RPC response: '+(error instanceof Error?error.message:String(error)));
 }
 if(!response.ok)throw new McpRequestError(response.status,payload?.error?.message||('MCP server '+server.name+' returned HTTP '+response.status),payload);
 if(payload?.error)throw new McpRequestError(response.status,payload.error.message||'MCP request failed.',payload);
 const next:Connection={era:connection?.era||(modern?'modern':'legacy'),version:connection?.version||version,sessionId:modern?undefined:(response.headers.get('Mcp-Session-Id')||connection?.sessionId)};
 return{payload,connection:next};
}
function versionsFromError(error:McpRequestError):string[]{
 const found=error.payload?.error?.data?.supported;
 return Array.isArray(found)?found.filter((value:any)=>typeof value==='string'):[];
}
function newestLegacyVersion(versions:string[]):string|undefined{
 return versions.filter(value=>/^2025-\d{2}-\d{2}$/.test(value)).sort().reverse()[0];
}
async function initializeLegacy(server:McpServerConfig,version:string):Promise<Connection>{
 const initialized=await rpc(server,'initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'Pocket Buddy',version:'0.1.0'}});
 const negotiated=initialized.payload?.result?.protocolVersion;
 const selected=typeof negotiated==='string'&&/^2025-\d{2}-\d{2}$/.test(negotiated)?negotiated:version;
 const legacy:Connection={era:'legacy',version:selected,sessionId:initialized.connection.sessionId};
 await rpc(server,'notifications/initialized',{},legacy);
 return legacy;
}
async function connect(server:McpServerConfig):Promise<Connection>{
 try{
  const found=await rpc(server,'server/discover',{}),supported=found.payload?.result?.supportedVersions;
  if(!Array.isArray(supported)||!supported.every((value:any)=>typeof value==='string'))throw new Error('MCP server '+server.name+' returned an invalid discovery response.');
  if(supported.includes(MODERN))return{era:'modern',version:MODERN};
  const legacyVersion=newestLegacyVersion(supported);
  if(legacyVersion)return initializeLegacy(server,legacyVersion);
  throw new Error('MCP server '+server.name+' supports no protocol version compatible with Pocket Buddy.');
 }catch(error){
  if(!(error instanceof McpRequestError))throw error;
  const code=error.payload?.error?.code;
  if(code===-32022){
   const supported=versionsFromError(error);
   if(supported.includes(MODERN))return{era:'modern',version:MODERN};
   const legacyVersion=newestLegacyVersion(supported);
   if(legacyVersion)return initializeLegacy(server,legacyVersion);
   throw new Error('MCP server '+server.name+' rejected protocol '+MODERN+' and advertised no compatible version.');
  }
  if(code===-32020||code===-32021)throw error;
  if(code===-32601||[400,404,405].includes(error.status))return initializeLegacy(server,LEGACY);
  throw error;
 }
}
async function listAllTools(server:McpServerConfig,connection:Connection):Promise<any[]>{
 const tools:any[]=[],seenCursors=new Set<string>();let cursor:string|undefined;
 for(let page=0;page<20&&tools.length<200;page++){
  const listed=await rpc(server,'tools/list',cursor?{cursor}:{},connection),result=listed.payload?.result||{};
  if(!Array.isArray(result.tools))break;
  tools.push(...result.tools.slice(0,200-tools.length));
  const next=result.nextCursor;
  if(typeof next!=='string'||!next||seenCursors.has(next))break;
  seenCursors.add(next);cursor=next;
 }
 return tools;
}
export async function listMcpTools():Promise<ToolDefinition[]>{
 const servers=(await loadMcpServers()).filter(item=>item.enabled),definitions:ToolDefinition[]=[];
 for(const server of servers){
  try{
   const connection=await connect(server),tools=await listAllTools(server,connection);
   for(const tool of tools){
    const name=String(tool.name||'');if(!name)continue;
    const headers=collectHeaderSpecs(tool.inputSchema);
    if(!headers.valid)continue;
    definitions.push({type:'function',function:{name:'mcp_'+serverAlias(server.id)+'__'+toolAlias(name),description:'['+server.name+'] '+String(tool.description||name).slice(0,450),parameters:tool.inputSchema||{type:'object',properties:{}}},requiresConfirmation:true});
   }
  }catch{/* Keep other connected tools available when this server is offline. */}
 }
 return definitions;
}
export async function callMcpTool(fullName:string,args:Record<string,unknown>):Promise<string>{
 if(!fullName.startsWith('mcp_'))throw new Error('Invalid MCP tool identifier.');
 const servers=(await loadMcpServers()).filter(item=>item.enabled),server=servers.find(item=>fullName.startsWith('mcp_'+serverAlias(item.id)+'__'));
 if(!server)throw new Error('This MCP server is no longer connected.');
 const prefix='mcp_'+serverAlias(server.id)+'__',alias=fullName.slice(prefix.length),connection=await connect(server);
 const tools=await listAllTools(server,connection),tool=tools.find((item:any)=>toolAlias(String(item.name))===alias);
 if(!tool)throw new Error('The MCP tool is no longer available.');
 const result=await rpc(server,'tools/call',{name:tool.name,arguments:args},connection,args,tool.inputSchema),payload=result.payload?.result;
 if(payload?.isError)throw new Error((payload.content||[]).map((item:any)=>item.text||'').join('\n')||'MCP tool failed.');
 if(payload?.resultType==='input_required')throw new Error('This MCP tool needs additional user input, but interactive MCP follow-up is not supported yet.');
 return(payload?.content||[]).map((item:any)=>item.text||'['+String(item.type||'content')+' result]').join('\n').slice(0,20000)||JSON.stringify(payload||{});
}
export async function testMcpServer(server:McpServerConfig):Promise<string[]>{
 const connection=await connect(server);
 return(await listAllTools(server,connection)).map((tool:any)=>String(tool.name));
}
