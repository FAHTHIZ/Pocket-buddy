import {NativeModules} from 'react-native';

type NativeClipboard={copyToClipboard(text:string):Promise<boolean>};
const Native=NativeModules.PocketBuddyNative as NativeClipboard;

export async function copyToClipboard(text:string):Promise<void>{
 if(!Native?.copyToClipboard)throw new Error('Clipboard access is unavailable. Rebuild the Android app.');
 await Native.copyToClipboard(text);
}
