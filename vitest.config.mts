import { defineConfig } from 'vitest/config';
import {readFileSync} from 'node:fs';
export default defineConfig({
  // Convex imports WASM as a compiled module. Match that behavior for real auth tests.
  plugins:[{name:'convex-wasm-test',enforce:'pre',load(id){if(id.endsWith('.wasm'))return `export default new WebAssembly.Module(Uint8Array.from(${JSON.stringify([...readFileSync(id)])}));`;}}],
  test: { include: ['collaboration/**/*.test.ts'],server:{deps:{inline:['password-hash-wasm']}} }
});
