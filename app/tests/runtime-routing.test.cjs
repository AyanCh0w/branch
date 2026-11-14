const {test}=require('node:test'),assert=require('node:assert/strict');
const {hasConvexRuntime}=require('../../scripts/audit-runtime.cjs');
test('deployment audit rejects Convex endpoints and bundled clients',()=>{
 for(const source of ['https://example.convex.cloud','wss://example.convex.cloud/api/sync','https://example.convex.site/path','// node_modules/convex/dist/browser.js','// node_modules/@convex-dev/auth/index.js','new ConvexHttpClient(url)','import {x} from "convex/browser"','require("@convex-dev/auth")'])assert(hasConvexRuntime(source),source);
});
test('deployment audit allows Supabase, same-origin APIs, and historical migration comments',()=>{
 for(const source of ['https://example.supabase.co','fetch("/api/backend")','// Existing Convex usernames include spaces'])assert(!hasConvexRuntime(source),source);
});
