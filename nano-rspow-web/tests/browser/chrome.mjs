// A very small Chrome DevTools Protocol client, just enough to load a page,
// run a promise in it, and read the console back.
//
// The shared-generator concurrency test needs a real browser with real WebGPU:
// wgpu cannot find an adapter when the crate is built for the host, so this
// cannot run under `cargo test`. Driving Chrome directly keeps the test free of
// new dependencies, which matters because a browser test that needs an install
// step is a browser test that does not get run.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const LAUNCH_TIMEOUT_MS = 30_000;

/** Candidate Chrome builds, most preferred first. */
async function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  // A Playwright-managed build works too, so the test can reuse a browser that
  // is already on the machine instead of insisting on a system install.
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const legacyCache = join(homedir(), '.cache', 'ms-playwright');
  for (const root of [cache, legacyCache]) {
    if (!existsSync(root)) continue;
    const builds = (await readdir(root))
      .filter((entry) => entry.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const relative of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
      ]) {
        const candidate = join(root, build, relative);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'No Chrome or Chromium found. Install one, or set CHROME_PATH to a Chrome/Chromium executable.',
  );
}

/**
 * Flags for a headless browser with a usable WebGPU adapter.
 *
 * macOS reaches the real Metal adapter with the defaults, which matters because
 * forcing software rendering turns a sub-second check into an eight-second one.
 * Headless Linux usually has no hardware adapter, so there SwiftShader is the
 * only way the test can run at all.
 */
function launchFlags(userDataDirectory) {
  const flags = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    // A container has no user namespaces, so Chrome's sandbox cannot start. It
    // exits immediately and never writes DevToolsActivePort, which surfaces as
    // "Chrome did not report a DevTools port" with nothing to explain it. This
    // is a throwaway profile in a CI container, not a browsing session.
    '--no-sandbox',
    '--disable-gpu-sandbox',
    // Chrome ships WebGPU behind this flag in headless builds.
    '--enable-unsafe-webgpu',
    // Keep Chrome off the system keychain. The throwaway profile above has to
    // generate a "Safe Storage" key, and on macOS that lives in the login
    // keychain — so without these Chrome puts up a modal asking for permission
    // and the launch blocks until someone answers it. Chrome for Testing is
    // signed differently from a normally installed Chrome, which is what makes
    // macOS treat it as a new app wanting access.
    '--password-store=basic',
  ];
  if (process.platform === 'darwin') {
    flags.push('--use-mock-keychain');
  }
  if (process.platform === 'linux') {
    flags.push('--use-angle=swiftshader', '--enable-features=Vulkan');
  }
  return flags;
}


async function waitForDevToolsPort(userDataDirectory) {
  const portFile = join(userDataDirectory, 'DevToolsActivePort');
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split('\n');
      if (port?.trim()) return Number(port.trim());
    }
    await delay(50);
  }
  throw new Error(`Chrome did not report a DevTools port within ${LAUNCH_TIMEOUT_MS} ms.`);
}

/**
 * Launch Chrome, open `url`, and return a handle for evaluating code in it.
 *
 * `evaluate` runs an async expression in the page and resolves with its value.
 * Console output is captured so callers can count what the module logged.
 */
export async function openPage(url) {
  const executable = await findChrome();
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'nano-rspow-browser-test-'));

  // stderr is captured rather than ignored. When Chrome refuses to start, that
  // stream is the only thing that says why.
  const child = spawn(executable, [
    ...launchFlags(userDataDirectory),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let chromeStderr = '';
  child.stderr?.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-4000);
  });
  const chromeDiagnostics = () => chromeStderr.trim();

  let socket;
  const consoleLines = [];
  const pending = new Map();
  let nextId = 0;
  const loadWaiters = [];

  const close = async () => {
    try {
      socket?.close();
    } catch {
      // The socket may already be gone if Chrome exited.
    }
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(userDataDirectory, { recursive: true, force: true });
  };

  try {
    const port = await waitForDevToolsPort(userDataDirectory);

    // Attach to the initial about:blank target.
    let target;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (target) break;
      await delay(50);
    }
    if (!target) throw new Error('Chrome exposed no attachable page target');

    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', () => rejectOpen(new Error('DevTools socket failed')), { once: true });
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const line = message.params.args
          .map((argument) => argument.value ?? argument.description ?? '')
          .join(' ');
        consoleLines.push(line);
        // Anything logged as an error is a genuine page failure; surface it as
        // a rejection so a broken module cannot look like a passing test.
        if (message.params.type === 'error' || message.params.type === 'assert') {
          loadWaiters.push({ reject: new Error(line) });
        }
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        loadWaiters.push({
          reject: new Error(details.exception?.description ?? details.text ?? 'page exception'),
        });
        return;
      }
      if (message.method === 'Page.loadEventFired') {
        for (const waiter of loadWaiters.splice(0)) waiter.resolve?.();
      }
    });

    const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      const id = (nextId += 1);
      pending.set(id, { resolve: resolveCall, reject: rejectCall });
      socket.send(JSON.stringify({ id, method, params }));
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url });
    await new Promise((resolveLoad, rejectLoad) => {
      loadWaiters.push({ resolve: resolveLoad, reject: rejectLoad });
      // Do not hang forever if the page never fires load.
      setTimeout(() => rejectLoad(new Error(`page did not load within ${LAUNCH_TIMEOUT_MS} ms`)), LAUNCH_TIMEOUT_MS)
        .unref?.();
    });

    return {
      consoleLines,
      close,
      /**
       * Evaluate an async expression in the page and return its value.
       *
       * Bounded twice on purpose. The page-side race covers the case where the
       * module stops settling its promises — a panic inside the WebAssembly
       * instance leaves every pending promise unresolved rather than rejecting,
       * so without it a wedged module reads as a hung test instead of a failed
       * one. The CDP-side deadline is the backstop for a page that has stopped
       * responding entirely.
       */
      async evaluate(body, { timeoutMs = 60_000 } = {}) {
        const guarded = `
          const __deadline = new Promise((_, reject) => setTimeout(
            () => reject(new Error(
              'the page never settled within ${timeoutMs} ms — the WebAssembly module is likely wedged'
            )),
            ${timeoutMs},
          ));
          return Promise.race([Promise.resolve().then(async () => { ${body} }), __deadline]);
        `;

        const evaluation = send('Runtime.evaluate', {
          expression: `(async () => { ${guarded} })()`,
          awaitPromise: true,
          returnByValue: true,
        });

        let deadline;
        const result = await Promise.race([
          evaluation,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error(`the page stopped responding after ${timeoutMs} ms`)),
              timeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(deadline));

        if (result.exceptionDetails) {
          throw new Error(
            result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed',
          );
        }
        return result.result.value;
      },
    };
  } catch (error) {
    const detail = chromeDiagnostics();
    await close();
    throw new Error(`${error.message}${detail ? `\nChrome said:\n${detail}` : ''}`);
  }
}
