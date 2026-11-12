import type {AudioStyle,MediaKind} from '../types';
export type MediaModel={id:string;title:string;description:string;kind:MediaKind;audioStyle?:AudioStyle;licenseLabel:string;durations?:number[];minDuration?:number;maxDuration?:number;audioOutput?:boolean};
const MODELS:MediaModel[]=[
 {id:'dreamshaper8-lcm',title:'DreamShaper 8 LCM · on this phone',description:'Offline, private, unfiltered for adults · ~3–6 min per picture on mid-range phones · download in Models',kind:'image',licenseLabel:'On device'},
 {id:'realvis6-hyper',title:'Realistic Vision 6 · on this phone',description:'Offline photoreal people and scenes · ~3–6 min per picture on mid-range phones · download in Models',kind:'image',licenseLabel:'On device'},
 {id:'black-forest-labs/FLUX.1-schnell',title:'FLUX.1 Schnell',description:'12B image model · 1–4 steps · Apache 2.0',kind:'image',licenseLabel:'Apache 2.0'},
 {id:'black-forest-labs/FLUX.1-dev',title:'FLUX.1 Dev',description:'Higher-quality variant · non-commercial license; review terms before use',kind:'image',licenseLabel:'Non-commercial'},
 {id:'wan2.1-1.3b-device',title:'Wan 2.1 1.3B · on this phone',description:'Experimental, offline · 1–3 s clips at 416×240 · ~8–25 min each · download the 4.3 GB pack in Models',kind:'video',licenseLabel:'On device',durations:[1,2,3]},
 {id:'Wan-AI/Wan2.2-TI2V-5B',title:'Wan 2.2 TI2V-5B',description:'Text-to-video and image-to-video · 720p-capable · substantial GPU memory',kind:'video',licenseLabel:'Apache 2.0',durations:[5]},
 {id:'comfyui/audio-workflow',title:'Your ComfyUI audio workflow',description:'Uses the audio model and nodes configured in your own workflow',kind:'audio',audioStyle:'music',licenseLabel:'Your workflow',minDuration:3,maxDuration:180},
 {id:'comfyui/speech-workflow',title:'Your ComfyUI speech workflow',description:'Uses the speech model configured in your own workflow',kind:'audio',audioStyle:'speech',licenseLabel:'Your workflow'},
 {id:'comfyui/sfx-workflow',title:'Your ComfyUI sound workflow',description:'Uses the sound model configured in your own workflow',kind:'audio',audioStyle:'sfx',licenseLabel:'Your workflow',minDuration:1,maxDuration:22},
];
export const LOCAL_VIDEO_MODEL_ID='wan2.1-1.3b-device';
export const isComfyVideoModel=(id?:string)=>!!id&&id.startsWith('Wan-AI/');
export const isLocalImageModel=(id?:string)=>id==='dreamshaper8-lcm'||id==='realvis6-hyper';
export const MEDIA_VOICES=['default'];
export function fallbackModels():MediaModel[]{return MODELS;}
export async function listMediaModels():Promise<MediaModel[]>{return MODELS;}
