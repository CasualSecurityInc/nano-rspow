import init, { generate_work_gpu, generate_work_cpu_batch, validate_work, WasmCancelToken } from './nano_rspow_web.js'

let initialization
export function ready () {
  initialization ??= init().catch(error => { initialization = undefined; throw error })
  return initialization
}

export async function cpuWork (root, threshold, signal) {
  let batch = 1000
  for (;;) {
    signal?.throwIfAborted()
    const start = performance.now()
    const nonce = generate_work_cpu_batch(root, threshold, batch)
    if (nonce) return { nonce, backend: 'cpu' }
    batch = Math.max(1, Math.min(250000, Math.floor(batch * 8 / Math.max(1, performance.now() - start))))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

export async function gpuWork (root, threshold) {
  const token = new WasmCancelToken()
  try {
    const result = await generate_work_gpu(root, threshold, token)
    try { return { nonce: result.nonce, backend: 'webgpu' } } finally { result.free() }
  } finally { token.cancel(); token.free() }
}

export function validate (root, nonce, threshold) {
  if (!validate_work(root, nonce, threshold)) throw new Error('Invalid local proof-of-work')
}

export async function cpuProbe (signal) {
  const root = '0'.repeat(64)
  let hashes = 0
  const start = performance.now()
  do {
    signal?.throwIfAborted()
    generate_work_cpu_batch(root, 'ffffffffffffffff', 1000)
    hashes += 1000
  } while (performance.now() - start < 8)
  return hashes / ((performance.now() - start) / 1000) >= 15000000
}
