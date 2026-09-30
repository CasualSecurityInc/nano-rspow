// Concurrency regression test for the shared WebGPU generator.
//
// `nano-rspow-web` builds one WebGPU generator per page and reuses it. The
// generator's ping-pong buffers are shared resources, so overlapping
// `generate_work` calls would write the same slot and read back each other's
// results, returning work computed for a different block. Generation is
// therefore serialised by a gate in `webgpu.rs`.
//
// The companion unit tests in `webgpu.rs` cover the gate's state machine. This
// covers the real WebGPU path around it, which needs a browser: wgpu finds no
// adapter when the crate is built for the host, so this cannot run under
// `cargo test`.
//
// Run with `npm run test:browser` from `nano-rspow-web/`.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openPage } from './chrome.mjs';

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Easy dev-band thresholds so the test stays quick. The aliasing being guarded
// against depends on which slot a call writes, not on how hard the work is.
const CASES = [
  { root: '0'.repeat(63) + '1', threshold: 'ffff000000000000' },
  { root: '1'.repeat(64), threshold: 'fffffe0000000000' },
  { root: '2'.repeat(64), threshold: 'fffffc0000000000' },
  { root: '3'.repeat(64), threshold: 'fffffd0000000000' },
];

const MIME_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

let server;
let origin;
let page;

before(async () => {
  for (const required of ['nano_rspow_web.js', 'nano_rspow_web_bg.wasm']) {
    assert.ok(
      existsSync(join(webDirectory, required)),
      `${required} is missing. Run \`npm run build\` in nano-rspow-web/ first.`,
    );
  }

  // Serve the built module over http: ES module imports and
  // instantiateStreaming both need a real origin, and file:// gives neither.
  server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (name === 'index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><title>nano-rspow-web test</title>');
      return;
    }
    try {
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(join(webDirectory, name));
      response.writeHead(200, {
        'content-type': MIME_TYPES[extname(name)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
  page = await openPage(`${origin}/`);
});

after(async () => {
  await page?.close();
  // Chrome holds keep-alive connections open, and a bare close() waits for them
  // to drain, which turns teardown into minutes. The browser is already gone by
  // this point, so nothing is lost by cutting them.
  server?.closeAllConnections?.();
  await new Promise((resolveClose) => server?.close(resolveClose));
});

describe('shared WebGPU generator', () => {
  it('gives every concurrent generate_work call work valid for its own inputs', { timeout: 300_000 }, async () => {
    const outcome = await page.evaluate(`
      const module = await import('/nano_rspow_web.js');
      await module.default();

      const cases = ${JSON.stringify(CASES)};

      // Without a working adapter there is no shared generator to test, so this
      // is not applicable rather than a failure. A browser falling back to the
      // CPU is a supported configuration, not a broken build.
      if (!navigator.gpu) return { skipped: 'navigator.gpu is unavailable' };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { skipped: 'no WebGPU adapter available' };

      // Count device bring-ups. The cached generator logs this at most once
      // across every call; more than one means it is being rebuilt per call.
      let bringUps = 0;
      const realLog = console.log;
      console.log = function (...args) {
        const first = args[0];
        if (typeof first === 'string' && first.includes('Initialization complete')) bringUps += 1;
        return realLog.apply(console, args);
      };

      const startedAt = performance.now();
      // Every call starts before any is awaited, so they overlap.
      const results = await Promise.all(
        cases.map((testCase, index) =>
          module.generate_work(testCase.root, testCase.threshold)
            .then((result) => {
              globalThis.__progress.push('case ' + index + ' (' + Math.round(performance.now() - startedAt) + ' ms)');
              return { testCase, result };
            }),
        ),
      );
      const elapsedMs = performance.now() - startedAt;
      console.log = realLog;

      const checked = results.map(({ testCase, result }) => ({
        root: testCase.root.slice(0, 8),
        threshold: testCase.threshold,
        nonce: result.nonce,
        isGpu: result.is_gpu === true,
        valid: module.validate_work(testCase.root, result.nonce, testCase.threshold) === true,
      }));

      return { checked, bringUps, elapsedMs, expected: cases.length };
    `, { timeoutMs: 180_000 });

    if (outcome.skipped) {
      // Report loudly rather than quietly passing, so a green run on a machine
      // without WebGPU is not mistaken for coverage.
      console.warn(`    skipped: ${outcome.skipped}`);
      return;
    }

    assert.equal(outcome.checked.length, outcome.expected, 'every case should have produced a result');

    for (const check of outcome.checked) {
      assert.ok(
        check.isGpu,
        `case ${check.root}… fell back to the CPU, so the shared generator was not exercised`,
      );
      assert.ok(
        check.valid,
        `nonce ${check.nonce} does not satisfy root ${check.root}… at threshold ${check.threshold} — `
        + 'a concurrent call read back another call\'s result',
      );
    }

    assert.ok(
      outcome.bringUps <= 1,
      `observed ${outcome.bringUps} device bring-ups across ${outcome.expected} concurrent calls; `
      + 'the generator is being rebuilt per call instead of reused',
    );

    console.log(
      `    ${outcome.checked.length} concurrent calls, ${outcome.bringUps} device bring-up(s), `
      + `${Math.round(outcome.elapsedMs)} ms`,
    );
  });
});
