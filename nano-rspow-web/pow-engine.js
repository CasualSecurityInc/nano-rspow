import init, { generate_work, validate_work } from './nano_rspow_web.js'

let initialization

function ready () {
  initialization ??= init()
  return initialization
}

/** Create the nano-pow-contract adapter for the WebAssembly/WebGPU engine. */
export function createPowEngine () {
  return {
    name: 'nano-rspow-web',
    ready,
    generate: async (root, threshold) => (await generate_work(root, threshold)).nonce,
    validate: (root, work, threshold) => validate_work(root, work, threshold)
  }
}
