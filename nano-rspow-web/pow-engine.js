import init, { generate_work, probe_local_pow, validate_work } from './nano_rspow_web.js'
import { createLocalPowRecommendation } from './recommendation.js'

let initialization

function ready () {
  initialization ??= init()
  return initialization
}

/**
 * Return whether this browser should prefer local PoW. The result is cached;
 * pass `true` to force a fresh browser capability and performance probe.
 */
export const recommendLocalPow = createLocalPowRecommendation(async () => {
  await ready()
  return probe_local_pow()
})

/** Create the nano-pow-contract adapter for the WebAssembly/WebGPU engine. */
export function createPowEngine () {
  return {
    name: 'nano-rspow-web',
    ready,
    generate: async (root, threshold) => (await generate_work(root, threshold)).nonce,
    validate: (root, work, threshold) => validate_work(root, work, threshold)
  }
}
