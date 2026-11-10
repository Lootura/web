import {readFile} from 'node:fs/promises';
import {githubRequest,completePublishedScan} from '../lib/publication.mjs';

const expected=JSON.parse(await readFile('payload/publication.json','utf8'));
const api=(path,options={})=>githubRequest(path,{token:process.env.GITHUB_TOKEN,...options});
for(let attempt=0;attempt<2;attempt++){
 const file=await api('contents/status.json?ref=scan-status',{allow404:true});
 if(!file)break;
 const previous=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
 const completed=completePublishedScan(previous,expected);
 if(!completed||JSON.stringify(completed)===JSON.stringify(previous))break;
 try{
  await api('contents/status.json',{method:'PUT',body:{branch:'scan-status',sha:file.sha,
   message:'Confirm published scan',content:Buffer.from(JSON.stringify(completed)).toString('base64')}});
  console.log(`Confirmed public scan ${expected.id}`);break;
 }catch(error){if(attempt===1)throw error;}
}
