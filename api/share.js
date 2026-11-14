const {servePreview}=require('../app/social-preview.cjs');
const {socialPreview}=require('../collaboration/server.cjs');
module.exports=(req,res)=>{
 const host=req.headers.host;
 if(!/^[a-z0-9.-]+(?::\d+)?$/i.test(host||'')){res.statusCode=400;return res.end();}
 const url=new URL(req.url,'https://'+host);url.pathname='/app';
 return servePreview(req,res,url,socialPreview);
};
