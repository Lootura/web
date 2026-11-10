import {publicScanSnapshot} from '../../src/lib/lootura/scan-status.mjs';

export const publicRepository='Lootura/web';
export const publicSite='https://lootura.com';
export const publicationTimeoutMs=35*60_000;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

export function safePublication(value){
 if(value?.schemaVersion!==1||!/^[\w.-]{1,120}$/.test(value.id||'')
  ||!/^[a-f0-9]{40}$/.test(value.sourceCommit||'')||!timestamp(value.builtAt)
  ||!['es','us'].every(edition=>timestamp(value.news?.[edition])))return null;
 return {schemaVersion:1,id:value.id,sourceCommit:value.sourceCommit,builtAt:value.builtAt,
  news:{es:value.news.es,us:value.news.us}};
}

export async function githubRequest(path,{token,method='GET',body,raw=false,allow404=false,fetchImpl=fetch}={}){
 const response=await fetchImpl(`https://api.github.com/repos/${publicRepository}/${path}`,{
  method,headers:{Authorization:`Bearer ${token}`,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Lootura-publication',...(body?{'Content-Type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15_000),
 });
 if(response.status===404&&allow404)return null;
 if(!response.ok){
  const error=new Error(`GitHub ${method} ${path} returned HTTP ${response.status}`);
  error.status=response.status;
  throw error;
 }
 const content=await response.text();
 return content?JSON.parse(content):null;
}

export async function readLivePublication(expected,{fetchImpl=fetch,now=Date.now}={}){
 const issues=[],news={};let manifest=null;
 await Promise.all(['publication.json','news.es.json','news.us.json'].map(async path=>{
  try{
   const response=await fetchImpl(`${publicSite}/${path}?_publication=${encodeURIComponent(expected.id)}-${now()}`,{
    cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(10_000),
   });
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const data=await response.json();
   if(path==='publication.json')manifest=safePublication(data);
   else news[path.split('.')[1]]=data.updatedAt;
  }catch(error){issues.push(`${path}: ${error.message}`);}
 }));
 if(!manifest||manifest.id!==expected.id||manifest.sourceCommit!==expected.sourceCommit)issues.push('The expected website revision is not live');
 for(const edition of ['es','us']){
  if(!timestamp(news[edition])||Date.parse(news[edition])<Date.parse(expected.news[edition])
   ||Date.parse(news[edition])>now()+60_000)issues.push(`${edition}: public news is missing or behind ${expected.news[edition]}`);
 }
 return {ready:issues.length===0,issues,manifest,news};
}

export async function waitForPublication(expected,{fetchImpl=fetch,now=Date.now,
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=publicationTimeoutMs,intervalMs=15_000,onPending=()=>{}}={}){
 expected=safePublication(expected);
 if(!expected)throw new Error('Invalid publication receipt');
 const deadline=now()+timeoutMs;let result;
 while(now()<deadline){
  result=await readLivePublication(expected,{fetchImpl,now});
  if(result.ready)return result;
  await onPending(result);
  await sleep(Math.min(intervalMs,Math.max(0,deadline-now())));
 }
 throw new Error(`Public publication ${expected.id} was not confirmed: ${result?.issues.join('; ')||'no response'}`);
}

export function deploymentNeedsRetry(expected,live,recentRuns,now=Date.now(),currentRunId=''){
 if(live.ready)return {deploy:false,reason:'already_live'};
 const recentFailure=(recentRuns||[]).find(run=>String(run.id)!==String(currentRunId)
  &&['failure','timed_out'].includes(run.conclusion)
  &&Date.parse(run.created_at)>=Date.parse(expected.builtAt)
  &&now-Date.parse(run.updated_at)<15*60_000);
 return recentFailure?{deploy:false,reason:'retry_cooldown'}:{deploy:true,reason:'publication_missing'};
}

export async function ensurePayloadRevision(payloadCommit,{runSha,publicationId,token,force=false,
 request=(path,options={})=>githubRequest(path,{token,...options})}={}){
 if(!/^[a-f0-9]{40}$/.test(payloadCommit)||!/^[a-f0-9]{40}$/.test(runSha))throw new Error('Invalid Pages revision');
 const path='contents/deployment-target.json';
 const current=await request(`${path}?ref=${runSha}`,{raw:true,allow404:true});
 if(current?.payloadCommit===payloadCommit)return {ready:true};
 const latest=await request(`${path}?ref=main`,{allow404:true});
 const target=latest?JSON.parse(Buffer.from(latest.content,'base64').toString('utf8')):null;
 if(target?.payloadCommit!==payloadCommit){
  await request(path,{method:'PUT',body:{branch:'main',...(latest?{sha:latest.sha}:{}),
   message:`Select website payload ${payloadCommit.slice(0,12)}`,
   content:Buffer.from(JSON.stringify({payloadCommit,publicationId})+'\n').toString('base64')}});
 }
 // A new main revision makes Pages' pages_build_version unique for these bytes.
 await request('actions/workflows/deploy-pages.yml/dispatches',{method:'POST',body:{ref:'main',inputs:{force:String(force)}}});
 return {ready:false};
}

export async function clearPreviousPagesDeliveries({runSha,token,
 request=(path,options={})=>githubRequest(path,{token,...options})}={}){
 const deployments=await request('deployments?environment=github-pages&per_page=20');
 const revisions=[...new Set(deployments.map(item=>item.sha))]
  .filter(sha=>/^[a-f0-9]{40}$/.test(sha)&&sha!==runSha).slice(0,6);
 const warnings=[];
 for(const sha of revisions){
  const previous=await request(`pages/deployments/${sha}`,{allow404:true});
  if(!previous)continue;
  // Pages can report a cached success while still holding an in-progress lock for the same SHA.
  try{await request(`pages/deployments/${sha}/cancel`,{method:'POST',allow404:true});}
  catch(error){
   if(![400,409].includes(error.status))throw error;
   warnings.push(`Pages refused cleanup of prior revision ${sha} (HTTP ${error.status}); deployment and live verification will decide whether delivery is possible.`);
  }
 }
 return warnings;
}

export function completePublishedScan(value,publication,at=new Date().toISOString()){
 const snapshot=publicScanSnapshot(value,{now:Date.parse(at)});
 if(!snapshot)return null;
 const complete=run=>{
  if(run?.id!==publication.id||run.state==='completed'||!run.events.some(event=>event.phase==='publishing')
   ||Date.parse(run.updatedAt)>Date.parse(at))return run;
  return {...run,state:'completed',phase:'completed',updatedAt:at,
   events:[...run.events.filter(event=>!['failed','cancelled','completed'].includes(event.phase)),{phase:'completed',at}]};
 };
 return publicScanSnapshot({...snapshot,run:complete(snapshot.run),history:snapshot.history.map(complete)},{now:Date.parse(at)});
}
