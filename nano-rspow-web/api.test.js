import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

let mode = 'success'
let terminations = 0
class FakeWorker {
  constructor () { if (mode === 'construction') throw new Error('blocked') }
  postMessage ({ id, operation }) {
    if (mode === 'stall') return
    queueMicrotask(() => {
      if (mode === 'failure') this.onerror()
      else this.onmessage({ data: { id, result: operation === 'probe'
        ? { recommended: mode !== 'negative', backend: mode === 'negative' ? null : 'webgpu', reason: mode === 'negative' ? 'slow_cpu' : 'validated_gpu' }
        : { nonce: '0000000000000001', backend: 'webgpu' } } })
    })
  }
  terminate () { terminations++ }
}
globalThis.Worker = FakeWorker
let serial = 0
async function engine () { return import(`./pow-engine.js?test=${serial++}`) }
afterEach(() => { mode = 'success'; globalThis.Worker = FakeWorker })
test('generation uses reusable Worker with concurrent request correlation', async () => {
  const api = await engine()
  const results = await Promise.all([api.generateWork('0'.repeat(64), '0'.repeat(16)), api.generateWork('1'.repeat(64), '0'.repeat(16))])
  assert.equal(results.length, 2)
  assert.equal(results[0].backend, 'webgpu')
})
test('a stalled readback/initialization is terminated at deadline and retry recovers', async () => {
  const api = await engine()
  mode = 'stall'
  await assert.rejects(api.generateWork('0'.repeat(64), '0'.repeat(16), { timeoutMs: 10 }), { name: 'TimeoutError' })
  assert.ok(terminations > 0)
  mode = 'success'
  assert.equal((await api.generateWork('0'.repeat(64), '0'.repeat(16))).backend, 'webgpu')
})
test('cancelling queued work discards active realm and rejects all pending callers', async () => {
  const api = await engine()
  mode = 'stall'
  const controller = new AbortController()
  const first = api.generateWork('0'.repeat(64), '0'.repeat(16))
  const second = api.generateWork('1'.repeat(64), '0'.repeat(16), { signal: controller.signal })
  const rejected = Promise.all([assert.rejects(first), assert.rejects(second, { name: 'AbortError' })])
  controller.abort()
  await rejected
})
test('probe failure stays recoverable and does not recommend local work', async () => {
  const api = await engine()
  mode = 'failure'
  assert.equal((await api.probeLocalPow()).recommended, false)
  mode = 'success'
  assert.equal((await api.probeLocalPow()).recommended, true)
})
test('missing or blocked Workers never run CPU work in the caller context', async () => {
  mode = 'construction'
  const api = await engine()
  const assessment = await api.probeLocalPow()
  assert.equal(assessment.recommended, false)
  await assert.rejects(api.generateWork('0'.repeat(64), '0'.repeat(16)), /unavailable/)

  globalThis.Worker = undefined
  const noWorker = await engine()
  assert.equal((await noWorker.probeLocalPow()).recommended, false)
  await assert.rejects(noWorker.generateWork('0'.repeat(64), '0'.repeat(16)), /unavailable/)
})
test('probe timeout is diagnostic and rejects pre-aborted generation', async () => {
  const api = await engine()
  mode = 'stall'
  assert.equal((await api.probeLocalPow({ timeoutMs: 10 })).reason, 'timeout')
  await assert.rejects(api.generateWork('0'.repeat(64), '0'.repeat(16), { signal: AbortSignal.abort() }), { name: 'AbortError' })
})
test('a negative recommendation refuses generation until a successful reprobe', async () => {
  const api = await engine()
  mode = 'negative'
  assert.equal((await api.probeLocalPow()).recommended, false)
  await assert.rejects(api.generateWork('0'.repeat(64), '0'.repeat(16)), /slow_cpu/)
  mode = 'success'
  assert.equal((await api.probeLocalPow({ reprobe: true })).recommended, true)
  assert.equal((await api.generateWork('0'.repeat(64), '0'.repeat(16))).backend, 'webgpu')
})
