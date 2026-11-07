import { open } from 'react-native-nitro-sqlite';
import type { ChatMessage, Conversation, GenerationJob } from '../types';
type Database=ReturnType<typeof open>;type Row=Record<string,any>;
export type ConversationContext={conversationId:string;summary:string;throughMessageId:string;updatedAt:number};
let opening:Promise<Database>|null=null;
async function database():Promise<Database>{
 if(!opening)opening=(async()=>{
  const db=open({name:'pocket-buddy.db'});
  await db.executeAsync('PRAGMA journal_mode=WAL');await db.executeAsync('PRAGMA foreign_keys=ON');
  await db.executeAsync('CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  await db.executeAsync('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,error INTEGER NOT NULL DEFAULT 0,attachments TEXT,FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)');
  await db.executeAsync('CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id,created_at)');
  await db.executeAsync('CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,prompt TEXT NOT NULL,prompt_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at INTEGER NOT NULL,outputs TEXT NOT NULL DEFAULT "[]")');
  await db.executeAsync('CREATE TABLE IF NOT EXISTS conversation_context(conversation_id TEXT PRIMARY KEY,summary TEXT NOT NULL,through_message_id TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  return db;
 })().catch(error=>{opening=null;throw error;});
 return opening;
}
export async function saveConversation(item:Conversation):Promise<void>{
 const db=await database();await db.transaction(async tx=>{
  await tx.executeAsync('INSERT OR REPLACE INTO conversations(id,title,updated_at) VALUES(?,?,?)',[item.id,item.title,item.updatedAt]);
  await tx.executeAsync('DELETE FROM messages WHERE conversation_id=?',[item.id]);
  for(const message of item.messages)await tx.executeAsync('INSERT OR REPLACE INTO messages(id,conversation_id,role,content,created_at,error,attachments) VALUES(?,?,?,?,?,?,?)',[message.id,item.id,message.role,message.content,message.createdAt,message.error?1:0,JSON.stringify(message.attachments||[])]);
 });
}
export async function listConversations():Promise<Conversation[]>{
 const db=await database(),result=await db.executeAsync('SELECT id,title,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 100'),output:Conversation[]=[];
 for(const row of result.results as Row[]){
  const rows=await db.executeAsync('SELECT id,role,content,created_at,error,attachments FROM messages WHERE conversation_id=? ORDER BY created_at ASC',[row.id]),messages:ChatMessage[]=[];
  for(const message of rows.results as Row[]){let attachments=[];try{attachments=JSON.parse(message.attachments||'[]');}catch{attachments=[];}messages.push({id:String(message.id),role:message.role,content:String(message.content??''),createdAt:Number(message.created_at),error:message.error===1,attachments});}
  output.push({id:String(row.id),title:String(row.title),updatedAt:Number(row.updated_at),messages});
 }
 return output;
}
export async function deleteConversation(id:string):Promise<void>{
 const db=await database();await db.transaction(async tx=>{await tx.executeAsync('DELETE FROM messages WHERE conversation_id=?',[id]);await tx.executeAsync('DELETE FROM conversation_context WHERE conversation_id=?',[id]);await tx.executeAsync('DELETE FROM conversations WHERE id=?',[id]);});
}
export async function getConversationContext(id:string):Promise<ConversationContext|null>{
 const db=await database(),result=await db.executeAsync('SELECT conversation_id,summary,through_message_id,updated_at FROM conversation_context WHERE conversation_id=?',[id]),row=(result.results as Row[])[0];
 return row?{conversationId:String(row.conversation_id),summary:String(row.summary||''),throughMessageId:String(row.through_message_id||''),updatedAt:Number(row.updated_at)}:null;
}
export async function saveConversationContext(context:ConversationContext):Promise<void>{
 const db=await database();await db.executeAsync('INSERT OR REPLACE INTO conversation_context(conversation_id,summary,through_message_id,updated_at) VALUES(?,?,?,?)',[context.conversationId,context.summary,context.throughMessageId,context.updatedAt]);
}
export async function saveGenerationJob(job:GenerationJob):Promise<void>{
 const db=await database();await db.executeAsync('INSERT OR REPLACE INTO generation_jobs(id,kind,prompt,prompt_id,status,created_at,outputs) VALUES(?,?,?,?,?,?,?)',[job.id,job.kind,job.prompt,job.promptId,job.status,job.createdAt,JSON.stringify(job.outputs||[])]);
}
export async function updateGenerationJob(promptId:string,status:string,outputs:string[]=[]):Promise<void>{const db=await database();await db.executeAsync('UPDATE generation_jobs SET status=?,outputs=? WHERE prompt_id=?',[status,JSON.stringify(outputs),promptId]);}
export async function listGenerationJobs():Promise<GenerationJob[]>{
 const db=await database(),result=await db.executeAsync('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 200'),jobs:GenerationJob[]=[];
 for(const row of result.results as Row[]){let outputs:string[]=[];try{outputs=JSON.parse(row.outputs||'[]');}catch{outputs=[];}jobs.push({id:String(row.id),kind:row.kind,prompt:String(row.prompt),promptId:String(row.prompt_id),status:String(row.status),createdAt:Number(row.created_at),outputs});}
 return jobs;
}
