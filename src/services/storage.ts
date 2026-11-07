import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {AppConfig,McpServerConfig} from '../types';
export type{McpServerConfig}from'../types';
const SETTINGS_KEY='pocket-buddy.settings.v1';
const SERVICES={provider:'pocket-buddy.provider',github:'pocket-buddy.github',comfy:'pocket-buddy.comfy',voice:'pocket-buddy.voice',huggingFace:'pocket-buddy.huggingface'};
const MCP_PREFIX='pocket-buddy.mcp.';
const MCP_CONFIG_KEY='pocket-buddy.mcp-servers.v1';
export const DEFAULT_CONFIG:AppConfig={mode:'local',baseUrl:'',model:'',temperature:0.7,maxToolTurns:6,useWebSearch:false,searxngUrl:'',comfyUrl:'',imageWorkflow:'',videoWorkflow:'',voiceId:'',voiceModel:'eleven_multilingual_v2',nCtx:4096,nGpuLayers:0};
export async function loadConfig():Promise<AppConfig>{
 try{
  const raw=await AsyncStorage.getItem(SETTINGS_KEY);if(!raw)return DEFAULT_CONFIG;
  const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return DEFAULT_CONFIG;
  return{...DEFAULT_CONFIG,...parsed,nCtx:[2048,4096,8192,16384].includes(Number(parsed.nCtx))?Number(parsed.nCtx):4096,nGpuLayers:Number.isFinite(Number(parsed.nGpuLayers))?Math.max(0,Math.min(99,Math.floor(Number(parsed.nGpuLayers)))):0};
 }catch{return DEFAULT_CONFIG;}
}
export async function saveConfig(value:AppConfig):Promise<void>{
 const safe={...value,nCtx:[2048,4096,8192,16384].includes(Number(value.nCtx))?Number(value.nCtx):4096,nGpuLayers:Math.max(0,Math.min(99,Math.floor(Number(value.nGpuLayers)||0)))};
 await AsyncStorage.setItem(SETTINGS_KEY,JSON.stringify(safe));
}
async function saveSecret(service:string,value:string):Promise<void>{
 if(!value.trim()){await Keychain.resetGenericPassword({service});return;}
 await Keychain.setGenericPassword(service,value.trim(),{service,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
}
async function getSecret(service:string):Promise<string>{const result=await Keychain.getGenericPassword({service});return result?result.password:'';}
export const saveProviderKey=(v:string)=>saveSecret(SERVICES.provider,v);
export const getProviderKey=()=>getSecret(SERVICES.provider);
export const saveGitHubToken=(v:string)=>saveSecret(SERVICES.github,v);
export const getGitHubToken=()=>getSecret(SERVICES.github);
export const saveComfyToken=(v:string)=>saveSecret(SERVICES.comfy,v);
export const getComfyToken=()=>getSecret(SERVICES.comfy);
export const saveVoiceKey=(v:string)=>saveSecret(SERVICES.voice,v);
export const getVoiceKey=()=>getSecret(SERVICES.voice);
export const saveHuggingFaceToken=(v:string)=>saveSecret(SERVICES.huggingFace,v);
export const getHuggingFaceToken=()=>getSecret(SERVICES.huggingFace);
export async function saveMcpToken(id:string,v:string):Promise<void>{await saveSecret(MCP_PREFIX+id,v);}
export async function getMcpToken(id:string):Promise<string>{return getSecret(MCP_PREFIX+id);}
export async function removeMcpToken(id:string):Promise<void>{await Keychain.resetGenericPassword({service:MCP_PREFIX+id});}
export async function loadMcpServers():Promise<McpServerConfig[]>{try{const value=JSON.parse((await AsyncStorage.getItem(MCP_CONFIG_KEY))||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
export async function saveMcpServers(value:McpServerConfig[]):Promise<void>{await AsyncStorage.setItem(MCP_CONFIG_KEY,JSON.stringify(value));}
