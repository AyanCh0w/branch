import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['backend/tests/**/*.test.ts'],testTimeout:30000,hookTimeout:30000,fileParallelism:false}});
