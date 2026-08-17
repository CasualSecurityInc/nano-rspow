import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(benchmarkDirectory, '..', '..');
const distDirectory = join(benchmarkDirectory, 'dist');
const cliPath = process.env.NANO_RSPOW_CLI ?? join(repositoryDirectory, 'target', 'release', 'nano-rspow');
const require = createRequire(import.meta.url);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const rootPattern = /^[0-9a-fA-F]{64}$/;
const thresholdPattern = /^[0-9a-fA-F]{16}$/;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024) reject(new Error('request body is too large'));
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(body));
      } catch {
        reject(new Error('request body must be JSON'));
      }
    });
    request.on('error', reject);
  });
}

function requestFields(body) {
  if (!rootPattern.test(body?.root ?? '') || !thresholdPattern.test(body?.threshold ?? '')) {
    throw new Error('root must be 64 hex characters and threshold must be 16 hex characters');
  }
  return { root: body.root.toLowerCase(), threshold: body.threshold.toLowerCase() };
}

class CliStream {
  constructor() {
    this.pending = null;
    this.error = null;
    this.stderr = '';
    this.stdout = '';
    this.child = spawn(cliPath, ['generate', '--stream', '--backend', 'gpu'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4096);
      if (/\b(error|fatal|panic)\b/i.test(chunk)) this.fail(new Error(`CLI stderr: ${chunk.trim()}`));
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`CLI exited (${signal ?? code ?? 'unknown'})${this.stderr ? `: ${this.stderr.trim()}` : ''}`)));
  }

  get ready() {
    return !this.error && !this.child.killed && this.child.exitCode === null;
  }

  fail(error) {
    if (this.error) return;
    this.error = error;
    if (this.pending) {
      this.pending.reject(error);
      this.pending = null;
    }
  }

  onStdout(chunk) {
    this.stdout += chunk;
    let newline;
    while ((newline = this.stdout.indexOf('\n')) !== -1) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending;
      if (!pending) return this.fail(new Error(`CLI returned an unexpected response: ${line}`));
      const expected = `${pending.root}:0x${pending.threshold}:`;
      if (!line.startsWith(expected) || !/^[0-9a-fA-F]{16}$/.test(line.slice(expected.length))) {
        return this.fail(new Error(`CLI returned malformed output: ${line}`));
      }
      this.pending = null;
      pending.resolve({ work: line.slice(expected.length).toLowerCase(), providerMs: performance.now() - pending.startedAt, backend: 'CLI stream (--backend gpu)' });
    }
  }

  generate(root, threshold) {
    if (!this.ready) return Promise.reject(this.error ?? new Error('CLI stream is unavailable'));
    if (this.pending) return Promise.reject(new Error('CLI stream is busy; requests must be serialized'));
    return new Promise((resolveResult, reject) => {
      this.pending = { root, threshold, startedAt: performance.now(), resolve: resolveResult, reject };
      this.child.stdin.write(`${root}:0x${threshold}\n`, (error) => {
        if (error) this.fail(error);
      });
    });
  }

  close() {
    this.child.kill();
  }
}

let addon;
let nodeError = null;
try {
  addon = require(join(repositoryDirectory, 'nano-rspow-node', 'index.js'));
  addon.getBackendName();
} catch (error) {
  nodeError = error;
}
const cli = new CliStream();

async function serveFile(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(distDirectory, relativePath);
  if (!filePath.startsWith(`${distDirectory}/`)) return respond(response, 403, { error: 'forbidden' });
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' });
    response.end(data);
  } catch {
    respond(response, 404, { error: 'not found' });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/health') {
    return respond(response, cli.ready && !nodeError ? 200 : 503, {
      cli: { ready: cli.ready, error: cli.error ? errorMessage(cli.error) : undefined },
      node: { ready: !nodeError, backend: !nodeError ? addon.getBackendName() : undefined, error: nodeError ? errorMessage(nodeError) : undefined },
    });
  }
  if (request.method === 'POST' && (request.url === '/api/pow/cli' || request.url === '/api/pow/node')) {
    try {
      const { root, threshold } = requestFields(await readJson(request));
      const result = request.url === '/api/pow/cli'
        ? await cli.generate(root, threshold)
        : await (async () => {
          if (nodeError) throw nodeError;
          const startedAt = performance.now();
          const work = await addon.generateWork(root, addon.WorkType.Send);
          return { work, providerMs: performance.now() - startedAt, backend: addon.getBackendName() };
        })();
      console.log(JSON.stringify({
        provider: request.url === '/api/pow/cli' ? 'nano-rspow CLI' : 'nano-rspow-node',
        root,
        threshold,
        ...result,
      }));
      return respond(response, 200, result);
    } catch (error) {
      return respond(response, 503, { error: errorMessage(error) });
    }
  }
  if (request.method === 'GET') return serveFile(request, response);
  respond(response, 405, { error: 'method not allowed' });
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, '127.0.0.1', () => console.log(`Benchmark bridge listening at http://localhost:${port}`));
process.on('SIGINT', () => server.close(() => cli.close()));
process.on('SIGTERM', () => server.close(() => cli.close()));
