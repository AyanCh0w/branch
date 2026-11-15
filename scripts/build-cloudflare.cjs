const esbuild=require('esbuild'),fs=require('node:fs'),path=require('node:path');
fs.mkdirSync('.worker-build',{recursive:true});
fs.copyFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'),'.worker-build/resvg.wasm');
esbuild.build({tsconfig:'tsconfig.json',entryPoints:['worker/index.ts'],bundle:true,platform:'node',conditions:['workerd'],format:'esm',target:'es2022',outfile:'.worker-build/index.mjs',minify:false,external:['node:*','cloudflare:*','./resvg.wasm'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire('/bundle/index.mjs');"},plugins:[{name:'worker-runtime-adapters',setup(build){
 // Share one service/AsyncLocalStorage instance across the Node routes and queue consumer.
 build.onResolve({filter:/backend\/server\.bundle\.cjs$/},()=>({path:path.resolve('backend/http.ts')}));
 build.onResolve({filter:/social-preview\.cjs$/},()=>({path:path.resolve('worker/social-preview.ts')}));
 build.onResolve({filter:/resvg\.wasm$/},()=>({path:'./resvg.wasm',external:true}));
}}]}).catch(()=>process.exitCode=1);
