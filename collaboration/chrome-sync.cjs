// Only these Branch deployments can receive explicitly paired conversation replies.
const CHROME_SYNC_ORIGIN = 'https://joinbranch.dev';
const LOCAL_SYNC_ORIGIN = 'http://localhost:4390';
const EXTENSION_ORIGIN = 'chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh';
const origins = new Set([CHROME_SYNC_ORIGIN, 'https://www.joinbranch.dev', 'https://branch.eshteremberg.workers.dev', LOCAL_SYNC_ORIGIN]);
const isChromeSyncOrigin = origin => origins.has(origin);
function validSyncClient(origin, headers, remoteAddress, desktop) {
 if(!isChromeSyncOrigin(origin))return false;
 if(desktop)return headers.origin===undefined&&headers['sec-fetch-site']===undefined&&
  (origin!==LOCAL_SYNC_ORIGIN||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remoteAddress));
 return headers.origin===EXTENSION_ORIGIN||(!headers.origin&&headers['sec-fetch-site']!=='cross-site');
}
module.exports = { CHROME_SYNC_ORIGIN, LOCAL_SYNC_ORIGIN, EXTENSION_ORIGIN, isChromeSyncOrigin, validSyncClient };
