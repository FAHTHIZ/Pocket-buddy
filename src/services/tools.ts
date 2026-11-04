import type {ToolDefinition} from '../types';
import {loadConfig,getGitHubToken} from './storage';
import {callMcpTool,listMcpTools} from './mcp';
import {createGitHubIssue,listGitHubIssues,readGitHubFile,searchGitHubRepositories} from './github';
import {cancelMediaJob,refreshMediaJob,submitMediaJobs} from './media';

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
 const host=url.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='127.0.0.1'||host==='::1'||host==='0.0.0.0'||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host))throw new Error('Private network addresses are not supported by the webpage reader.');
 return url;
}
async function webSearch(query:string):Promise<string>{
 const config=await loadConfig();if(!config.searxngUrl.trim())throw new Error('Connect a SearXNG search instance in Settings to enable web search.');
 const response=await fetch(config.searxngUrl.replace(/\/+$/,'')+'/search?q='+encodeURIComponent(query)+'&format=json',{headers:{Accept:'application/json'}});
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
 {type:'function',function:{name:'read_webpage',description:'Read and extract text from a public HTTPS webpage.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}},
 {type:'function',function:{name:'generate_image',description:'Generate one image through Pocket Buddy’s application-level media engine. Independent of the selected chat model.',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}}},
 {type:'function',function:{name:'generate_images',description:'Queue 1 to 20 images through the media engine. The selected chat model does not need native image generation.',parameters:{type:'object',properties:{prompt:{type:'string'},count:{type:'integer',minimum:1,maximum:20}},required:['prompt','count']}}},
 {type:'function',function:{name:'generate_video',description:'Generate a video through the configured media workflow. The selected chat model does not need native video generation.',parameters:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}}},
 {type:'function',function:{name:'generation_status',description:'Check the status and output filenames for a ComfyUI generation job.',parameters:{type:'object',properties:{prompt_id:{type:'string'}},required:['prompt_id']}}},
 {type:'function',function:{name:'cancel_generation',description:'Cancel a pending ComfyUI generation job.',parameters:{type:'object',properties:{prompt_id:{type:'string'}},required:['prompt_id']}}},
];
export async function getAllToolDefinitions():Promise<ToolDefinition[]>{
 const config=await loadConfig();
 const result=definitions.filter(item=>{
  const name=item.function.name;
  if(['web_search','read_webpage'].includes(name))return config.useWebSearch&&!!config.searxngUrl.trim();
  if(['generate_image','generate_images','generate_video','generation_status','cancel_generation'].includes(name))return !!config.comfyUrl.trim();
  return true;
 });
 if(await getGitHubToken())result.push(
  {type:'function',function:{name:'github_search_repositories',description:'Search public and accessible GitHub repositories with the connected GitHub account.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}},
  {type:'function',function:{name:'github_read_file',description:'Read a file from a GitHub repository.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'},path:{type:'string'},ref:{type:'string'}},required:['owner','repo','path']}}},
  {type:'function',function:{name:'github_list_issues',description:'List open issues from a GitHub repository.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'}},required:['owner','repo']}}},
  {type:'function',function:{name:'github_create_issue',description:'Create an issue in a GitHub repository. Requires user confirmation.',parameters:{type:'object',properties:{owner:{type:'string'},repo:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['owner','repo','title','body']}},requiresConfirmation:true},
 );
 result.push(...await listMcpTools());return result;
}
export async function executeTool(name:string,args:Record<string,unknown>):Promise<string>{
 if(name.startsWith('mcp_'))return callMcpTool(name,args);
 switch(name){
  case 'calculator':return String(calculate(String(args.expression||'')));
  case 'current_time':return new Date().toString();
  case 'web_search':return webSearch(String(args.query||''));
  case 'read_webpage':return readWebpage(String(args.url||''));
  case 'generate_image':{const jobs=await submitMediaJobs('image',String(args.prompt||''),1);return 'Image generation queued. Job ID: '+jobs[0].promptId;}
  case 'generate_images':{const count=Math.max(1,Math.min(20,Number(args.count)||1));const jobs=await submitMediaJobs('image',String(args.prompt||''),count);return 'Queued '+jobs.length+' image jobs:\n'+jobs.map((job,index)=>(index+1)+'. '+job.promptId).join('\n');}
  case 'generate_video':{const jobs=await submitMediaJobs('video',String(args.prompt||''),1);return 'Video generation queued. Job ID: '+jobs[0].promptId;}
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
