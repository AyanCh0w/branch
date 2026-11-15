const {test}=require('node:test'),assert=require('node:assert/strict');
const {isChromeSyncOrigin,validSyncClient,EXTENSION_ORIGIN}=require('../../collaboration/chrome-sync.cjs');
test('hosted sync accepts only known hosts and explicitly paired native clients',()=>{
 for(const origin of ['https://joinbranch.dev','https://www.joinbranch.dev','https://branch.eshteremberg.workers.dev']){
  assert(isChromeSyncOrigin(origin));assert(validSyncClient(origin,{},'203.0.113.1',true));
  assert(validSyncClient(origin,{origin:EXTENSION_ORIGIN},'203.0.113.1',false));
  assert(validSyncClient(origin,{origin:EXTENSION_ORIGIN,'sec-fetch-site':'cross-site'},'',false));
  assert(!validSyncClient(origin,{'sec-fetch-site':'cross-site'},'',false));
  assert(!validSyncClient(origin,{origin:'https://attacker.test'},'',false));
  assert(!validSyncClient(origin,{origin},'',true));
  assert(!validSyncClient(origin,{'sec-fetch-site':'cross-site'},'',true));
 }
 for(const origin of ['http://joinbranch.dev','https://joinbranch.dev.attacker.test','https://attacker.test'])assert(!validSyncClient(origin,{},'',true));
 assert(validSyncClient('http://localhost:4390',{},'127.0.0.1',true));
 assert(!validSyncClient('http://localhost:4390',{},'203.0.113.1',true));
});
