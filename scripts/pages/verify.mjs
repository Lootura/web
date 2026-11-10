import {readFile,appendFile} from 'node:fs/promises';
import {waitForPublication} from '../lib/publication.mjs';

const expected=JSON.parse(await readFile('payload/publication.json','utf8'));
const result=await waitForPublication(expected,{timeoutMs:5*60_000,onPending:status=>console.log(status.issues.join('; '))});
await appendFile(process.env.GITHUB_STEP_SUMMARY,`\n## Website verified\n- Revision: \`${expected.id}\`\n- Spain: \`${result.news.es}\`\n- USA: \`${result.news.us}\`\n`);
console.log(`Verified ${expected.id} on https://lootura.com/`);
