import{getGitHubToken}from'./storage';
async function github(path:string,accept='application/vnd.github+json'):Promise<string>{
 const token=await getGitHubToken();if(!token)throw new Error('Connect GitHub from Connectors before using GitHub tools.');
 const response=await fetch('https://api.github.com'+path,{headers:{Accept:accept,Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
 const raw=await response.text();if(!response.ok){let message='GitHub returned HTTP '+response.status;try{message=JSON.parse(raw).message||message;}catch{}throw new Error(message);}return raw;
}
function validRepo(owner:string,repo:string){if(!/^[a-zA-Z0-9_.-]+$/.test(owner)||! /^[a-zA-Z0-9_.-]+$/.test(repo))throw new Error('Invalid GitHub repository identifier.');}
export async function searchGitHubRepositories(query:string):Promise<string>{
 const result=JSON.parse(await github('/search/repositories?q='+encodeURIComponent(query)+'&sort=updated&per_page=8'));
 return(result.items||[]).map((item:any,index)=>(index+1)+'. '+item.full_name+'\n'+item.html_url+'\nStars: '+item.stargazers_count+' · '+(item.description||'')).join('\n\n')||'No repositories found.';
}
export async function readGitHubFile(owner:string,repo:string,path:string,ref='HEAD'):Promise<string>{
 validRepo(owner,repo);const encoded=path.split('/').map(encodeURIComponent).join('/');
 return github('/repos/'+owner+'/'+repo+'/contents/'+encoded+'?ref='+encodeURIComponent(ref),'application/vnd.github.raw+json').then(text=>text.slice(0,18000));
}
export async function listGitHubIssues(owner:string,repo:string):Promise<string>{
 validRepo(owner,repo);const items=JSON.parse(await github('/repos/'+owner+'/'+repo+'/issues?state=open&per_page=10'));
 return items.filter((item:any)=>!item.pull_request).map((item:any)=>'#'+item.number+' '+item.title+'\n'+item.html_url).join('\n\n')||'No open issues.';
}
export async function createGitHubIssue(owner:string,repo:string,title:string,body:string):Promise<string>{
 validRepo(owner,repo);const token=await getGitHubToken();if(!token)throw new Error('Connect GitHub first.');
 const response=await fetch('https://api.github.com/repos/'+owner+'/'+repo+'/issues',{method:'POST',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({title:title.slice(0,200),body:body.slice(0,60000)})});
 const result=await response.json();if(!response.ok)throw new Error(result.message||'GitHub issue creation failed.');
 return'Created issue #'+result.number+': '+result.html_url;
}