import {test,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({call:vi.fn(async()=>({boardTitle:'Test'})),limit:vi.fn(async()=>{})}));
vi.mock('../service',()=>({engine:{call:mocks.call},configured:()=>true,publicConfig:()=>({}),requestClient:()=>({}),authenticate:vi.fn(),upload:vi.fn(),rateLimit:mocks.limit}));
import {route} from '../http';
const extension='chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh';
beforeEach(()=>{mocks.call.mockClear();});
async function request(query:string,headers:any={},method='POST',body:any={key:'synthetic-test'}){
 const result:any={status:0,headers:{},body:''};
 const res={setHeader:(k:string,v:any)=>result.headers[k]=v,writeHead:(s:number,h:any)=>{result.status=s;Object.assign(result.headers,h);},end:(body='')=>{result.body=body;}};
 await route({method,headers:{'content-type':'application/json',...headers},socket:{remoteAddress:'203.0.113.1'},body},res,new URL('https://joinbranch.dev/api/backend?'+query));return result;
}
test('hosted desktop status uses scoped capability, not ambient account access',async()=>{
 const r=await request('desktop=status');expect(r.status).toBe(200);expect(mocks.call).toHaveBeenCalledWith('chatgptBrowser:status',{key:'synthetic-test',source:'desktop'},{},'query',true);
});
test('extension preflight allows only fixed extension and content type',async()=>{
 const r=await request('chrome=save',{origin:extension,'sec-fetch-site':'cross-site','access-control-request-method':'POST','access-control-request-headers':'content-type'},'OPTIONS');expect(r.status).toBe(204);expect(r.headers['Access-Control-Allow-Origin']).toBe(extension);expect(mocks.call).not.toHaveBeenCalled();
 expect((await request('chrome=save',{origin:extension,'access-control-request-method':'POST','access-control-request-headers':'authorization'},'OPTIONS')).status).toBe(403);
});
test('hosted sync blocks browser cross-origin and ambiguous transports',async()=>{
 for(const [query,headers] of [['desktop=save',{origin:extension}],['chrome=save',{origin:'https://attacker.test'}],['chrome=save',{'sec-fetch-site':'cross-site'}],['chrome=save&desktop=save',{}]] as any)expect((await request(query,headers)).status).toBe(403);
 expect(mocks.call).not.toHaveBeenCalled();
});
test('revoked capability returns disconnected instead of success',async()=>{
 mocks.call.mockRejectedValueOnce(Error('chrome_sync_disconnected'));expect((await request('desktop=save')).status).toBe(401);
});

test('only the native sync transport can redeem a board ticket', async () => {
 const body={key:'desktop-key',ticket:'test-ticket',boardId:'test-board',conversationId:'test-chat'};
 expect((await request('chrome=redeem',{},'POST',body)).status).toBe(400);
 expect((await request('desktop=redeem',{origin:'https://joinbranch.dev'},'POST',body)).status).toBe(403);
 expect(mocks.call).not.toHaveBeenCalled();
 expect((await request('desktop=redeem',{},'POST',body)).status).toBe(200);
 expect(mocks.call).toHaveBeenCalledWith('chatgptBrowser:redeemDesktop',body,{},'mutation',true);
});
