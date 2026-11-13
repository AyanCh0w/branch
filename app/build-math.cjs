const fs=require('node:fs'),path=require('node:path');
const source=path.join(path.dirname(require.resolve('katex/package.json')),'dist');
const output=path.join(__dirname,'katex');
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(path.join(source,'katex.min.css'),path.join(output,'katex.min.css'));
fs.cpSync(path.join(source,'fonts'),path.join(output,'fonts'),{recursive:true});
