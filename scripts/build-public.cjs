const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'app'),output=path.join(root,'public');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
// Only explicitly public assets enter the static output. Never copy the source tree.
const files=['favicon.ico','favicon.svg','landing.html','landing.css','landing.js','app.js','whiteboard.js','whiteboard.css','reactive-grid.js','markdown.bundle.js','context.js','video-context.js','auto-layout.js','media.js','pdf-viewer.js','icons.js','style.css','accounts.bundle.js','accounts.css','tooltips.js','tooltips.css','theme.js','theme.css'];
for(const file of files)fs.copyFileSync(path.join(source,file),path.join(output,file));
fs.copyFileSync(path.join(source,'landing.html'),path.join(output,'index.html'));
fs.copyFileSync(path.join(source,'index.html'),path.join(output,'workspace.html'));
for(const dir of ['fonts','icons','katex','pdfjs'])fs.cpSync(path.join(source,dir),path.join(output,dir),{recursive:true});
