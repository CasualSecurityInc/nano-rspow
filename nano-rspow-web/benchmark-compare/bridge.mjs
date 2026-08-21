import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(benchmarkDirectory, '..', '..');
const distDirectory = join(benchmarkDirectory, 'dist');
const nanoRpcUrl = process.env.NANO_NODE_RPC_URL ?? `http://127.0.0.1:${process.env.NANO_NODE_RPC_PORT ?? '7076'}`;
const require = createRequire(import.meta.url);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const rootPattern = /^[0-9a-fA-F]{64}$/;
const thresholdPattern = /^[0-9a-fA-F]{16}$/;
const workPattern = /^[0-9a-fA-F]{16}$/;

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

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Nano node RPC returned non-JSON status ${response.status}`);
  }
}

async function rpcRequest(action) {
  const response = await fetch(nanoRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(`Nano node RPC returned HTTP ${response.status}`);
  if (body?.error) throw new Error(`Nano node RPC: ${body.error}`);
  return body;
}

async function generateViaRpc(root, threshold) {
  const startedAt = performance.now();
  const response = await fetch(nanoRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'work_generate', hash: root, difficulty: threshold }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(`Nano node RPC returned HTTP ${response.status}`);
  if (body?.error) throw new Error(`Nano node RPC: ${body.error}`);
  if (!workPattern.test(body?.work ?? '')) throw new Error('Nano node RPC returned malformed work');
  return {
    work: body.work.toLowerCase(),
    providerMs: performance.now() - startedAt,
    backend: `Nano node RPC (${new URL(nanoRpcUrl).host})`,
  };
}

let addon;
let nodeError = null;
try {
  addon = require(join(repositoryDirectory, 'nano-rspow-node', 'index.js'));
  addon.getBackendName();
} catch (error) {
  nodeError = error;
}

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
    try {
      await rpcRequest('version');
    } catch (error) {
      return respond(response, 503, {
        error: errorMessage(error),
        rpc: { ready: false, url: nanoRpcUrl, error: errorMessage(error) },
        node: { ready: !nodeError, backend: !nodeError ? addon.getBackendName() : undefined, error: nodeError ? errorMessage(nodeError) : undefined },
      });
    }
    return respond(response, !nodeError ? 200 : 503, {
      rpc: { ready: true, url: nanoRpcUrl },
      node: { ready: !nodeError, backend: !nodeError ? addon.getBackendName() : undefined, error: nodeError ? errorMessage(nodeError) : undefined },
    });
  }
  if (request.method === 'POST' && (request.url === '/api/pow/rpc' || request.url === '/api/pow/node')) {
    try {
      const { root, threshold } = requestFields(await readJson(request));
      const result = request.url === '/api/pow/rpc'
        ? await generateViaRpc(root, threshold)
        : await (async () => {
          if (nodeError) throw nodeError;
          const startedAt = performance.now();
          const work = await addon.generateWork(root, addon.WorkType.Send);
          return { work, providerMs: performance.now() - startedAt, backend: addon.getBackendName() };
        })();
      console.log(JSON.stringify({
        provider: request.url === '/api/pow/rpc' ? 'Nano node RPC' : 'nano-rspow-node',
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
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
