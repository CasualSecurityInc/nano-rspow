#!/usr/bin/env node

const readline = require('readline')

const DEFAULT_THRESHOLD = 'fffffff800000000'
const HELP = `nano-rspow-node generates Nano proof of work from stdin.

Usage:
  nano-rspow-node [--help]

With no arguments, read one request per line and write one result per line.
Empty lines are ignored. The only accepted argument is --help.

Input:
  <hash_hex>
  <hash_hex>:<threshold_hex>

The optional threshold must use a 0x prefix. Without one, the current
epoch-2 send/change threshold is used.

Output:
  <hash_hex>:0x<threshold_hex>:<work_hex>
`

async function main () {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(HELP)
    return 0
  }
  if (args.length !== 0) {
    process.stderr.write('error: only --help is supported\n')
    process.stderr.write(HELP)
    return 2
  }

  const { generateWorkWithThreshold } = require('../index.js')

  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  })

  try {
    for await (const rawLine of input) {
      const line = rawLine.trim()
      if (line === '') continue

      const request = parseRequest(line)
      if (!request.ok) {
        process.stderr.write(`Error parsing request ${JSON.stringify(line)}: ${request.error}\n`)
        continue
      }

      try {
        const work = await generateWorkWithThreshold(request.hash, request.threshold)
        await writeLine(`${request.hash}:0x${request.threshold}:${work}`)
      } catch (error) {
        process.stderr.write(`Error generating work for ${request.hash}: ${error.message}\n`)
      }
    }
  } finally {
    input.close()
  }
  return 0
}

function parseRequest (line) {
  const parts = line.split(':')
  if (parts.length > 2) {
    return { ok: false, error: 'request must be <hash_hex> or <hash_hex>:<threshold_hex>' }
  }

  const hash = parts[0].trim()
  const normalizedHash = hash.startsWith('0x') ? hash.slice(2) : hash
  if (!/^[0-9a-f]{64}$/i.test(normalizedHash)) {
    return { ok: false, error: 'hash must be exactly 64 hexadecimal characters' }
  }

  let threshold = DEFAULT_THRESHOLD
  if (parts.length === 2) {
    const thresholdText = parts[1].trim()
    if (!thresholdText.startsWith('0x')) {
      return { ok: false, error: `threshold ${JSON.stringify(thresholdText)} must start with 0x` }
    }
    const thresholdHex = thresholdText.slice(2)
    if (!/^[0-9a-f]{1,16}$/i.test(thresholdHex)) {
      return { ok: false, error: `invalid threshold ${JSON.stringify(thresholdText)}` }
    }
    threshold = thresholdHex.padStart(16, '0').toLowerCase()
  }

  return { ok: true, hash, threshold }
}

function writeLine (line) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${line}\n`, error => error ? reject(error) : resolve())
  })
}

main().then(code => {
  process.exitCode = code
}).catch(error => {
  process.stderr.write(`error: ${error.message}\n`)
  process.exitCode = 1
})
