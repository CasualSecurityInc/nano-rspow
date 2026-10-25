import init, { validate_work } from './nano_rspow_web.js'

let worker
let nextId = 0
const pending = new Map()
let assessment
let probing
let probeGeneration = 0

function resetWorker (error) {
  if (worker) {
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
  }
  worker = undefined
  assessment = undefined
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function getWorker () {
  if (worker) return worker
  if (typeof Worker === 'undefined') return undefined
  try {
    const realm = new Worker(new URL('./pow-worker.js', import.meta.url), { type: 'module' })
    worker = realm
    worker.onmessage = ({ data }) => {
      if (worker !== realm) return
      const request = pending.get(data.id)
      if (!request) return
      pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.result)
    }
    worker.onerror = () => {
      if (worker === realm) resetWorker(new Error('Local PoW Worker failed'))
    }
    return worker
  } catch { return undefined }
}

// Start the clock before queueing or initializing. Abandoning a Worker discards
// its entire WASM/GPU realm, so late readbacks cannot reuse shared buffers.
async function run (operation, root, threshold, { signal, timeoutMs } = {}) {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) throw new RangeError('Invalid PoW timeout')
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  let timer
  let abort
  const cancelled = new Promise((_, reject) => {
    abort = () => {
      const error = signal?.reason ?? new DOMException('Aborted', 'AbortError')
      resetWorker(error)
      reject(error)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (timeoutMs !== undefined) timer = setTimeout(() => {
      const error = new DOMException('Local PoW deadline exceeded', 'TimeoutError')
      resetWorker(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    const activeWorker = getWorker()
    if (!activeWorker) throw new Error('Dedicated Workers are unavailable; local proof-of-work is disabled')
    const task = new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      try {
        activeWorker.postMessage({ id, operation, root, threshold })
      } catch (error) {
        resetWorker(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return await Promise.race([task, cancelled])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export async function ready () {
  // The adapter's synchronous validate() needs a local WASM instance, too.
  // Only validation runs here; all searching remains inside the Worker.
  await Promise.all([init(), run('ready', undefined, undefined, { timeoutMs: 3000 })])
}

export async function probeLocalPow (options = {}) {
  if (!options.reprobe && assessment) return assessment
  // Each caller keeps its own cancellation/deadline; shared work is only used
  // for ordinary probes without caller-specific cancellation options.
  const share = !options.signal && options.timeoutMs === undefined
  if (share && probing) return probing
  const generation = ++probeGeneration
  const promise = run('probe', undefined, undefined, { ...options, timeoutMs: options.timeoutMs ?? 3000 })
    .then(result => {
      if (generation === probeGeneration) assessment = result
      return result
    })
    .catch(error => ({ recommended: false, backend: null, reason: error.name === 'TimeoutError' ? 'timeout' : String(error.message ?? error) }))
  if (!share) return promise
  probing = promise
  try { return await promise } finally { probing = undefined }
}

export async function generateWork (root, threshold, options = {}) {
  if (!/^[a-f\d]{64}$/i.test(root) || !/^[a-f\d]{16}$/i.test(threshold)) throw new TypeError('Invalid work root or threshold')
  if (assessment && !assessment.recommended) throw new Error(`Local proof-of-work is unavailable: ${assessment.reason}`)
  return await run('generate', root, threshold, options)
}

export async function recommendLocalPow (reprobe = false) {
  return (await probeLocalPow({ reprobe })).recommended
}

export function createPowEngine () {
  return {
    name: 'nano-rspow-web',
    ready,
    generate: async (root, threshold) => (await generateWork(root, threshold)).nonce,
    validate: (root, work, threshold) => validate_work(root, work, threshold)
  }
}
