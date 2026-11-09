import type {MediaKind,MessageAttachment,ToolDefinition} from '../types';
import {loadConfig,getGitHubToken} from './storage';
import {callMcpTool,listMcpTools} from './mcp';
import {createGitHubIssue,listGitHubIssues,readGitHubFile,searchGitHubRepositories} from './github';
import {cancelMediaJob,createMedia,detectAudioStyle,refreshMediaJob,type MediaProgress} from './media';
export type ToolContext={onMedia?:MediaProgress;collect?:(items:MessageAttachment[])=>void};
async function mediaTool(kind:MediaKind,args:Record<string,unknown>,count:number,context?:ToolContext):Promise<string>{
 const prompt=String(args.prompt||'').trim();
 const style=kind==='audio'?(['music','speech','sfx'].includes(String(args.style))?String(args.style) as any:detectAudioStyle(prompt)):undefined;
 const outcome=await createMedia({kind,prompt,count,audioStyle:style},context?.onMedia);
 if(outcome.engine==='comfyui')return 'Queued '+outcome.queued.length+' '+kind+' job(s) on ComfyUI: '+outcome.queued.map(job=>job.promptId).join(', ')+'. The user can follow them in the Media library.';
 context?.collect?.(outcome.attachments);
 return 'Created '+outcome.attachments.length+' '+kind+' file(s). They are already displayed to the user in the chat, so do not include links or markdown images. Briefly describe what was made.'+(outcome.failures.length?' '+outcome.failures.length+' failed: '+outcome.failures[0]:'');
}

function calculate(source:string):number{
 const expression=source.replace(/\s+/g,'');
 const tokens=expression.match(/\d+(?:\.\d+)?|[()+\-*/%^]/g);
 if(!tokens||tokens.join('')!==expression)throw new Error('Only basic arithmetic is supported.');
 let index=0;const peek=()=>tokens[index];const take=()=>tokens[index++];
 function primary():number{const token=take();if(token==='('){const value=additive();if(take()!==')')throw new Error('Missing closing parenthesis.');return value;}if(token==='-')return-primary();if(token==='+')return primary();const value=Number(token);if(!Number.isFinite(value))throw new Error('Invalid number.');return value;}
 function power():number{let value=primary();if(peek()==='^'){take();value=Math.pow(value,power());}return value;}
 function multiply():number{let value=power();while(['*','/','%'].includes(peek())){const operator=take(),right=power();if((operator==='/'||operator==='%')&&right===0)throw new Error('Division by zero.');value=operator==='*'?value*right:operator==='/'?value/right:value%right;}return value;}
 function additive():number{let value=multiply();while(peek()==='+'||peek()==='-'){const operator=take(),right=multiply();value=operator==='+'?value+right:value-right;}return value;}
 const result=additive();if(index!==tokens.length||!Number.isFinite(result))throw new Error('Invalid arithmetic expression.');return result;
}
function publicHttpsUrl(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw new Error('Enter a valid URL.');}
 if(url.protocol!=='https:')throw new Error('Only HTTPS webpage URLs are supported.');
 if(url.username||url.password)throw new Error('URLs containing embedded credentials are not supported.');
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
 const localSuffixes=['.localhost','.local','.internal','.lan','.test','.home.arpa'];
 if(!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+){0,3}$/.test(host)||host==='localhost'||localSuffixes.some(suffix=>host.endsWith(suffix)))throw new Error('Local, private and IP-literal destinations are not supported by the webpage reader.');
 return url;
}
async function webSearch(query:string):Promise<string>{
 const config=await loadConfig();if(!config.searxngUrl.trim())throw new Error('Connect a SearXNG search instance in Settings to enable web search.');
 let endpoint:URL;try{endpoint=new URL(config.searxngUrl.trim());}catch{throw new Error('Enter a valid SearXNG HTTPS URL in Settings.');}
 if(endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('SearXNG endpoints must use HTTPS and must not contain embedded credentials, query strings or fragments.');
 const response=await fetch(endpoint.toString().replace(/\/+$/,'')+'/search?q='+encodeURIComponent(query)+'&format=json',{headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error('Search service returned HTTP '+response.status);
 const data=await response.json();
 return (data.results||[]).slice(0,8).map((item:any,index)=>(index+1)+'. '+String(item.title||'Untitled')+'\n'+String(item.url||'')+'\n'+String(item.content||'').slice(0,600)).join('\n\n')||'No results found.';
}
async function readWebpage(raw:string):Promise<string>{
 const url=publicHttpsUrl(raw);
 const response=await fetch(url.toString(),{headers:{'User-Agent':'PocketBuddy/0.1',Accept:'text/html,text/plain'}});
 if(!response.ok)throw new Error('Webpage returned HTTP '+response.status);
 const type=response.headers.get('content-type')||'';
 if(!type.includes('text/html')&&!type.includes('text/plain'))throw new Error('Only HTML and plain-text pages are supported.');
 const rawText=await response.text();
 return rawText.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<nav[\s\S]*?<\/nav>/gi,' ').replace(/<footer[\s\S]*?<\/footer>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim().slice(0,15000);
}
const definitions:ToolDefinition[]=[
 {type:'function',function:{name:'calculator',description:'Evaluate arithmetic accurately. Supports parentheses, +, -, *, /, %, and exponentiation.',parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression']}}},
 {type:'function',function:{name:'current_time',description:'Get the current date, time and timezone of this device.',parameters:{type:'object',properties:{}}}},
 {type:'function',function:{name:'web_search',description:'Search the web using the connected SearXNG instance. Use for recent facts, research and sources.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
 {type:'function',function:{name:'read_webpage',description:'Read and extract text from a public HTTPS webpage. Pocket Buddy will ask the user to approve the URL before fetching it.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}},requiresConfirmation:true},
 {type:'function',function:{name:'generate_image',description:'Create one image from a detailed English prompt. Shown to the user automatically.',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}},requiresConfirmation:true},
 {type:'function',function:{name:'generate_images',description:'Create 1 to 20 image variations at once from a detailed English prompt. Shown to the user automatically.',parameters:{type:'object',properties:{prompt:{type:'string'},count:{type:'integer',minimum:1,maximum:20}},required:['prompt','count']}},requiresConfirmation:true},
 {type:'function',function:{name:'generate_video',description:'Create a short video clip from a detailed English prompt describing scene, motion and camera. Shown to the user automatically.',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}},requiresConfirmation:true},
 {type:'function',function:{name:'generate_audio',description:'Create audio: style music (songs, beats, soundtracks; prompt describes genre, mood, instruments, optional lyrics), speech (prompt is the exact text to speak aloud) or sfx (a sound effect). Shown to the user automatically.',parameters:{type:'object',properties:{prompt:{type:'string'},style:{type:'string',enum:['music','speech','sfx']}},required:['prompt','style']}},requiresConfirmation:true},
 {type:'function',function:{name:'generation_status',description:'Check the status and output filenames for a ComfyUI generation job.',parameters:{type:'object',properties:{prompt_id:{type:'string'}},required:['prompt_id']}}},
 {type:'function',function:{name:'cancel_generation',description:'Cancel a pending ComfyUI generation job. Requires confirmation and only works before execution begins.',parameters:{type:'object',properties:{prompt_id:{type:'string'}},required:['prompt_id']}},requiresConfirmation:true},
];
export async function getAllToolDefinitions():Promise<ToolDefinition[]>{
 const config=await loadConfig();
 const result=definitions.filter(item=>{
  const name=item.function.name;
  if(['web_search','read_webpage'].includes(name))return config.useWebSearch&&!!config.searxngUrl.trim();
  const comfy=config.mediaEngine==='comfyui'&&!!config.comfyUrl.trim();
  if(name==='generate_audio')return config.mediaEngine==='pollinations'||(comfy&&!!config.audioWorkflow.trim());
  if(['generate_image','generate_images','generate_video'].includes(name))return config.mediaEngine==='pollinations'||comfy;
  if(['generation_status','cancel_generation'].includes(name))return comfy;
  return true;
 }).map(item=>config.mediaEngine==='pollinations'&&item.function.name.startsWith('generate_')?{...item,requiresConfirmation:false}:item);
 if(await getGitHubToken())result.push(
  {type:'function',function:{name:'github_search_repositories',description:'Search public and accessible GitHub repositories with the connected GitHub account.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
  {type:'function',function:{name:'github_read_file',description:'Read a file from a GitHub repository.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'},path:{type:'string'},ref:{type:'string'}},required:['owner','repo','path']}}},
  {type:'function',function:{name:'github_list_issues',description:'List open issues from a GitHub repository.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'}},required:['owner','repo']}}},
  {type:'function',function:{name:'github_create_issue',description:'Create an issue in a GitHub repository. Requires user confirmation.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['owner','repo','title','body']}},requiresConfirmation:true},
 );
 result.push(...await listMcpTools());return result;
}
export async function executeTool(name:string,args:Record<string,unknown>,context?:ToolContext):Promise<string>{
 if(name.startsWith('mcp_'))return callMcpTool(name,args);
 switch(name){
  case 'calculator':return String(calculate(String(args.expression||'')));
  case 'current_time':return new Date().toString();
  case 'web_search':return webSearch(String(args.query||''));
  case 'read_webpage':return readWebpage(String(args.url||''));
  case 'generate_image':return mediaTool('image',args,1,context);
  case 'generate_images':return mediaTool('image',args,Math.max(1,Math.min(20,Number(args.count)||1)),context);
  case 'generate_video':return mediaTool('video',args,1,context);
  case 'generate_audio':return mediaTool('audio',args,1,context);
  case 'generation_status':return refreshMediaJob(String(args.prompt_id||''));
  case 'cancel_generation':await cancelMediaJob(String(args.prompt_id||''));return 'Generation job cancelled.';
  case 'github_search_repositories':return searchGitHubRepositories(String(args.query||''));
  case 'github_read_file':return readGitHubFile(String(args.owner||''),String(args.repo||''),String(args.path||''),String(args.ref||'HEAD'));
  case 'github_list_issues':return listGitHubIssues(String(args.owner||''),String(args.repo||''));
  case 'github_create_issue':return createGitHubIssue(String(args.owner||''),String(args.repo||''),String(args.title||''),String(args.body||''));
  default:throw new Error('Unknown tool: '+name);
 }
}
export function toolNeedsConfirmation(name:string,tools:ToolDefinition[]):boolean{return tools.some(item=>item.function.name===name&&item.requiresConfirmation===true);}
