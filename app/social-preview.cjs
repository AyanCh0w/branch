'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {boardSVG,metadataHTML}=require('./social-preview-core.cjs');
function renderPNG(board){const {Resvg}=require('@resvg/resvg-js');return new Resvg(boardSVG(board),{font:{fontFiles:[path.join(__dirname,'pdfjs/standard_fonts/LiberationSans-Regular.ttf')],loadSystemFonts:false}}).render().asPng();}
async function servePreview(req,res,url,lookup){
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 let board=null;const token=url.searchParams.get('join');
 if(/^[a-f0-9]{64}$/.test(token||'')){try{board=await lookup(token);}catch{}}
 if(url.pathname==='/api/share-image'){
  if(!board){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','image/png');return res.end(req.method==='HEAD'?undefined:renderPNG(board));
 }
 const html=metadataHTML(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),board,url);
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?undefined:html);
}
module.exports={boardSVG,renderPNG,metadataHTML,servePreview};
