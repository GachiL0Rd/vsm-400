import { cp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { build } from 'vite';

const root = process.cwd();
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });

await build({
  configFile: resolve(root, 'vite.config.ts'),
  build: {
    outDir: resolve(dist, 'client'),
    emptyOutDir: true,
  },
});

await build({
  configFile: false,
  root,
  build: {
    ssr: resolve(root, 'src/server/main.ts'),
    outDir: resolve(dist, 'server'),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: 'main.mjs',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});

await cp(resolve(root, 'content'), resolve(dist, 'content'), { recursive: true });

await writeFile(
  resolve(dist, 'build-manifest.json'),
  `${JSON.stringify(
    {
      formatVersion: 1,
      client: 'client/index.html',
      server: 'server/main.mjs',
      content: 'content/manifest.json',
      clientRoot: 'client/',
      start: 'node server/main.mjs',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log('Production distribution created in dist/.');
console.log('Start it with: node dist/server/main.mjs');
