import SQLite from 'react-native-sqlite-storage';
import type {ChatMessage,Conversation,GenerationJob} from '../types';

SQLite.enablePromise(true);
let opening:Promise<SQLite.SQLiteDatabase>|null=null;

async function database():Promise<SQLite.SQLiteDatabase>{
 if(!opening){
  opening=SQLite.openDatabase({name:'pocket-buddy.db',location:'default'}).then(async db=>{
   await db.executeSql('PRAGMA journal_mode=WAL');
   await db.executeSql('PRAGMA foreign_keys=ON');
   await db.executeSql('CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,updated_at INTEGER NOT NULL)');
   await db.executeSql('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,error INTEGER NOT NULL DEFAULT 0,attachments TEXT,FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)');
   await db.executeSql('CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id,created_at)');
   await db.executeSql('CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,prompt TEXT NOT NULL,prompt_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at INTEGER NOT NULL,outputs TEXT NOT NULL DEFAULT "[]")');
   return db;
  }).catch(error=>{opening=null;throw error;});
 }
 return opening;
}

export async function saveConversation(item:Conversation):Promise<void>{
 const db=await database();
 await db.executeSql('INSERT OR REPLACE INTO conversations(id,title,updated_at) VALUES(?,?,?)',[item.id,item.title,item.updatedAt]);
 await db.executeSql('DELETE FROM messages WHERE conversation_id=?',[item.id]);
 for(const message of item.messages){
  await db.executeSql(
   'INSERT OR REPLACE INTO messages(id,conversation_id,role,content,created_at,error,attachments) VALUES(?,?,?,?,?,?,?)',
   [message.id,item.id,message.role,message.content,message.createdAt,message.error?1:0,JSON.stringify(message.attachments||[])],
  );
 }
}

export async function listConversations():Promise<Conversation[]>{
 const db=await database();
 const[rows]=await db.executeSql('SELECT id,title,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 100');
 const output:Conversation[]=[];
 for(let i=0;i<rows.rows.length;i++){
  const row=rows.rows.item(i);
  const[items]=await db.executeSql('SELECT id,role,content,created_at,error,attachments FROM messages WHERE conversation_id=? ORDER BY created_at ASC',[row.id]);
  const messages:ChatMessage[]=[];
  for(let j=0;j<items.rows.length;j++){
   const message=items.rows.item(j);let attachments=[];
   try{attachments=JSON.parse(message.attachments||'[]');}catch{}
   messages.push({id:message.id,role:message.role,content:message.content,createdAt:message.created_at,error:message.error===1,attachments});
  }
  output.push({id:row.id,title:row.title,updatedAt:row.updated_at,messages});
 }
 return output;
}

export async function deleteConversation(id:string):Promise<void>{
 const db=await database();
 await db.executeSql('DELETE FROM messages WHERE conversation_id=?',[id]);
 await db.executeSql('DELETE FROM conversations WHERE id=?',[id]);
}

export async function saveGenerationJob(job:GenerationJob):Promise<void>{
 const db=await database();
 await db.executeSql('INSERT OR REPLACE INTO generation_jobs(id,kind,prompt,prompt_id,status,created_at,outputs) VALUES(?,?,?,?,?,?,?)',
  [job.id,job.kind,job.prompt,job.promptId,job.status,job.createdAt,JSON.stringify(job.outputs||[])]);
}

export async function updateGenerationJob(promptId:string,status:string,outputs:string[]=[]):Promise<void>{
 const db=await database();
 await db.executeSql('UPDATE generation_jobs SET status=?,outputs=? WHERE prompt_id=?',[status,JSON.stringify(outputs),promptId]);
}

export async function listGenerationJobs():Promise<GenerationJob[]>{
 const db=await database();
 const[rows]=await db.executeSql('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 200');
 const jobs:GenerationJob[]=[];
 for(let i=0;i<rows.rows.length;i++){
  const row=rows.rows.item(i);let outputs:string[]=[];
  try{outputs=JSON.parse(row.outputs||'[]');}catch{}
  jobs.push({id:row.id,kind:row.kind,prompt:row.prompt,promptId:row.prompt_id,status:row.status,createdAt:row.created_at,outputs});
 }
 return jobs;
}