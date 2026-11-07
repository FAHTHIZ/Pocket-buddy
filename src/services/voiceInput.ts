import{NativeModules,PermissionsAndroid,Platform}from'react-native';
type NativeVoiceModule={startSpeechRecognition(languageTag:string):Promise<string>};
const Native=NativeModules.PocketBuddyNative as NativeVoiceModule;
export async function captureVoiceInput():Promise<string>{
 if(Platform.OS!=='android')throw new Error('Voice input is currently available on Android only.');
 const permission=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,{
  title:'Allow microphone access',
  message:'Pocket Buddy uses your microphone to turn speech into text for the current chat.',
  buttonPositive:'Allow',
  buttonNegative:'Not now',
 });
 if(permission!==PermissionsAndroid.RESULTS.GRANTED)throw new Error('Microphone permission was not granted.');
 if(!Native?.startSpeechRecognition)throw new Error('Android speech recognition is unavailable. Rebuild the latest Pocket Buddy APK.');
 const transcript=await Native.startSpeechRecognition('');
 if(!transcript||!transcript.trim())throw new Error('No speech was recognized. Please try again.');
 return transcript.trim();
}
