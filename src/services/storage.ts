import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {AppConfig,McpServerConfig} from '../types';
export type{McpServerConfig}from'../types';
const SETTINGS_KEY='pocket-buddy.settings.v1';
const SERVICES={provider:'pocket-buddy.provider',github:'pocket-buddy.github',comfy:'pocket-buddy.comfy',voice:'pocket-buddy.voice'};
const MCP_PREFIX='pocket-buddy.mcp.';
export const DEFAULT_CONFIG:AppConfig={mode:'api',baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini',temperature:0.7,maxToolTurns:6,useWebSearch:false,searxngUrl:'',comfyUrl:'',imageWorkflow:'',videoWorkflow:'',voiceId:'',voiceModel:'eleven_multilingual_v2'};
export async function loadConfig():Promise<AppConfig>{try{const raw=await AsyncStorage.getItem(SETTINGS_KEY);return raw?{...DEFAULT_CONFIG,...JSON.parse(raw)}:DEFAULT_CONFIG;}catch{return DEFAULT_CONFIG;}}
export async function saveConfig(value:AppConfig):Promise<void>{await AsyncStorage.setItem(SETTINGS_KEY,JSON.stringify(value));}
async function saveSecret(service:string,value:string):Promise<void>{if(!value.trim()){await Keychain.resetGenericPassword({service});return;}await Keychain.setGenericPassword(service,value.trim(),{service,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});}
async function getSecret(service:string):Promise<string>{const result=await Keychain.getGenericPassword({service});return result?result.password:'';}
export const saveProviderKey=(v:string)=>saveSecret(SERVICES.provider,v);
export const getProviderKey=()=>getSecret(SERVICES.provider);
export const saveGitHubToken=(v:string)=>saveSecret(SERVICES.github,v);
export const getGitHubToken=()=>getSecret(SERVICES.github);
export const saveComfyToken=(v:string)=>saveSecret(SERVICES.comfy,v);
export const getComfyToken=()=>getSecret(SERVICES.comfy);
export const saveVoiceKey=(v:string)=>saveSecret(SERVICES.voice,v);
export const getVoiceKey=()=>getSecret(SERVICES.voice);
export async function saveMcpToken(id:string,v:string):Promise<void>{await saveSecret(MCP_PREFIX+id,v);}
export async function getMcpToken(id:string):Promise<string>{return getSecret(MCP_PREFIX+id);}
export async function removeMcpToken(id:string):Promise<void>{await Keychain.resetGenericPassword({service:MCP_PREFIX+id});}
const MCP_CONFIG_KEY='pocket-buddy.mcp-servers.v1';
export async function loadMcpServers():Promise<McpServerConfig[]>{try{return JSON.parse((await AsyncStorage.getItem(MCP_CONFIG_KEY))||'[]');}catch{return [];}}
export async function saveMcpServers(value:McpServerConfig[]):Promise<void>{await AsyncStorage.setItem(MCP_CONFIG_KEY,JSON.stringify(value));}
