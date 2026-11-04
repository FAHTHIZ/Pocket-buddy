import {NativeModules} from 'react-native';
import {getVoiceKey,loadConfig} from './storage';
type NativeSpeechModule={speakSystem(text:string,languageTag:string):Promise<string>;speakNeural(text:string,apiKey:string,voiceId:string,modelId:string):Promise<string>;stopSpeaking():Promise<boolean>};
const Native=NativeModules.PocketBuddyNative as NativeSpeechModule;
export async function readAloud(text:string):Promise<string>{
 const clean=text.trim().slice(0,6000);
 if(!clean)throw new Error('There is no message text to read aloud.');
 if(!Native?.speakSystem||!Native?.speakNeural)throw new Error('Voice playback is unavailable. Reinstall the latest Pocket Buddy build.');
 const [key,config]=await Promise.all([getVoiceKey(),loadConfig()]);
 if(key.trim()&&config.voiceId.trim())return Native.speakNeural(clean,key,config.voiceId,config.voiceModel);
 return Native.speakSystem(clean,'');
}
export async function stopSpeech():Promise<void>{if(Native?.stopSpeaking)await Native.stopSpeaking();}
