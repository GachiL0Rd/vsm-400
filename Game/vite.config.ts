import { defineConfig } from 'vite';
import { demoGamePlugin } from './dev/demo-server.ts';

export default defineConfig({
  base: './',
  plugins: [demoGamePlugin()],
});
