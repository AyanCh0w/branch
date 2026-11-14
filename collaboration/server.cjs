const config=require('../backend/config.cjs');
const service=()=>require('../backend/server.bundle.cjs');
function client(req){return service().requestClient(req);}
module.exports=async(req,res,url)=>service().route(req,res,url);
module.exports.authorizeBoard=async(req,{readOnly=false}={})=>{if(!config.url||!req.headers['x-board-id'])return false;try{const p=await client(req).query('library:permission',{boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||''});return !!p&&(readOnly||p.role!=='viewer');}catch{return false;}};
module.exports.peopleContext=req=>client(req).query('people:context',{boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||''});
module.exports.resolveFiles=async(req,contexts)=>{for(const c of contexts){const a=c.attachment;if(!a?.storageId)continue;const f=await client(req).query('files:read',{boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||'',storageId:a.storageId});if(a.kind==='pdf'?f.mime!=='application/pdf':!/^image\/(png|jpeg|webp|gif)$/.test(f.mime||''))throw Error('Unsupported file');c.attachment={kind:a.kind,url:f.url};}};
module.exports.chatgptClient=client;
module.exports.aiProvider=async(req)=>{const c=client(req),args={boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||''};if(!await c.query('chatgpt:boardConnection',args))return null;if(!process.env.CHATGPT_ENCRYPTION_KEY)throw Error('ChatGPT server is not configured');return c.action('chatgptActions:forServer',{...args,secret:process.env.CHATGPT_ENCRYPTION_KEY});};
module.exports.socialPreview=async(linkToken)=>service().engine.call('sharing:socialPreview',{linkToken},{},'query');
