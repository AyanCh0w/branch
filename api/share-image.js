const {servePreview}=require('../app/social-preview.cjs');
const {socialPreview}=require('../collaboration/server.cjs');
module.exports=(req,res)=>{const url=new URL(req.url,'https://localhost');url.pathname='/api/share-image';return servePreview(req,res,url,socialPreview);};
