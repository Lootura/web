import {clearPreviousPagesDeliveries} from '../lib/publication.mjs';

await clearPreviousPagesDeliveries({runSha:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN,
 includeCurrent:process.argv.includes('--include-current')});
console.log('Cleared prior Pages delivery locks before publishing the selected payload.');
