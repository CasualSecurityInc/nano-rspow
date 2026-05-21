var __toBinary = Uint8Array.fromBase64 || /* @__PURE__ */ (() => {
  var table = new Uint8Array(128);
  for (var i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
  return (base64) => {
    var n = base64.length, bytes = new Uint8Array((n - (base64[n - 1] == "=") - (base64[n - 2] == "=")) * 3 / 4 | 0);
    for (var i2 = 0, j = 0; i2 < n; ) {
      var c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
      var c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
      bytes[j++] = c0 << 2 | c1 >> 4;
      bytes[j++] = c1 << 4 | c2 >> 2;
      bytes[j++] = c2 << 6 | c3;
    }
    return bytes;
  };
})();

// src/utils/api-support/wasm.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var wasm = { isSupported: false };
Object.defineProperty(wasm, "isSupported", {
  get: async function() {
    let isWasmSupported = false;
    try {
      const wasmBuffer = new Uint8Array([
        0,
        97,
        115,
        109,
        1,
        0,
        0,
        0,
        // WASM magic header and version
        1,
        4,
        // Type section, 4 byte descriptor
        1,
        96,
        0,
        0,
        // 1 type, type function, 0 params, 0 returns
        3,
        2,
        // Function section, 2 byte descriptor
        1,
        0,
        // 1 function, ID 0
        10,
        23,
        // Code section, 23 bytes
        1,
        21,
        // 1 function body, 21 bytes
        0,
        // 0 local variables
        253,
        12,
        // v128.const
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        // assign i64x2 values
        26,
        11
        // Drop result, end function
      ]);
      const module = await WebAssembly.compile(wasmBuffer);
      const instance = await WebAssembly.instantiate(module);
      isWasmSupported = instance instanceof WebAssembly.Instance;
    } catch (err) {
      console.warn("WASM is not supported in this environment.\n", err.message ?? err);
      isWasmSupported = false;
    } finally {
      delete this.isSupported;
      this.isSupported = isWasmSupported;
      return this.isSupported;
    }
  }
});

// src/utils/api-support/webgl.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var webgl = { isSupported: false };
Object.defineProperty(webgl, "isSupported", {
  get: async function() {
    let isWebglSupported = false;
    try {
      const gl2 = new OffscreenCanvas(0, 0)?.getContext?.("webgl2");
      isWebglSupported = gl2 instanceof WebGL2RenderingContext && !gl2.isContextLost();
    } catch (err) {
      console.warn("WebGL is not supported in this environment.\n", err);
      isWebglSupported = false;
    } finally {
      delete this.isSupported;
      this.isSupported = isWebglSupported;
      return this.isSupported;
    }
  }
});

// src/utils/api-support/webgpu.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var webgpu = { isSupported: false };
Object.defineProperty(webgpu, "isSupported", {
  get: async function() {
    let isWebgpuSupported = false;
    try {
      const adapter = await navigator?.gpu?.requestAdapter?.();
      isWebgpuSupported = adapter instanceof GPUAdapter;
    } catch (err) {
      console.warn("WebGPU is not supported in this environment.\n", err);
      isWebgpuSupported = false;
    } finally {
      delete this.isSupported;
      this.isSupported = isWebgpuSupported;
      return this.isSupported;
    }
  }
});

// src/utils/api-support/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var ApiSupport = { cpu: { isSupported: true }, wasm, webgl, webgpu };

// src/utils/bigint.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
function bigintAsUintNArray(int, bits, length = 0) {
  const UintTypedArray = {
    8: Uint8Array,
    16: Uint16Array,
    32: Uint32Array,
    64: BigUint64Array
  };
  if (![8, 16, 32, 64].includes(bits)) throw new Error("Invalid TypedArray UintN subclass");
  if (int < 0n) int = ~(int - 1n);
  length = Math.max(length, Math.ceil(bigintByteLength(int) / bits));
  const mask = (1n << BigInt(bits)) - 1n;
  const uintArray = new UintTypedArray[bits](length);
  for (let i = length - 1; i >= 0; i--) {
    bits === 64 ? uintArray[i] = int & mask : uintArray[i] = Number(int & mask);
    int >>= BigInt(bits);
  }
  return uintArray;
}
function bigintBitLength(int) {
  let bitLength = 1n;
  while (int > 1n || int < -1n) {
    bitLength++;
    int >>= 1n;
  }
  return bitLength;
}
function bigintByteLength(int) {
  let byteLength = 0;
  while (int > 0n || int < -1n) {
    byteLength++;
    int >>= 8n;
  }
  return byteLength;
}
function bigintFrom(value, type) {
  if (typeof value === "bigint") {
    return value;
  } else if (typeof value === "boolean" || typeof value === "number") {
    return BigInt(value);
  } else if (typeof value === "string") {
    const v3 = value.trim().replace(/n$/, "");
    if (/^0[Bb][01]+$/.test(v3) || /^0[Oo][0-7]+$/.test(v3) || /^0[Xx][A-Fa-f\d]+$/.test(v3) || /^\d+$/.test(v3)) {
      return BigInt(v3);
    }
    if (type === "bin" && /^[01]+$/.test(v3)) {
      return BigInt(`0b${v3}`);
    }
    if (type === "oct" && /^[0-7]+$/.test(v3)) {
      return BigInt(`0o${v3}`);
    }
    if (type === "hex" || /^\d*[A-Fa-f]+\d*$/.test(v3)) {
      return BigInt(`0x${v3}`);
    }
  }
  throw new TypeError(`can't convert string to BigInt`);
}
function bigintRandom(max = 0xFFFFFFFFFFFFFFFFn) {
  if (typeof max !== "bigint" || max < 1n) {
    throw new TypeError("Invalid max value");
  }
  const randomUint8Array = new Uint8Array(bigintByteLength(max));
  const mask = (1n << bigintBitLength(max)) - 1n;
  let output = 0n;
  do {
    output = 0n;
    crypto.getRandomValues(randomUint8Array);
    output = BigInt(randomUint8Array[0]);
    for (let i = 1; i < randomUint8Array.length; i++) {
      output <<= 8n;
      output += BigInt(randomUint8Array[i]);
    }
    output &= mask;
  } while (output > max);
  return output;
}
function bigintToHex(int, length = 0) {
  if (typeof length !== "number") {
    throw new TypeError("invalid length");
  }
  return int.toString(16).padStart(length, "0");
}

// src/utils/cache.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var Cache = class {
  static clear() {
    this.#removeItem("NanoPowCache");
  }
  static search(hash, difficulty) {
    const bigintHash = bigintFrom(hash, "hex");
    const item = this.#getItem("NanoPowCache");
    if (item) {
      const cache = JSON.parse(item);
      for (const c of cache) {
        if (bigintFrom(c.hash, "hex") === bigintHash && bigintFrom(c.difficulty, "hex") >= difficulty) {
          return c;
        }
      }
    }
    return null;
  }
  static store(result2) {
    const item = this.#getItem("NanoPowCache");
    const cache = JSON.parse(item ?? "[]");
    if (cache.push(result2) > 1e3) cache.shift();
    this.#setItem("NanoPowCache", JSON.stringify(cache));
    return result2;
  }
  static #storage = {};
  static #getItem(key) {
    if (globalThis?.localStorage) return globalThis.localStorage.getItem(key);
    return this.#storage[key];
  }
  static #removeItem(key) {
    if (globalThis?.localStorage) return globalThis.localStorage.removeItem(key);
    this.#storage = {};
  }
  static #setItem(key, item) {
    if (globalThis?.localStorage) return globalThis.localStorage.setItem(key, item);
    this.#storage[key] = item;
  }
};

// src/utils/logger.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var Logger = class {
  isEnabled = false;
  groups = {};
  groupStart(name) {
    if (this.isEnabled) {
      console.groupCollapsed(name);
      this.groups[name] = true;
    }
  }
  groupEnd(name) {
    if (this.groups[name]) {
      console.groupEnd();
      delete this.groups[name];
    }
  }
  log(...args) {
    if (this.isEnabled) {
      const datetime = new Date(Date.now()).toLocaleString(Intl.DateTimeFormat().resolvedOptions().locale ?? "en-US", { hour12: false, dateStyle: "medium", timeStyle: "medium" });
      for (let i = 0; i < args.length; i++) {
        if (typeof args[i] === "string") {
          args[i] = args[i].replace(datetime, "").trimStart();
        }
        if (args[i] instanceof Error) {
          if ("stack" in args[i]) {
            args.splice(i + 1, 0, args[i].stack);
          } else if ("message" in args[i]) {
            args.splice(i + 1, 0, args[i].message);
          }
        }
      }
      const entry = `${datetime} ${globalThis.process?.title ?? "NanoPow"}[${globalThis.process?.pid ?? "browser"}]:`;
      console.log(entry, ...args);
      globalThis.process?.send?.({ type: "console", data: `${entry} ${args}` });
    }
  }
};

// src/utils/queue.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var Queue = class {
  #isIdle;
  #queue;
  constructor() {
    this.#isIdle = true;
    this.#queue = [];
  }
  #process = () => {
    const { task, resolve, reject, args } = this.#queue.shift() ?? {};
    this.#isIdle = !task;
    task?.(...args).then(resolve).catch(reject).finally(this.#process);
  };
  async add(task, ...args) {
    if (typeof task !== "function") throw new TypeError("task is not a function");
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject, args });
      if (this.#isIdle) this.#process();
    });
  }
  async prioritize(task, ...args) {
    if (typeof task !== "function") throw new TypeError("task is not a function");
    return new Promise((resolve, reject) => {
      if (typeof task !== "function") reject("task is not a function");
      this.#queue.unshift({ task, resolve, reject, args });
      if (this.#isIdle) this.#process();
    });
  }
};

// src/utils/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var clearCache = Cache.clear;
var SEND = 0xfffffff800000000n;
var RECEIVE = 0xfffffe0000000000n;
function stats(times) {
  if (times == null || times.length === 0) return null;
  const count = times.length;
  const truncatedStart = Math.floor(count * 0.1);
  const truncatedEnd = count - truncatedStart;
  const truncatedCount = truncatedEnd - truncatedStart;
  let min = Number.MAX_SAFE_INTEGER;
  let logarithms, max, median, reciprocals, total;
  logarithms = max = median = reciprocals = total = 0;
  let truncatedMin = Number.MAX_SAFE_INTEGER;
  let truncatedLogarithms, truncatedMax, truncatedReciprocals, truncatedTotal;
  truncatedLogarithms = truncatedMax = truncatedReciprocals = truncatedTotal = 0;
  times.sort((a, b) => a - b);
  for (let i = 0; i < count; i++) {
    const time = times[i];
    total += time;
    logarithms += Math.log(time);
    reciprocals += 1 / time;
    min = Math.min(min, time);
    max = Math.max(max, time);
    if (i === Math.floor((count - 1) / 2)) median = time;
    if (i === Math.floor(count / 2) && count % 2 === 0) median = (median + time) / 2;
  }
  for (let i = truncatedStart; i < truncatedEnd; i++) {
    const time = times[i];
    truncatedTotal += time;
    truncatedLogarithms += Math.log(time);
    truncatedReciprocals += 1 / time;
    truncatedMin = Math.min(truncatedMin, time);
    truncatedMax = Math.max(truncatedMax, time);
  }
  return {
    count,
    total,
    rate: 1e3 * count / total,
    min,
    max,
    median,
    arithmetic: total / count,
    geometric: Math.exp(logarithms / count),
    harmonic: count / reciprocals,
    truncatedCount,
    truncatedTotal,
    truncatedRate: 1e3 * truncatedCount / truncatedTotal,
    truncatedMin,
    truncatedMax,
    truncatedArithmetic: truncatedTotal / truncatedCount,
    truncatedGeometric: Math.exp(truncatedLogarithms / truncatedCount),
    truncatedHarmonic: truncatedCount / truncatedReciprocals
  };
}

// src/lib/validate/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var logger = new Logger();
var blake2b_IV = Object.freeze([
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n
]);
var blake2b_sigma = Object.freeze([
  Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
  Object.freeze([14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]),
  Object.freeze([11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4]),
  Object.freeze([7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8]),
  Object.freeze([9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13]),
  Object.freeze([2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9]),
  Object.freeze([12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11]),
  Object.freeze([13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10]),
  Object.freeze([6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5]),
  Object.freeze([10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]),
  Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
  Object.freeze([14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3])
]);
var blake2b_param = 0x01010008n;
var v = new BigUint64Array(16);
var m = new BigUint64Array(16);
var mView = new DataView(m.buffer);
var result = 0n;
function G(a, b, c, d, x, y) {
  v[a] += v[b] + m[x];
  v[d] ^= v[a];
  v[d] = v[d] >> 32n | v[d] << 32n;
  v[c] += v[d];
  v[b] ^= v[c];
  v[b] = v[b] >> 24n | v[b] << 40n;
  v[a] += v[b] + m[y];
  v[d] ^= v[a];
  v[d] = v[d] >> 16n | v[d] << 48n;
  v[c] += v[d];
  v[b] ^= v[c];
  v[b] = v[b] >> 63n | v[b] << 1n;
}
function ROUND(i) {
  const s = blake2b_sigma[i];
  G(0, 4, 8, 12, s[0], s[1]);
  G(1, 5, 9, 13, s[2], s[3]);
  G(2, 6, 10, 14, s[4], s[5]);
  G(3, 7, 11, 15, s[6], s[7]);
  G(0, 5, 10, 15, s[8], s[9]);
  G(1, 6, 11, 12, s[10], s[11]);
  G(2, 7, 8, 13, s[12], s[13]);
  G(3, 4, 9, 14, s[14], s[15]);
}
function init(seed, hash) {
  result = 0n;
  for (let i = 0; i < 8; i++) {
    v[i] = blake2b_IV[i];
    v[i + 8] = blake2b_IV[i];
  }
  v[0] ^= blake2b_param;
  v[12] ^= 40n;
  v[14] = ~v[14];
  mView.setBigUint64(0, seed, true);
  for (let i = 0; i < 4; i++) {
    mView.setBigUint64(8 * (i + 1), hash[i]);
  }
}
function blake2b(work, hash) {
  init(work, bigintAsUintNArray(hash, 64, 4));
  for (let i = 0; i < 12; i++) {
    ROUND(i);
  }
  result = blake2b_IV[0] ^ 0x01010008n ^ v[0] ^ v[8];
}
function log(work, hash, difficulty) {
}
function validate(work, hash, difficulty, debug) {
  logger.isEnabled = debug;
  blake2b(work, hash);
  log(work, hash, difficulty);
  return {
    hash: bigintToHex(hash, 64),
    work: bigintToHex(work, 16),
    difficulty: bigintToHex(result, 16),
    valid: result >= difficulty ? "1" : "0",
    valid_all: result >= SEND ? "1" : "0",
    valid_receive: result >= RECEIVE ? "1" : "0"
  };
}

// src/lib/generate/cpu/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var logger2 = new Logger();
async function generate(hash, difficulty, debug) {
  logger2.isEnabled = debug;
  return new Promise((resolve, reject) => {
    const check3 = () => {
      try {
        let result2 = validate(bigintRandom(), hash, difficulty, false);
        for (let i = 0; i < 32768; i++) {
          result2 = validate(bigintRandom(), hash, difficulty, false);
          if (result2.valid === "1") break;
        }
        if (result2.valid === "1") {
          resolve({
            hash: result2.hash,
            work: result2.work,
            difficulty: result2.difficulty
          });
        } else {
          requestAnimationFrame(check3);
        }
      } catch (err) {
        reject(err);
      }
    };
    check3();
  });
}

// src/lib/generate/wasm/asm/build/compute.wasm
var compute_default = __toBinary("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");

// src/lib/generate/wasm/worker.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var worker = async (compute) => {
  let isReady3 = false;
  let wasm2;
  let module;
  let instance;
  let main;
  async function setup3() {
    try {
      wasm2 = Uint8Array.from(compute);
      module = await WebAssembly.compile(wasm2);
      instance = await WebAssembly.instantiate(module, {
        env: {
          abort: (message, fileName, lineNumber, columnNumber) => {
            console.error("Wasm abort:", message, fileName, lineNumber, columnNumber);
            throw new Error(`Wasm abort: ${message}`);
          },
          memory: new WebAssembly.Memory({ initial: 256, maximum: 1024 })
        }
      });
      main = instance.exports.main;
      isReady3 = true;
    } catch (err) {
      throw new Error("Error instantiating WebAssembly", { cause: err });
    }
  }
  async function handleMessage(msg) {
    let result2 = null;
    try {
      if (!isReady3) await setup3();
      const hashArray = new BigUint64Array(4);
      const hashView = new DataView(hashArray.buffer);
      if (msg.data === "start") {
        result2 = "started";
      } else if (msg.data === "stop") {
        removeEventListener("message", handleMessage);
        result2 = "stopped";
      } else {
        const data2 = JSON.parse(msg.data);
        const seed = BigInt(`0x${data2.seed}`);
        const difficulty = BigInt(`0x${data2.difficulty}`);
        for (let i = 0; i < data2.hash.length; i += 16) {
          const u64 = data2.hash.slice(i, i + 16);
          hashView.setBigUint64(i / 2, BigInt(`0x${u64}`));
        }
        const work = main(seed, hashArray[0], hashArray[1], hashArray[2], hashArray[3], difficulty);
        if (typeof work !== "bigint") {
          throw new TypeError("Invalid work from WASM");
        }
        const workArray = new BigUint64Array(1);
        const workView = new DataView(workArray.buffer);
        workView.setBigUint64(0, work, true);
        result2 = workArray[0];
      }
    } catch (err) {
      if (typeof err === "object" && err != null) {
        const e = err;
        if (e.message !== "divide by zero") {
          result2 = e.message;
        }
      } else {
        result2 = JSON.stringify(err);
      }
    } finally {
      postMessage(result2);
      addEventListener("message", handleMessage);
    }
  }
  addEventListener("message", handleMessage);
};
var NanoPowWasmWorker = `
	;await (${worker})([${compute_default}])
`;

// src/lib/generate/wasm/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var logger3 = new Logger();
var isReady = false;
var data = {};
var v2 = new BigUint64Array(16);
var m2 = new BigUint64Array(16);
var workers = [];
var url;
function setup() {
  try {
    url = URL.createObjectURL(new Blob([NanoPowWasmWorker], { type: "text/javascript" }));
    workers = [];
    isReady = true;
  } catch (err) {
    isReady = false;
    throw new Error("NanoPow CPU initialization failed.", { cause: err });
  }
}
function reset() {
  console.warn(`NanoPow CPU encountered an error. Reinitializing...`);
  isReady = false;
  for (const w of workers) w.terminate();
  workers = [];
  m2?.fill(0n);
  v2?.fill(0n);
}
async function init2(hash, difficulty, effort) {
  data.hash = bigintToHex(hash, 64);
  data.difficulty = bigintToHex(difficulty, 16);
  for (let i = workers.length; i < effort; i++) {
    workers.push(new Worker(url, { type: "module" }));
  }
  while (workers.length - effort > 0) {
    workers.pop()?.terminate();
  }
  try {
    await workersStarted();
  } catch (err) {
    throw new Error("Error loading workers");
  }
}
async function workersStarted() {
  return new Promise(async (ready, fail) => {
    const resolutions = [];
    for (const w of workers) {
      resolutions.push(new Promise((resolve, reject) => {
        w.onmessage = (msg) => msg.data === "started" ? resolve(msg.data) : reject(msg.data);
        w.onerror = (err) => reject(err.message);
        w.postMessage("start");
      }));
    }
    Promise.all(resolutions).then(ready).catch(fail);
  });
}
async function dispatch() {
  return new Promise((resolve) => {
    const attempts = [];
    for (let i = 0; i < workers.length; i++) {
      data.seed = bigintToHex(bigintRandom() & ~((1n << 24n) - 1n), 16);
      attempts.push(new Promise((found, err) => {
        const w = workers[i];
        w.onerror = err;
        w.onmessage = (msg) => {
          const result2 = msg.data;
          found(result2);
        };
        w.postMessage(JSON.stringify(data));
      }));
    }
    Promise.all(attempts).then((results) => {
      const result2 = results.find((r) => typeof r === "bigint");
      result2 ? resolve(result2) : resolve(dispatch());
    });
  });
}
async function workersStopped() {
  return new Promise((stopped) => {
    try {
      const attempts = [];
      for (let i = 0; i < workers.length; i++) {
        attempts.push(new Promise((resolve, reject) => {
          const w = workers[i];
          w.onerror = reject;
          w.onmessage = (msg) => {
            const result2 = msg.data;
            if (result2 === "stopped") {
              resolve(result2);
            } else {
              reject(i);
            }
          };
          w.postMessage("stop");
        }));
      }
      Promise.allSettled(attempts).then((results) => {
        for (const result2 of results) {
          if (result2.status === "rejected") {
            const i = result2.reason;
            workers[i].terminate();
            workers.splice(i);
          }
        }
        stopped(true);
      });
    } catch {
      stopped(false);
    }
  });
}
async function generate2(hash, difficulty, effort, debug) {
  logger3.isEnabled = debug;
  if (isReady === false) setup();
  await init2(hash, difficulty, effort);
  let work = 0n;
  let result2 = "";
  try {
    work = await dispatch();
    result2 = (await validate(work, hash, difficulty, debug)).difficulty;
  } catch (err) {
  } finally {
    const isStopped = await workersStopped();
    if (isStopped) {
    } else {
      reset();
    }
  }
  return {
    hash: bigintToHex(hash, 64),
    work: bigintToHex(work, 16),
    difficulty: result2
  };
}

// src/lib/generate/webgl/shaders/downsample.frag
var downsample_default = `#version 300 es
#pragma vscode_glsllint_stage: frag
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision highp int;out uvec4 nonce;uniform highp usampler2D src;void main(){nonce=uvec4(0u);vec2 inputSize=vec2(textureSize(src,0));vec2 texel=vec2(1.0)/inputSize;vec2 blockCoord=(floor(gl_FragCoord.xy)*2.0+vec2(0.5))/inputSize;uvec4 pixel=texture(src,blockCoord);nonce=pixel.x==0u?nonce:pixel;pixel=texture(src,blockCoord+vec2(texel.x,0.0));nonce=pixel.x==0u?nonce:pixel;pixel=texture(src,blockCoord+vec2(0.0,texel.y));nonce=pixel.x==0u?nonce:pixel;pixel=texture(src,blockCoord+vec2(texel.x,texel.y));nonce=pixel.x==0u?nonce:pixel;}`;

// src/lib/generate/webgl/shaders/draw.frag
var draw_default = `#version 300 es
#pragma vscode_glsllint_stage: frag
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-FileContributor: Ben Green <ben@latenightsketches.com>
//! SPDX-License-Identifier: GPL-3.0-or-later AND MIT
layout(std140)uniform INPUT{uint hash[8];uvec2 difficulty;uvec2 seed;};out uvec4 work;void main(){work=uvec4(0u);uvec2 m0=seed ^ uvec2(gl_FragCoord);uvec2 m1=uvec2(hash[0u],hash[1u]);uvec2 m2=uvec2(hash[2u],hash[3u]);uvec2 m3=uvec2(hash[4u],hash[5u]);uvec2 m4=uvec2(hash[6u],hash[7u]);uvec2 v0=uvec2(0xf3bcc908u,0x6a09e667u);uvec2 v8=uvec2(0xf3bcc908u,0x6a09e667u);uvec2 v1=uvec2(0x84caa73bu,0xbb67ae85u);uvec2 v9=uvec2(0x84caa73bu,0xbb67ae85u);uvec2 v2=uvec2(0xfe94f82bu,0x3c6ef372u);uvec2 v10=uvec2(0xfe94f82bu,0x3c6ef372u);uvec2 v3=uvec2(0x5f1d36f1u,0xa54ff53au);uvec2 v11=uvec2(0x5f1d36f1u,0xa54ff53au);uvec2 v4=uvec2(0xade682d1u,0x510e527fu);uvec2 v12=uvec2(0xade682d1u,0x510e527fu);uvec2 v5=uvec2(0x2b3e6c1fu,0x9b05688cu);uvec2 v13=uvec2(0x2b3e6c1fu,0x9b05688cu);uvec2 v6=uvec2(0xfb41bd6bu,0x1f83d9abu);uvec2 v14=uvec2(0xfb41bd6bu,0x1f83d9abu);uvec2 v7=uvec2(0x137e2179u,0x5be0cd19u);uvec2 v15=uvec2(0x137e2179u,0x5be0cd19u);v0 ^=uvec2(0x01010008u,0x0u);v12 ^=uvec2(0x28u,0x0u);v14 ^=uvec2(~0x0u);v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m0;v0.y+=uint(v0.x<m0.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m1;v0.y+=uint(v0.x<m1.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m2;v1.y+=uint(v1.x<m2.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m3;v1.y+=uint(v1.x<m3.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m4;v2.y+=uint(v2.x<m4.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m4;v1.y+=uint(v1.x<m4.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m1;v0.y+=uint(v0.x<m1.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v1+=m0;v1.y+=uint(v1.x<m0.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v1+=m2;v1.y+=uint(v1.x<m2.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m3;v3.y+=uint(v3.x<m3.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m0;v1.y+=uint(v1.x<m0.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m2;v2.y+=uint(v2.x<m2.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v1+=m3;v1.y+=uint(v1.x<m3.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m1;v2.y+=uint(v2.x<m1.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m4;v3.y+=uint(v3.x<m4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m3;v1.y+=uint(v1.x<m3.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m1;v1.y+=uint(v1.x<m1.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m2;v0.y+=uint(v0.x<m2.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m4;v2.y+=uint(v2.x<m4.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m0;v2.y+=uint(v2.x<m0.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m0;v0.y+=uint(v0.x<m0.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m2;v2.y+=uint(v2.x<m2.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m4;v2.y+=uint(v2.x<m4.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m1;v0.y+=uint(v0.x<m1.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m3;v3.y+=uint(v3.x<m3.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m2;v0.y+=uint(v0.x<m2.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m0;v2.y+=uint(v2.x<m0.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v3+=m3;v3.y+=uint(v3.x<m3.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m4;v0.y+=uint(v0.x<m4.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m1;v3.y+=uint(v3.x<m1.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m1;v1.y+=uint(v1.x<m1.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v3+=m4;v3.y+=uint(v3.x<m4.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m0;v0.y+=uint(v0.x<m0.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v1+=m3;v1.y+=uint(v1.x<m3.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m2;v2.y+=uint(v2.x<m2.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m1;v2.y+=uint(v2.x<m1.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v3+=m3;v3.y+=uint(v3.x<m3.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m0;v0.y+=uint(v0.x<m0.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v1+=m4;v1.y+=uint(v1.x<m4.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m2;v3.y+=uint(v3.x<m2.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m3;v2.y+=uint(v2.x<m3.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v3+=m0;v3.y+=uint(v3.x<m0.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m2;v0.y+=uint(v0.x<m2.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m1;v2.y+=uint(v2.x<m1.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m4;v2.y+=uint(v2.x<m4.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m2;v0.y+=uint(v0.x<m2.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m4;v1.y+=uint(v1.x<m4.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v3+=m1;v3.y+=uint(v3.x<m1.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v2+=m3;v2.y+=uint(v2.x<m3.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v3+=m0;v3.y+=uint(v3.x<m0.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m0;v0.y+=uint(v0.x<m0.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v0+=m1;v0.y+=uint(v0.x<m1.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m2;v1.y+=uint(v1.x<m2.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m3;v1.y+=uint(v1.x<m3.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v2+=m4;v2.y+=uint(v2.x<m4.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v1+=v6;v1.y+=uint(v1.x<v6.x);v12 ^=v1;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v11+=v12;v11.y+=uint(v11.x<v12.x);v6 ^=v11;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v3+=v4;v3.y+=uint(v3.x<v4.x);v14 ^=v3;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v9+=v14;v9.y+=uint(v9.x<v14.x);v4 ^=v9;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(24u))|(v4<<uvec2(8u)).yx;v0+=v4;v0.y+=uint(v0.x<v4.x);v12 ^=v0;v12=(v12>>uvec2(16u))|(v12<<uvec2(16u)).yx;v8+=v12;v8.y+=uint(v8.x<v12.x);v4 ^=v8;v4=(v4>>uvec2(31u)).yx|(v4<<uvec2(1u));v1+=v5;v1.y+=uint(v1.x<v5.x);v1+=m4;v1.y+=uint(v1.x<m4.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v1+=v5;v1.y+=uint(v1.x<v5.x);v13 ^=v1;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v9+=v13;v9.y+=uint(v9.x<v13.x);v5 ^=v9;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(24u))|(v6<<uvec2(8u)).yx;v2+=v6;v2.y+=uint(v2.x<v6.x);v14 ^=v2;v14=(v14>>uvec2(16u))|(v14<<uvec2(16u)).yx;v10+=v14;v10.y+=uint(v10.x<v14.x);v6 ^=v10;v6=(v6>>uvec2(31u)).yx|(v6<<uvec2(1u));v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v3+=v7;v3.y+=uint(v3.x<v7.x);v15 ^=v3;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v11+=v15;v11.y+=uint(v11.x<v15.x);v7 ^=v11;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));v0+=v5;v0.y+=uint(v0.x<v5.x);v0+=m1;v0.y+=uint(v0.x<m1.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(24u))|(v5<<uvec2(8u)).yx;v0+=v5;v0.y+=uint(v0.x<v5.x);v15 ^=v0;v15=(v15>>uvec2(16u))|(v15<<uvec2(16u)).yx;v10+=v15;v10.y+=uint(v10.x<v15.x);v5 ^=v10;v5=(v5>>uvec2(31u)).yx|(v5<<uvec2(1u));v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(24u))|(v7<<uvec2(8u)).yx;v2+=v7;v2.y+=uint(v2.x<v7.x);v13 ^=v2;v13=(v13>>uvec2(16u))|(v13<<uvec2(16u)).yx;v8+=v13;v8.y+=uint(v8.x<v13.x);v7 ^=v8;v7=(v7>>uvec2(31u)).yx|(v7<<uvec2(1u));uvec2 result=uvec2(0xf3bcc908u,0x6a09e667u)^ uvec2(0x01010008u,0x0u)^ v0 ^ v8;if(result.y>difficulty.y||(result.y==difficulty.y&&result.x>=difficulty.x)){work=uvec4(m0,result);}if(work.x==0u){discard;}}`;

// src/lib/generate/webgl/shaders/quad.vert
var quad_default = `#version 300 es
#pragma vscode_glsllint_stage: vert
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-FileContributor: Ben Green <ben@latenightsketches.com>
//! SPDX-License-Identifier: GPL-3.0-or-later AND MIT
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
layout(location=0)in vec4 position;void main(){gl_Position=position;}`;

// src/lib/generate/webgl/shaders/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later

// src/lib/generate/webgl/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-FileContributor: Ben Green <ben@latenightsketches.com>
//! SPDX-License-Identifier: GPL-3.0-or-later AND MIT
var logger4 = new Logger();
var positions = new Float32Array([
  -1,
  -1,
  1,
  -1,
  1,
  1,
  -1,
  1
]);
var inputArray = new Uint32Array(36);
var inputView = new DataView(inputArray.buffer);
var inputHashView = new DataView(inputArray.buffer, 0, 128);
var inputDifficultyView = new DataView(inputArray.buffer, 128, 8);
var inputSeedView = new DataView(inputArray.buffer, 136, 8);
var resultArray = new BigUint64Array(2);
var resultView = new DataView(resultArray.buffer);
var canvas;
var gl;
var drawProgram;
var downsampleProgram;
var vertexShader;
var drawShader;
var downsampleShader;
var positionBuffer;
var queries;
var drawFbos;
var downsampleFbos;
var downsampleSrcLocation;
var inputBuffer;
var pixels;
var isContextLost = 0;
var isReady2 = false;
var drawEffort = 16;
var raf = 0;
function createCanvas(size) {
  if (canvas == null) {
    canvas = new OffscreenCanvas(0, 0);
    canvas.addEventListener("webglcontextlost", (ev) => {
      isContextLost = window.setTimeout(() => {
        throw new Error("NanoPow could not restore WebGL context.");
      }, 1e4);
      ev.preventDefault();
    });
    canvas.addEventListener("webglcontextrestored", (ev) => {
      window.clearTimeout(isContextLost);
      isContextLost = 0;
    });
  }
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: true,
    powerPreference: "default",
    premultipliedAlpha: false,
    stencil: false
  });
  if (context == null) throw new Error("WebGL 2 is required");
  gl = context;
  const MAX_VIEWPORT_DIMS = gl.getParameter(gl.MAX_VIEWPORT_DIMS) ?? [4096, 4096];
  size = Math.min(size, ...MAX_VIEWPORT_DIMS);
  size = Math.floor(size / 256) * 256;
  canvas.height = canvas.width = size;
  if (canvas.height !== gl.drawingBufferHeight || canvas.width !== gl.drawingBufferWidth) {
    size = Math.floor(Math.min(gl.drawingBufferHeight, gl.drawingBufferWidth) / 256) * 256;
    canvas.height = canvas.width = size;
  }
}
function compile() {
  try {
    drawProgram = gl.createProgram();
    if (drawProgram == null) throw new Error("Failed to create shader program");
    vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (vertexShader == null) throw new Error("Failed to create vertex shader");
    gl.shaderSource(vertexShader, quad_default);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(vertexShader) ?? `Failed to compile vertex shader`);
    drawShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (drawShader == null) throw new Error("Failed to create fragment shader");
    gl.shaderSource(drawShader, draw_default);
    gl.compileShader(drawShader);
    if (!gl.getShaderParameter(drawShader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(drawShader) ?? `Failed to compile fragment shader`);
    gl.attachShader(drawProgram, vertexShader);
    gl.attachShader(drawProgram, drawShader);
    gl.linkProgram(drawProgram);
    if (!gl.getProgramParameter(drawProgram, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(drawProgram) ?? `Failed to link program`);
    downsampleProgram = gl.createProgram();
    if (downsampleProgram == null) throw new Error("Failed to create downsample program");
    downsampleShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (downsampleShader == null) throw new Error("Failed to create downsample shader");
    gl.shaderSource(downsampleShader, downsample_default);
    gl.compileShader(downsampleShader);
    if (!gl.getShaderParameter(downsampleShader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(downsampleShader) ?? `Failed to compile downsample shader`);
    gl.attachShader(downsampleProgram, vertexShader);
    gl.attachShader(downsampleProgram, downsampleShader);
    gl.linkProgram(downsampleProgram);
    if (!gl.getProgramParameter(downsampleProgram, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(downsampleProgram) ?? `Failed to link program`);
    gl.useProgram(drawProgram);
    const triangleArray = gl.createVertexArray();
    gl.bindVertexArray(triangleArray);
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    drawFbos = [];
    queries = [];
    for (let i = 0; i < 4; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error(`Failed to create drawing framebuffer`);
      drawFbos.push({ texture, framebuffer, size: { x: gl.drawingBufferWidth, y: gl.drawingBufferHeight } });
      queries.push(gl.createQuery());
    }
    downsampleFbos = [];
    for (let i = 1; i <= 8; i++) {
      const width = gl.drawingBufferWidth / 2 ** i;
      const height = gl.drawingBufferHeight / 2 ** i;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error(`Failed to create downsampling framebuffer ${i}`);
      downsampleFbos.push({ texture, framebuffer, size: { x: width, y: height } });
    }
    downsampleSrcLocation = gl.getUniformLocation(downsampleProgram, "src");
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const finalFbo = downsampleFbos.slice(-1)[0];
    inputBuffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, inputBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, 160, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, inputBuffer);
    gl.uniformBlockBinding(drawProgram, gl.getUniformBlockIndex(drawProgram, "INPUT"), 0);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    pixels = new Uint32Array(finalFbo.size.x * finalFbo.size.y * 4);
    isReady2 = true;
  } catch (err) {
    throw new Error("WebGL compilation failed.", { cause: err });
  }
}
function setup2(effort) {
  try {
    reset2();
    drawEffort = effort;
    createCanvas(drawEffort * 256);
    compile();
  } catch (err) {
    reset2();
    throw new Error("WebGL setup failed.", { cause: err });
  }
}
function reset2() {
  isReady2 = false;
  cancelAnimationFrame(raf);
  raf = 0;
  gl?.deleteBuffer(inputBuffer);
  inputBuffer = null;
  for (const fbo of downsampleFbos ?? []) {
    gl?.deleteFramebuffer(fbo.framebuffer);
    gl?.deleteTexture(fbo.texture);
  }
  downsampleFbos = [];
  gl?.deleteShader(downsampleShader);
  downsampleShader = null;
  gl?.deleteProgram(downsampleProgram);
  downsampleProgram = null;
  for (const fbo of drawFbos ?? []) {
    gl?.deleteFramebuffer(fbo?.framebuffer ?? null);
    gl?.deleteTexture(fbo?.texture ?? null);
  }
  drawFbos = [];
  for (const query of queries ?? []) {
    gl?.deleteQuery(query);
  }
  queries = [];
  gl?.deleteBuffer(positionBuffer);
  positionBuffer = null;
  gl?.deleteShader(drawShader);
  drawShader = null;
  gl?.deleteShader(vertexShader);
  vertexShader = null;
  gl?.deleteProgram(drawProgram);
  drawProgram = null;
}
function init3(hash, difficulty) {
  if (gl == null) {
    throw new Error("WebGL 2 is required");
  }
  for (const drawFbo of drawFbos) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawFbo.framebuffer);
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  pixels.fill(0);
  resultArray.fill(0n);
  inputArray.fill(0);
  for (let i = 0; i < 8; i++) {
    inputHashView.setUint32(i * 16, hash[i]);
  }
  inputDifficultyView.setBigUint64(0, difficulty, true);
  gl.bindBuffer(gl.UNIFORM_BUFFER, inputBuffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, inputView);
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  gl.useProgram(drawProgram);
}
function draw(seed, drawFbo, query) {
  if (gl == null) throw new Error("WebGL 2 is required to draw");
  if (drawFbo == null) throw new Error("FBO is required to draw");
  if (query == null) throw new Error("Query is required to draw");
  inputSeedView.setBigUint64(0, seed, true);
  gl.bindBuffer(gl.UNIFORM_BUFFER, inputBuffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 136, inputSeedView);
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawFbo.framebuffer);
  gl.viewport(0, 0, drawFbo.size.x, drawFbo.size.y);
  gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query);
  gl.drawArrays(gl.TRIANGLES, 0, 4);
  gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
async function check(query) {
  return new Promise((resolve, reject) => {
    function check3() {
      try {
        if (gl == null) throw new Error("WebGL 2 is required to check query results");
        if (query == null) throw new Error("Query is required to check query results");
        if (isContextLost) throw new Error("WebGL 2 context must be restored to check query results");
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          resolve(!!gl.getQueryParameter(query, gl.QUERY_RESULT));
        } else {
          raf = requestAnimationFrame(check3);
        }
      } catch (err) {
        clearTimeout(raf);
        raf = 0;
        reject(err);
      }
    }
    check3();
  });
}
function read(drawFbo) {
  if (gl == null) throw new Error("WebGL 2 is required to read pixels");
  if (drawFbo == null) throw new Error("Source FBO is required to downsample");
  gl.useProgram(downsampleProgram);
  let source = drawFbo;
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(downsampleSrcLocation, 0);
  for (const fbo of downsampleFbos) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.viewport(0, 0, fbo.size.x, fbo.size.y);
    gl.drawArrays(gl.TRIANGLES, 0, 4);
    source = fbo;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, source.framebuffer);
  gl.readPixels(0, 0, source.size.x, source.size.y, gl.RGBA_INTEGER, gl.UNSIGNED_INT, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] || pixels[i + 1] || pixels[i + 2] || pixels[i + 3]) {
      resultView.setUint32(0, pixels[i], true);
      resultView.setUint32(4, pixels[i + 1], true);
      resultView.setUint32(8, pixels[i + 2], true);
      resultView.setUint32(12, pixels[i + 3], true);
      return {
        work: resultView.getBigUint64(0, true),
        difficulty: resultView.getBigUint64(8, true)
      };
    }
  }
  throw new Error("Query reported result but nonce value not found");
}
async function generate3(hash, difficulty, effort, debug) {
  logger4.isEnabled = debug;
  let timeout = false;
  const kill = setTimeout(() => {
    timeout = true;
  }, 6e4);
  let found = false;
  let result2 = {};
  let isFirstRetry = false;
  try {
    do {
      try {
        if (isReady2 === false || effort !== drawEffort || isFirstRetry) {
          setup2(effort);
        }
        init3(bigintAsUintNArray(hash, 32, 8), difficulty);
        draw(bigintRandom(), drawFbos[0], queries[0]);
        draw(bigintRandom(), drawFbos[1], queries[1]);
        draw(bigintRandom(), drawFbos[2], queries[2]);
        let drawIndex = 3;
        do {
          draw(bigintRandom(), drawFbos[drawIndex], queries[drawIndex]);
          drawIndex = (drawIndex + 1) % 4;
          found = await check(queries[drawIndex]);
        } while (!found && !timeout);
        if (found) result2 = read(drawFbos[drawIndex]);
        isFirstRetry = false;
      } catch (err) {
        isFirstRetry = !isFirstRetry;
        if (!isFirstRetry) {
          throw new Error("failed to restore context", { cause: err });
        }
        while (isContextLost) await new Promise((r) => setTimeout(r, 100));
      }
    } while (isFirstRetry);
  } finally {
    clearTimeout(kill);
    cancelAnimationFrame(raf);
    raf = 0;
    if (!found) throw new Error(timeout ? "timed out" : "work not found for unknown reason");
  }
  return {
    hash: bigintToHex(hash, 64),
    work: bigintToHex(result2.work, 16),
    difficulty: bigintToHex(result2.difficulty, 16)
  };
}

// src/lib/generate/webgpu/shaders/compute.wgsl
var compute_default2 = `//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
struct INPUT{hash:array<vec4<u32>,2>,difficulty:vec2<u32>,seed:vec2<u32>};@group(0)@binding(0)var<uniform> input:INPUT;struct OUTPUT{found:atomic<u32>,work:vec2<u32>,difficulty:vec2<u32>};@group(0)@binding(1)var<storage,read_write>output:OUTPUT;var<workgroup> found:bool;var<workgroup> m1:vec2<u32>;var<workgroup> m2:vec2<u32>;var<workgroup> m3:vec2<u32>;var<workgroup> m4:vec2<u32>;var<workgroup> d:vec2<u32>;var<workgroup> seed:vec2<u32>;@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)global_id:vec3<u32>,@builtin(local_invocation_id)local_id:vec3<u32>){if(local_id.x==0u){found=atomicLoad(&output.found)!=0u;seed=input.seed;m1=input.hash[0u].xy;m2=input.hash[0u].zw;m3=input.hash[1u].xy;m4=input.hash[1u].zw;d=input.difficulty;}workgroupBarrier();if(found){return;}let m0:vec2<u32>=seed ^ global_id.xy;var v0=vec2<u32>(0xf3bcc908u,0x6a09e667u);var v8=vec2<u32>(0xf3bcc908u,0x6a09e667u);var v1=vec2<u32>(0x84caa73bu,0xbb67ae85u);var v9=vec2<u32>(0x84caa73bu,0xbb67ae85u);var v2=vec2<u32>(0xfe94f82bu,0x3c6ef372u);var v10=vec2<u32>(0xfe94f82bu,0x3c6ef372u);var v3=vec2<u32>(0x5f1d36f1u,0xa54ff53au);var v11=vec2<u32>(0x5f1d36f1u,0xa54ff53au);var v4=vec2<u32>(0xade682d1u,0x510e527fu);var v12=vec2<u32>(0xade682d1u,0x510e527fu);var v5=vec2<u32>(0x2b3e6c1fu,0x9b05688cu);var v13=vec2<u32>(0x2b3e6c1fu,0x9b05688cu);var v6=vec2<u32>(0xfb41bd6bu,0x1f83d9abu);var v14=vec2<u32>(0xfb41bd6bu,0x1f83d9abu);var v7=vec2<u32>(0x137e2179u,0x5be0cd19u);var v15=vec2<u32>(0x137e2179u,0x5be0cd19u);v0 ^=vec2<u32>(0x01010008u,0x0u);v12 ^=vec2<u32>(0x28u,0x0u);v14 ^=vec2<u32>(~0x0u);v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m0;v0.y+=u32(v0.x<m0.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m1;v0.y+=u32(v0.x<m1.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m2;v1.y+=u32(v1.x<m2.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m3;v1.y+=u32(v1.x<m3.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m4;v2.y+=u32(v2.x<m4.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m4;v1.y+=u32(v1.x<m4.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m1;v0.y+=u32(v0.x<m1.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v1+=m0;v1.y+=u32(v1.x<m0.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v1+=m2;v1.y+=u32(v1.x<m2.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m3;v3.y+=u32(v3.x<m3.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m0;v1.y+=u32(v1.x<m0.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m2;v2.y+=u32(v2.x<m2.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v1+=m3;v1.y+=u32(v1.x<m3.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m1;v2.y+=u32(v2.x<m1.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m4;v3.y+=u32(v3.x<m4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m3;v1.y+=u32(v1.x<m3.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m1;v1.y+=u32(v1.x<m1.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m2;v0.y+=u32(v0.x<m2.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m4;v2.y+=u32(v2.x<m4.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m0;v2.y+=u32(v2.x<m0.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m0;v0.y+=u32(v0.x<m0.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m2;v2.y+=u32(v2.x<m2.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m4;v2.y+=u32(v2.x<m4.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m1;v0.y+=u32(v0.x<m1.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m3;v3.y+=u32(v3.x<m3.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m2;v0.y+=u32(v0.x<m2.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m0;v2.y+=u32(v2.x<m0.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v3+=m3;v3.y+=u32(v3.x<m3.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m4;v0.y+=u32(v0.x<m4.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m1;v3.y+=u32(v3.x<m1.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m1;v1.y+=u32(v1.x<m1.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v3+=m4;v3.y+=u32(v3.x<m4.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m0;v0.y+=u32(v0.x<m0.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v1+=m3;v1.y+=u32(v1.x<m3.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m2;v2.y+=u32(v2.x<m2.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m1;v2.y+=u32(v2.x<m1.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v3+=m3;v3.y+=u32(v3.x<m3.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m0;v0.y+=u32(v0.x<m0.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v1+=m4;v1.y+=u32(v1.x<m4.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m2;v3.y+=u32(v3.x<m2.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m3;v2.y+=u32(v2.x<m3.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v3+=m0;v3.y+=u32(v3.x<m0.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m2;v0.y+=u32(v0.x<m2.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m1;v2.y+=u32(v2.x<m1.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m4;v2.y+=u32(v2.x<m4.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m2;v0.y+=u32(v0.x<m2.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m4;v1.y+=u32(v1.x<m4.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v3+=m1;v3.y+=u32(v3.x<m1.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v2+=m3;v2.y+=u32(v2.x<m3.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v3+=m0;v3.y+=u32(v3.x<m0.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m0;v0.y+=u32(v0.x<m0.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v0+=m1;v0.y+=u32(v0.x<m1.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m2;v1.y+=u32(v1.x<m2.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m3;v1.y+=u32(v1.x<m3.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v2+=m4;v2.y+=u32(v2.x<m4.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=v12.yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v1+=v6;v1.y+=u32(v1.x<v6.x);v12 ^=v1;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v11+=v12;v11.y+=u32(v11.x<v12.x);v6 ^=v11;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=v14.yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v3+=v4;v3.y+=u32(v3.x<v4.x);v14 ^=v3;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v9+=v14;v9.y+=u32(v9.x<v14.x);v4 ^=v9;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=v12.yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(24u))|(v4<<vec2<u32>(8u)).yx;v0+=v4;v0.y+=u32(v0.x<v4.x);v12 ^=v0;v12=(v12>>vec2<u32>(16u))|(v12<<vec2<u32>(16u)).yx;v8+=v12;v8.y+=u32(v8.x<v12.x);v4 ^=v8;v4=(v4>>vec2<u32>(31u)).yx|(v4<<vec2<u32>(1u));v1+=v5;v1.y+=u32(v1.x<v5.x);v1+=m4;v1.y+=u32(v1.x<m4.x);v13 ^=v1;v13=v13.yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v1+=v5;v1.y+=u32(v1.x<v5.x);v13 ^=v1;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v9+=v13;v9.y+=u32(v9.x<v13.x);v5 ^=v9;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=v14.yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(24u))|(v6<<vec2<u32>(8u)).yx;v2+=v6;v2.y+=u32(v2.x<v6.x);v14 ^=v2;v14=(v14>>vec2<u32>(16u))|(v14<<vec2<u32>(16u)).yx;v10+=v14;v10.y+=u32(v10.x<v14.x);v6 ^=v10;v6=(v6>>vec2<u32>(31u)).yx|(v6<<vec2<u32>(1u));v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=v15.yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v3+=v7;v3.y+=u32(v3.x<v7.x);v15 ^=v3;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v11+=v15;v11.y+=u32(v11.x<v15.x);v7 ^=v11;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));v0+=v5;v0.y+=u32(v0.x<v5.x);v0+=m1;v0.y+=u32(v0.x<m1.x);v15 ^=v0;v15=v15.yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(24u))|(v5<<vec2<u32>(8u)).yx;v0+=v5;v0.y+=u32(v0.x<v5.x);v15 ^=v0;v15=(v15>>vec2<u32>(16u))|(v15<<vec2<u32>(16u)).yx;v10+=v15;v10.y+=u32(v10.x<v15.x);v5 ^=v10;v5=(v5>>vec2<u32>(31u)).yx|(v5<<vec2<u32>(1u));v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=v13.yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(24u))|(v7<<vec2<u32>(8u)).yx;v2+=v7;v2.y+=u32(v2.x<v7.x);v13 ^=v2;v13=(v13>>vec2<u32>(16u))|(v13<<vec2<u32>(16u)).yx;v8+=v13;v8.y+=u32(v8.x<v13.x);v7 ^=v8;v7=(v7>>vec2<u32>(31u)).yx|(v7<<vec2<u32>(1u));let result=vec2<u32>(0xf3bcc908u,0x6a09e667u)^ vec2<u32>(0x01010008u,0x0u)^ v0 ^ v8;if(result.y>input.difficulty.y||(result.y==input.difficulty.y&&result.x>=input.difficulty.x)){loop{let swap=atomicCompareExchangeWeak(&output.found,0u,1u);if(swap.exchanged){output.work=m0;output.difficulty=result;break;}if(swap.old_value!=0u){break;}}return;}}`;

// src/lib/generate/webgpu/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var logger5 = new Logger();
var q = new Queue();
var hashData = new BigUint64Array(4);
var bufferReset = new BigUint64Array(4);
var inputData = new BigUint64Array(6);
var inputDataView = new DataView(inputData.buffer);
var resultViews = [];
var isContextLost2 = 0;
var status = "Idle";
var device;
var bindGroupLayout;
var bindGroups;
var pipeline;
var inputBuffers;
var outputBuffers;
var resultBuffers;
async function start() {
  if (status === "Idle") {
    status = "Starting";
    await getDevice();
    try {
      await compile2();
      status = "Ready";
    } catch (err) {
      status = "Crashed";
      throw new Error("failed to compile", { cause: err });
    }
  }
}
async function getDevice() {
  if (navigator.gpu == null) {
    status = "Unsupported";
    throw new Error("WebGPU is not supported in this browser.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter == null) {
    status = "Unsupported";
    throw new Error("gpu adapter refused by browser");
  }
  device = await adapter.requestDevice();
  if (!(device instanceof GPUDevice)) {
    throw new Error("failed to get device from gpu adapter");
  }
  device.lost?.then(async (deviceLostInfo) => {
    isContextLost2 = window.setTimeout(() => {
      throw new Error("failed to restore device", { cause: deviceLostInfo });
    }, 3e4);
    if (status !== "Restoring") await q.prioritize(restore);
  });
}
async function compile2() {
  inputBuffers = [
    device.createBuffer({
      label: "INPUT_0",
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    }),
    device.createBuffer({
      label: "INPUT_1",
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
  ];
  outputBuffers = [
    device.createBuffer({
      label: "OUTPUT_0",
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    }),
    device.createBuffer({
      label: "OUTPUT_1",
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    })
  ];
  resultBuffers = [
    device.createBuffer({
      label: "RESULT",
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    }),
    device.createBuffer({
      label: "RESULT",
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    })
  ];
  bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
    ]
  });
  bindGroups = [
    device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputBuffers[0] } },
        { binding: 1, resource: { buffer: outputBuffers[0] } }
      ]
    }),
    device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputBuffers[1] } },
        { binding: 1, resource: { buffer: outputBuffers[1] } }
      ]
    })
  ];
  pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    }),
    compute: {
      entryPoint: "main",
      module: device.createShaderModule({
        code: compute_default2
      })
    }
  });
  const cmd = device.createCommandEncoder();
  cmd.beginComputePass().end();
  device.queue.submit([cmd.finish()]);
  await device.queue.onSubmittedWorkDone();
}
async function restore() {
  try {
    status = "Restoring";
    for (let i = 0; i < 2; i++) {
      try {
        resultBuffers[i]?.unmap();
      } catch {
      }
      resultBuffers[i]?.destroy();
      outputBuffers[i]?.destroy();
      inputBuffers[i]?.destroy();
      bindGroups[i] = null;
    }
    bindGroupLayout = null;
    await getDevice();
    await compile2();
    window.clearTimeout(isContextLost2);
    isContextLost2 = 0;
    status = "Ready";
  } catch (err) {
    status = "Crashed";
    throw new Error("failed to restore device", { cause: err });
  }
}
async function init4(hash, difficulty) {
  try {
    hashData.set(hash);
    inputData.fill(0n);
    for (let i = 0; i < 4; i++) {
      inputDataView.setBigUint64(i * 8, hashData[i]);
    }
    inputDataView.setBigUint64(32, difficulty, true);
    device.queue.writeBuffer(inputBuffers[0], 0, inputDataView);
    device.queue.writeBuffer(inputBuffers[1], 0, inputDataView);
    device.queue.writeBuffer(outputBuffers[0], 0, bufferReset);
    device.queue.writeBuffer(outputBuffers[1], 0, bufferReset);
  } catch (err) {
    throw new Error("failed to initialize", { cause: err });
  }
}
async function dispatch2(dispatchIndex, seed, effort) {
  try {
    inputDataView.setBigUint64(40, seed, true);
    device.queue.writeBuffer(inputBuffers[dispatchIndex], 40, inputDataView, 40);
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroups[dispatchIndex]);
    passEncoder.dispatchWorkgroups(effort * 256, effort * 256);
    passEncoder.end();
    commandEncoder.copyBufferToBuffer(outputBuffers[dispatchIndex], 0, resultBuffers[dispatchIndex], 0, 32);
    device.queue.submit([commandEncoder.finish()]);
  } catch (err) {
    throw new Error("failed to dispatch compute pass", { cause: err });
  }
}
async function check2(dispatchIndex) {
  try {
    await resultBuffers[dispatchIndex].mapAsync(GPUMapMode.READ);
    resultViews[dispatchIndex] = new DataView(resultBuffers[dispatchIndex].getMappedRange().slice(0));
    resultBuffers[dispatchIndex].unmap();
    if (resultViews[dispatchIndex] == null) throw new Error("failed to get data from resultBuffer.");
    return !!resultViews[dispatchIndex].getUint32(0, true);
  } catch (err) {
    throw new Error("failed to read results from compute pass", { cause: err });
  }
}
function read2(dispatchIndex) {
  try {
    if (resultViews[dispatchIndex] == null) throw new Error("failed to get data from result view");
    return {
      work: resultViews[dispatchIndex].getBigUint64(8, true),
      difficulty: resultViews[dispatchIndex].getBigUint64(16, true)
    };
  } catch (err) {
    throw new Error("failed to read results from compute pass", { cause: err });
  }
}
async function generate4(hash, difficulty, effort, debug) {
  logger5.isEnabled = debug;
  let timeout = false;
  const kill = setTimeout(() => {
    timeout = true;
    throw new Error("timed out");
  }, 6e4);
  let found = false;
  let result2 = {};
  let isFirstRetry = false;
  try {
    do {
      try {
        if (status === "Idle" || isFirstRetry) {
          await q.add(start);
          if (status !== "Ready") {
            throw new Error("failed to start");
          }
        }
        await q.add(init4, bigintAsUintNArray(hash, 64, 4), difficulty);
        await dispatch2(0, bigintRandom(), effort);
        let dispatchIndex = 1;
        do {
          await dispatch2(dispatchIndex, bigintRandom(), effort);
          dispatchIndex ^= 1;
          found = await check2(dispatchIndex);
        } while (!found && !timeout);
        await device.queue.onSubmittedWorkDone();
        if (found) result2 = read2(dispatchIndex);
        isFirstRetry = false;
      } catch (err) {
        if (status === "Unsupported") {
          throw new Error(err.message, { cause: err });
        }
        isFirstRetry = !isFirstRetry;
        if (!isFirstRetry) {
          throw new Error("failed to restore device", { cause: err });
        }
        while (isContextLost2) await new Promise((r) => setTimeout(r, 100));
      }
    } while (isFirstRetry);
  } finally {
    clearTimeout(kill);
    if (!found && timeout) throw new Error("timed out");
  }
  return {
    hash: bigintToHex(hash, 64),
    work: bigintToHex(result2.work, 16),
    difficulty: bigintToHex(result2.difficulty, 16)
  };
}

// src/lib/generate/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later

// src/lib/config/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var NanoPowConfigConstructor = class {
  static #isInternal = false;
  static get isInternal() {
    return this.#isInternal;
  }
  api;
  debug;
  difficulty;
  effort;
  toJSON() {
    return {
      api: this.api,
      debug: this.debug,
      difficulty: bigintToHex(this.difficulty, 16),
      effort: this.effort
    };
  }
  constructor(api, debug, difficulty, effort) {
    if (!this.constructor.isInternal) {
      throw new TypeError(`NanoPowConfig cannot be constructed with 'new'.`);
    }
    this.api = api;
    this.debug = debug;
    this.difficulty = difficulty;
    this.effort = effort;
  }
  static async create(options) {
    const input = options;
    const api = await this.#getValidApi(input);
    const debug = this.#getValidDebug(input);
    const difficulty = this.#getValidDifficulty(input);
    const effort = this.#getValidEffort(input);
    this.#isInternal = true;
    const config = new this(api, debug, difficulty, effort);
    this.#isInternal = false;
    return config;
  }
  // Check platform support for default API setting
  static async #getDefaultApi() {
    if (await ApiSupport.webgpu.isSupported) return "webgpu";
    if (await ApiSupport.webgl.isSupported) return "webgl";
    if (await ApiSupport.wasm.isSupported) return "wasm";
    return "cpu";
  }
  // Assign API if valid value passed
  static async #getValidApi(input) {
    if (input != null && input.api != null) {
      if (typeof input.api === "string") {
        try {
          input.api = input.api.toLowerCase();
        } catch {
          input.api = null;
        }
      }
      if (input.api !== "cpu" && input.api !== "wasm" && input.api !== "webgl" && input.api !== "webgpu") {
        throw new Error(`Invalid API ${input.api}`);
      }
      if (!ApiSupport[input.api].isSupported) {
        throw new Error(`${input.api} is not supported`);
      }
      return input.api;
    }
    return this.#getDefaultApi();
  }
  // Assign debug if valid value passed
  static #getValidDebug(input) {
    if (input != null && input.debug != null) {
      if (typeof input.debug === "bigint" || typeof input.debug === "number") {
        input.debug = input.debug.toString();
      }
      if (typeof input.debug === "string") {
        input.debug = ["1", "true", "y", "yes"].includes(input.debug.toLowerCase());
      }
      if (typeof input.debug !== "boolean") {
        throw new Error(`Invalid debug ${input.debug}`);
      }
      return input.debug;
    }
    return false;
  }
  // Assign difficulty if valid value passed
  static #getValidDifficulty(input) {
    if (input != null && input.difficulty != null) {
      if (typeof input.difficulty === "string") {
        try {
          input.difficulty = bigintFrom(input.difficulty, "hex");
        } catch {
        }
      }
      if (typeof input.difficulty !== "bigint") {
        throw new Error(`Invalid difficulty (${typeof input.difficulty})${input.difficulty}`);
      }
      if (input.difficulty < 0x0n || input.difficulty > SEND) {
        throw new Error(`Invalid difficulty ${bigintToHex(input.difficulty, 16)}`);
      }
      return input.difficulty;
    }
    return SEND;
  }
  // Assign effort if valid value passed
  static #getValidEffort(input) {
    if (input != null && input.effort != null) {
      if (typeof input.effort !== "number") {
        throw new Error(`Invalid effort (${typeof input.effort})${input.effort}`);
      }
      if (input.effort < 1 || input.effort > 32) {
        throw new Error(`Invalid effort ${input.effort}`);
      }
      return input.effort;
    }
    return 4;
  }
};
var NanoPowConfig = (options) => {
  try {
    return NanoPowConfigConstructor.create(options);
  } catch (err) {
    throw new Error("Error constructing NanoPowConfig", { cause: err });
  }
};

// src/lib/index.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var logger6 = new Logger();
var q2 = new Queue();
async function work_generate(hash, options) {
  return q2.add(async () => {
    try {
      const { api, debug, difficulty, effort } = await NanoPowConfig(options);
      const cached = Cache.search(hash, difficulty);
      if (cached) {
        return cached;
      }
      switch (api) {
        case "webgpu": {
          return Cache.store(await generate4(bigintFrom(hash, "hex"), difficulty, effort, debug));
        }
        case "webgl": {
          return Cache.store(await generate3(bigintFrom(hash, "hex"), difficulty, effort, debug));
        }
        case "wasm": {
          return Cache.store(await generate2(bigintFrom(hash, "hex"), difficulty, effort, debug));
        }
        default: {
          return Cache.store(await generate(bigintFrom(hash, "hex"), difficulty, debug));
        }
      }
    } catch (e) {
      return { error: typeof e === "string" ? e : e?.message ?? "" };
    }
  });
}
async function work_validate(work, hash, options) {
  try {
    const bigintHash = bigintFrom(hash, "hex");
    const bigintWork = bigintFrom(work, "hex");
    const { debug, difficulty } = await NanoPowConfig(options);
    const result2 = await validate(bigintWork, bigintHash, difficulty, debug);
    return result2;
  } catch (e) {
    return { error: typeof e === "string" ? e : e?.message ?? "" };
  }
}

// src/main.ts
//! SPDX-FileCopyrightText: 2025 Chris Duncan <chris@codecow.com>
//! SPDX-License-Identifier: GPL-3.0-or-later
var NanoPow = class {
  /**
  * Finds a nonce that satisfies the Nano proof-of-work requirements.
  *
  * @param {bigint | string} hash - Hexadecimal hash of previous block, or public key for new accounts
  * @param {object} [options] - Used to configure execution
  * @param {string} [options.api] - Specifies how work is generated. Default: best available
  * @param {boolean} [options.debug=false] - Enables additional debug logging to the console. Default: false
  * @param {number} [options.effort=0x4] - GPU load when generating work. Larger values are not necessarily better since they can quickly overwhelm the GPU. Default: 0x4
  * @param {bigint} [options.difficulty=0xfffffff800000000] - Minimum value result of `BLAKE2b(nonce||blockhash)`. Default: 0xFFFFFFF800000000
  */
  static async work_generate(hash, options) {
    return work_generate(hash, options);
  }
  /**
  * Validates that a nonce satisfies Nano proof-of-work requirements.
  *
  * @param {(bigint|string)} work - Value to validate against hash and difficulty
  * @param {(bigint|string)} hash - Hash of previous block, or public key for new accounts
  * @param {object} [options] - Used to configure execution
  * @param {boolean} [options.debug=false] - Enables additional debug logging to the console. Default: false
  * @param {bigint} [options.difficulty=0xfffffff800000000] - Minimum value result of `BLAKE2b(nonce||blockhash)`. Default: 0xFFFFFFF800000000
  */
  static async work_validate(work, hash, options) {
    return work_validate(work, hash, options);
  }
};
export {
  NanoPow,
  clearCache,
  NanoPow as default,
  stats
};
