import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = join(benchmarkDirectory, 'dist');

await mkdir(distDirectory, { recursive: true });

await build({
  entryPoints: [
    join(benchmarkDirectory, 'app.js'),
    join(benchmarkDirectory, 'nanocurrency-worker.js'),
  ],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outdir: distDirectory,
  minify: false,
});

await Promise.all([
  cp(join(benchmarkDirectory, 'index.html'), join(distDirectory, 'index.html')),
  cp(join(benchmarkDirectory, 'styles.css'), join(distDirectory, 'styles.css')),
  cp(join(benchmarkDirectory, 'nano_rspow_web_bg.wasm'), join(distDirectory, 'nano_rspow_web_bg.wasm')),
]);
