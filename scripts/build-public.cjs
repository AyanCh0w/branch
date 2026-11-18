const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'app'),output=path.join(root,'public');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
// Only explicitly public assets enter the static output. Never copy the source tree.
const files=['favicon.ico','favicon.svg','terms.html','privacy.html','legal.css','landing.html','landing.css','landing.js', 'landing-scroll.js','landing-footer.js','landing-shader.bundle.js','landing-theme.css','app.js','coding.js','whiteboard.js','whiteboard.css','reactive-grid.js','markdown.bundle.js','context.js','video-context.js','auto-layout.js','plan-layout.js','plan-board.js','plan-board.css','media.js','pdf-viewer.js','icons.js','style.css','accounts.bundle.js','accounts.css','tooltips.js','tooltips.css','theme.js','theme.css','canvas-tour.js','canvas-tour.css','desktop-setup.js','mac-setup.html','mac-setup.js','mac-setup.css'];
for(const file of files)fs.copyFileSync(path.join(source,file),path.join(output,file));
fs.copyFileSync(path.join(source,'landing.html'),path.join(output,'index.html'));
fs.copyFileSync(path.join(source,'index.html'),path.join(output,'workspace.html'));
for(const dir of ['fonts','icons','katex','pdfjs'])fs.cpSync(path.join(source,dir),path.join(output,dir),{recursive:true});

// A release build can ship a notarized installer staged by the release operator.
const macInstaller=process.env.BRANCH_MAC_INSTALLER;
if(macInstaller){
 const installer=path.resolve(macInstaller);
 if(path.extname(installer).toLowerCase()!=='.dmg'||!fs.statSync(installer).isFile()){
  throw Error('BRANCH_MAC_INSTALLER must point to a notarized .dmg file.');
 }
 require('node:child_process').execFileSync('xcrun',['stapler','validate',installer],{stdio:'inherit'});
 const downloads=path.join(output,'downloads');
 fs.mkdirSync(downloads);
 fs.copyFileSync(installer,path.join(downloads,'branch-for-mac.dmg'));
 fs.writeFileSync(path.join(downloads,'mac-release.json'),JSON.stringify({installer:'/downloads/branch-for-mac.dmg'}));
}
