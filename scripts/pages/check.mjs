import {appendFile} from 'node:fs/promises';
import {safePublication,githubRequest,readLivePublication,deploymentNeedsRetry,ensurePayloadRevision} from '../lib/publication.mjs';

const token=process.env.GITHUB_TOKEN;
if(!token)throw new Error('GITHUB_TOKEN is required');
const api=(path,options={})=>githubRequest(path,{token,...options});
const ref=await api('git/ref/heads/gh-pages');
const commit=ref.object.sha;
const payload=await api(`contents/publication.json?ref=${commit}`,{raw:true,allow404:true});
const expected=safePublication(payload);
if(payload&&!expected)throw new Error('Prepared publication receipt is invalid');
let decision={deploy:false,reason:'legacy_payload_without_receipt'};
if(expected){
 const live=await readLivePublication(expected);
 const recent=await api('actions/workflows/deploy-pages.yml/runs?branch=main&per_page=10');
 decision=deploymentNeedsRetry(expected,live,recent.workflow_runs,Date.now(),process.env.GITHUB_RUN_ID);
 if(process.env.FORCE_PUBLICATION==='true')decision={deploy:true,reason:'manual_repair'};
 if(decision.deploy){
  const revision=await ensurePayloadRevision(commit,{runSha:process.env.GITHUB_SHA,publicationId:expected.id,token,
   force:process.env.FORCE_PUBLICATION==='true'});
  if(!revision.ready)decision={deploy:false,reason:'queued_unique_payload_revision'};
 }
}
console.log(`Pages ${decision.deploy?'deployment':'skip'}: ${decision.reason}; payload ${commit}`);
await appendFile(process.env.GITHUB_OUTPUT,`deploy=${decision.deploy}\ncommit=${commit}\n`);
await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Publication check\n- Decision: ${decision.reason}\n- Payload: \`${commit}\`\n- Publication: \`${expected?.id||'legacy'}\`\n`);
