import type {AudioStyle,MediaKind} from '../types';
export type MediaModel={id:string;title:string;description:string;kind:MediaKind;audioStyle?:AudioStyle;licenseLabel:string;durations?:number[];minDuration?:number;maxDuration?:number;audioOutput?:boolean};
const MODELS:MediaModel[]=[
 {id:'black-forest-labs/FLUX.1-schnell',title:'FLUX.1 Schnell',description:'12B image model · 1–4 steps · Apache 2.0',kind:'image',licenseLabel:'Apache 2.0'},
 {id:'black-forest-labs/FLUX.1-dev',title:'FLUX.1 Dev',description:'Higher-quality variant · non-commercial license; review terms before use',kind:'image',licenseLabel:'Non-commercial'},
 {id:'Wan-AI/Wan2.2-TI2V-5B',title:'Wan 2.2 TI2V-5B',description:'Text-to-video and image-to-video · 720p-capable · substantial GPU memory',kind:'video',licenseLabel:'Apache 2.0',durations:[5]},
 {id:'comfyui/audio-workflow',title:'Your ComfyUI audio workflow',description:'Uses the audio model and nodes configured in your own workflow',kind:'audio',audioStyle:'music',licenseLabel:'Your workflow',minDuration:3,maxDuration:180},
 {id:'comfyui/speech-workflow',title:'Your ComfyUI speech workflow',description:'Uses the speech model configured in your own workflow',kind:'audio',audioStyle:'speech',licenseLabel:'Your workflow'},
 {id:'comfyui/sfx-workflow',title:'Your ComfyUI sound workflow',description:'Uses the sound model configured in your own workflow',kind:'audio',audioStyle:'sfx',licenseLabel:'Your workflow',minDuration:1,maxDuration:22},
];
export const MEDIA_VOICES=['default'];
export function fallbackModels():MediaModel[]{return MODELS;}
export async function listMediaModels():Promise<MediaModel[]>{return MODELS;}
