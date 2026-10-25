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
  it('rejects every PoW generation entrypoint on the Window thread', { timeout: 30_000 }, async () => {
    const result = await page.evaluate(`
        const module = await import('/nano_rspow_web.js');
        await module.default();
        const errors = [];
        for (const generate of [
          () => module.generate_work_cpu_batch('0'.repeat(64), 'ffffffffffffffff', 0xffffffff),
          () => module.generate_work_cpu('0'.repeat(64), 'ffffffffffffffff'),
          () => module.generate_work('0'.repeat(64), 'ffffffffffffffff'),
          () => {
            const token = new module.WasmCancelToken();
            return module.generate_work_gpu('0'.repeat(64), 'ffffffffffffffff', token).finally(() => token.free());
          },
        ]) {
          try { await generate(); errors.push('unexpected success'); }
          catch (error) { errors.push(String(error)); }
        }
        const probe = await module.probe_local_pow();
        let ticks = 0;
        const heartbeat = setInterval(() => ticks++, 1);
        await new Promise(resolve => setTimeout(resolve, 20));
        clearInterval(heartbeat);
        return { errors, probe, ticks };
      `, { timeoutMs: 10_000 });

      assert.equal(result.errors.length, 4);
      for (const error of result.errors) {
        assert.match(error, /dedicated Worker/);
      }
      assert.equal(result.probe, false, 'Window probes must refuse local work without benchmarking');
      assert.ok(result.ticks > 0, 'the Window heartbeat should continue while PoW is refused');
  });

  it('keeps concurrent high-level work valid inside the Worker', { timeout: 300_000 }, async () => {
    const outcome = await page.evaluate(`
      const api = await import('/index.js');
      const module = await import('/nano_rspow_web.js');
      const assessment = await api.probeLocalPow();
      if (!assessment.recommended) return { skipped: assessment.reason };

      const cases = ${JSON.stringify(CASES)};
      const startedAt = performance.now();
      const results = await Promise.all(
        cases.map((testCase, index) =>
          api.generateWork(testCase.root, testCase.threshold, { timeoutMs: 30000 })
            .then((result) => {
              globalThis.__progress.push('case ' + index + ' (' + Math.round(performance.now() - startedAt) + ' ms)');
              return { testCase, result };
            }),
        ),
      );
      const elapsedMs = performance.now() - startedAt;
      await module.default();

      const checked = results.map(({ testCase, result }) => ({
        root: testCase.root.slice(0, 8),
        threshold: testCase.threshold,
        nonce: result.nonce,
        backend: result.backend,
        valid: module.validate_work(testCase.root, result.nonce, testCase.threshold) === true,
      }));

      return { checked, assessment, elapsedMs, expected: cases.length };
    `, { timeoutMs: 180_000 });

    if (outcome.skipped) {
      // Report loudly rather than quietly passing, so a green run on a machine
      // without WebGPU is not mistaken for coverage.
      console.warn(`    skipped: ${outcome.skipped}`);
      return;
    }

    assert.equal(outcome.checked.length, outcome.expected, 'every case should have produced a result');

    for (const check of outcome.checked) {
      assert.ok(['webgpu', 'cpu'].includes(check.backend), `case ${check.root}… used an unknown backend`);
      assert.ok(
        check.valid,
        `nonce ${check.nonce} does not satisfy root ${check.root}… at threshold ${check.threshold} — `
        + 'a concurrent call read back another call\'s result',
      );
    }

    console.log(
      `    ${outcome.checked.length} concurrent calls using ${outcome.assessment.backend}, `
      + `${Math.round(outcome.elapsedMs)} ms`,
    );
  });
});

it('high-level Worker API validates concurrent work and recovers after cancellation', { timeout: 30000 }, async () => {
  const result = await page.evaluate(`
    const api = await import('/index.js');
    const assessment = await api.probeLocalPow();
    const roots = ['4'.repeat(64), '5'.repeat(64)];
    const results = await Promise.all(roots.map(root => api.generateWork(root, 'ff00000000000000', { timeoutMs: 10000 })));
    const engine = api.createPowEngine();
    await engine.ready();
    const valid = results.every((result, i) => engine.validate(roots[i], result.nonce, 'ff00000000000000'));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    let cancelled = false;
    try {
      await api.generateWork(roots[0], 'ffffffffffffffff', { signal: controller.signal, timeoutMs: 5000 });
    } catch (error) { cancelled = error.name === 'AbortError'; }
    const recovered = await api.generateWork(roots[0], 'ff00000000000000', { timeoutMs: 10000 });
    return { valid, cancelled, recovered: api.validate_work(roots[0], recovered.nonce, 'ff00000000000000'), assessment };
  `, { timeoutMs: 25000 });
  assert.equal(result.valid, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.recovered, true);
});

// Runs in a disposable Worker so browser API instrumentation cannot affect
// other tests. No fault-injection exports are added to the production package.
async function readbackFailureWorker({ data: { mode, moduleUrl } }) {
  try {
    const module = await import(moduleUrl);
    await module.default();
    const devices = [];
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await requestDevice.apply(this, args);
      devices.push(device);
      return device;
    };
    const mapAsync = GPUBuffer.prototype.mapAsync;
    const getMappedRange = GPUBuffer.prototype.getMappedRange;
    const failedBuffers = new WeakSet();
    let injected = false;
    let invalidReads = 0;
    GPUBuffer.prototype.getMappedRange = function (...args) {
      if (failedBuffers.has(this)) invalidReads++;
      return getMappedRange.apply(this, args);
    };
    GPUBuffer.prototype.mapAsync = function (...args) {
      if (injected) return mapAsync.apply(this, args);
      injected = true;
      failedBuffers.add(this);
      if (mode === 'reject') {
        return new Promise((_, reject) => setTimeout(() => {
          reject(new DOMException('Injected mapping failure', 'OperationError'));
        }, 25));
      }
      const mapping = mapAsync.apply(this, args);
      devices.at(-1).destroy();
      return mapping;
    };
    const root = '6'.repeat(64);
    const threshold = 'ff00000000000000';
    const generate = async () => {
      const token = new module.WasmCancelToken();
      try {
        const result = await module.generate_work_gpu(root, threshold, token);
        try {
          return { valid: module.validate_work(root, result.nonce, threshold), gpu: result.is_gpu };
        } finally { result.free(); }
      } finally { token.free(); }
    };
    // The second call must recover after the first fails while holding the gate.
    const results = await Promise.allSettled([generate(), generate()]);
    self.postMessage({
      injected,
      invalidReads,
      devices: devices.length,
      first: results[0].status,
      error: String(results[0].reason),
      second: results[1].status,
      recovered: results[1].value,
    });
  } catch (error) {
    self.postMessage({ setupError: String(error?.stack ?? error) });
  }
}

for (const mode of ['reject', 'device-loss']) {
  it(`recovers queued GPU work after ${mode} during mapping`, { timeout: 60000 }, async () => {
    const result = await page.evaluate(`
      const source = 'self.onmessage = ' + ${JSON.stringify(readbackFailureWorker.toString())};
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      let ticks = 0;
      const heartbeat = setInterval(() => ticks++, 5);
      try {
        const result = await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => resolve(data);
          worker.onerror = event => reject(new Error(event.message));
          worker.postMessage({ mode: ${JSON.stringify(mode)}, moduleUrl: location.origin + '/nano_rspow_web.js' });
        });
        return { ...result, ticks };
      } finally {
        clearInterval(heartbeat);
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    `, { timeoutMs: 45000 });
    assert.equal(result.setupError, undefined, result.setupError);
    assert.equal(result.injected, true);
    assert.equal(result.first, 'rejected');
    assert.match(result.error, /readback (mapping failed|device lost)|device lost during readback/i);
    assert.doesNotMatch(result.error, /RuntimeError|unreachable/i);
    assert.equal(result.invalidReads, 0, 'must not read a buffer whose mapping failed');
    assert.equal(result.devices, 2, 'queued work must create a replacement device');
    assert.equal(result.second, 'fulfilled');
    assert.deepEqual(result.recovered, { valid: true, gpu: true });
    assert.ok(result.ticks > 0, 'the Window heartbeat must continue during failure and recovery');
  });
}
