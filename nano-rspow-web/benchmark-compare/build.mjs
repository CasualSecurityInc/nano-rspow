// Builds the benchmark-compare site, including the nano-rspow-web WebAssembly
// module it benchmarks.
//
// The module is compiled from source here rather than checked in. An earlier
// version of this directory committed a prebuilt `nano_rspow_web.js` and
// `nano_rspow_web_bg.wasm` and asked developers to copy fresh ones in by hand
// after changing the crate, which meant the page could silently benchmark a
// stale build — and did. Now there is one build step and it cannot be stale.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(benchmarkDirectory, '..');
const repositoryDirectory = resolve(webDirectory, '..');
const distDirectory = join(benchmarkDirectory, 'dist');
const generatedDirectory = join(benchmarkDirectory, '.generated');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    if (command === 'wasm-bindgen') {
      throw new Error(
        'wasm-bindgen is not installed. Install it with `cargo install wasm-bindgen-cli`, '
        + 'or run `cargo binstall wasm-bindgen-cli`.',
      );
    }
    throw new Error(`${command} is not installed or not on PATH.`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

console.log('Building nano-rspow-web for wasm32…');
run('cargo', [
  'build',
  '-p', 'nano-rspow-web',
  '--target', 'wasm32-unknown-unknown',
  '--release',
], repositoryDirectory);

console.log('Generating WebAssembly bindings…');
await mkdir(generatedDirectory, { recursive: true });
run('wasm-bindgen', [
  '--target', 'web',
  '--out-dir', generatedDirectory,
  join(repositoryDirectory, 'target', 'wasm32-unknown-unknown', 'release', 'nano_rspow_web.wasm'),
], repositoryDirectory);

const generatedGlue = join(generatedDirectory, 'nano_rspow_web.js');
const generatedBinary = join(generatedDirectory, 'nano_rspow_web_bg.wasm');

// Start from an empty dist so a renamed or removed asset cannot survive as a
// leftover from an earlier build.
await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

console.log('Bundling the page…');
await build({
  entryPoints: [
    join(benchmarkDirectory, 'app.js'),
  ],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outdir: distDirectory,
  minify: false,
  plugins: [
    {
      // app.js imports './nano_rspow_web.js' to mean "the nano-rspow-web
      // module". That is the freshly generated glue, not a checked-in file.
      name: 'nano-rspow-web-module',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^\.\/nano_rspow_web\.js$/ }, () => ({ path: generatedGlue }));
      },
    },
  ],
});

await Promise.all([
  cp(join(benchmarkDirectory, 'index.html'), join(distDirectory, 'index.html')),
  cp(join(benchmarkDirectory, 'styles.css'), join(distDirectory, 'styles.css')),
  // The bundle inlines the glue, but the glue fetches the binary at runtime
  // relative to itself, so only this has to be copied.
  cp(generatedBinary, join(distDirectory, 'nano_rspow_web_bg.wasm')),
]);

console.log('Built dist/ with a freshly compiled nano-rspow-web module.');
