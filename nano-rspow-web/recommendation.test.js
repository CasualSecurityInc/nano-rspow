import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalPowRecommendation } from './recommendation.js'

function memoryStorage () {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}

function deferred () {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

test('recommendLocalPow probes on a cache miss and reuses the result', async () => {
  let calls = 0
  const recommendLocalPow = createLocalPowRecommendation(async () => {
    calls += 1
    return true
  }, { storage: memoryStorage() })

  assert.equal(await recommendLocalPow(), true)
  assert.equal(await recommendLocalPow(), true)
  assert.equal(calls, 1)
})

test('recommendLocalPow re-probes and replaces a cached outcome', async () => {
  let result = true
  const recommendLocalPow = createLocalPowRecommendation(async () => result, { storage: memoryStorage() })

  assert.equal(await recommendLocalPow(), true)
  result = false
  assert.equal(await recommendLocalPow(true), false)
  assert.equal(await recommendLocalPow(), false)
})

test('recommendLocalPow keeps working when browser storage is unavailable', async () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }
  const recommendLocalPow = createLocalPowRecommendation(async () => false, { storage: unavailableStorage })

  assert.equal(await recommendLocalPow(), false)
})

test('recommendLocalPow coalesces ordinary probes and protects a forced re-probe', async () => {
  const first = deferred()
  const second = deferred()
  let calls = 0
  const recommendLocalPow = createLocalPowRecommendation(() => {
    calls += 1
    return calls === 1 ? first.promise : second.promise
  }, { storage: memoryStorage() })

  const ordinary = recommendLocalPow()
  assert.strictEqual(recommendLocalPow(), ordinary)
  const forced = recommendLocalPow(true)

  second.resolve(false)
  assert.equal(await forced, false)
  first.resolve(true)
  assert.equal(await ordinary, true)
  assert.equal(await recommendLocalPow(), false)
})
