import {env} from 'cloudflare:workers';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import wasm from './resvg.wasm';
import {boardSVG,metadataHTML} from '../app/social-preview-core.cjs';
let renderer:Promise<void>|undefined;
export async function servePreview(req:any,res:any,url:URL,lookup:any){
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 let board=null;const token=url.searchParams.get('join');
 if(/^[a-f0-9]{64}$/.test(token||'')){try{board=await lookup(token);}catch{}}
 if(url.pathname==='/api/share-image'){
  if(!board){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','image/png');if(req.method==='HEAD')return res.end();
  await (renderer??=initWasm(wasm));
  const font=await (await env.ASSETS.fetch(new Request(new URL('/pdfjs/standard_fonts/LiberationSans-Regular.ttf',url)))).arrayBuffer();
  const svg=new Resvg(boardSVG(board),{font:{fontBuffers:[new Uint8Array(font)],loadSystemFonts:false}});
  try{const png=svg.render();try{res.end(Buffer.from(png.asPng()));}finally{png.free();}}finally{svg.free();}
  return;
 }
 const asset=await env.ASSETS.fetch(new Request(new URL('/workspace.html',url)));
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?undefined:metadataHTML(await asset.text(),board,url));
}
