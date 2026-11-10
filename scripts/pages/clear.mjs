import {clearPreviousPagesDeliveries} from '../lib/publication.mjs';

const warnings=await clearPreviousPagesDeliveries({runSha:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN});
for(const warning of warnings)console.warn(warning);
console.log('Requested prior delivery cleanup; live verification remains required.');
