const fs=require('node:fs');const path=require('node:path');
const root=path.dirname(require.resolve('pdfjs-dist/package.json')),out=path.join(__dirname,'pdfjs');fs.mkdirSync(out,{recursive:true});
for(const name of ['pdf.mjs','pdf.worker.mjs'])fs.copyFileSync(path.join(root,'build',name),path.join(out,name));
for(const name of ['cmaps','standard_fonts','wasm'])fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
