import { ready, gpuWork, cpuWork, cpuProbe, validate } from './local-runtime.js'
let selected
let queue = Promise.resolve()
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      await ready()
      if (data.operation === 'ready') {
        self.postMessage({ id: data.id, result: true })
        return
      }

      if (data.operation === 'probe') {
        try {
          const root = '0'.repeat(64)
          const threshold = 'ff00000000000000'
          const result = await gpuWork(root, threshold)
          validate(root, result.nonce, threshold)
          selected = 'webgpu'
          self.postMessage({ id: data.id, result: { recommended: true, backend: selected, reason: 'validated_gpu' } })
        } catch {
          const recommended = await cpuProbe()
          selected = recommended ? 'cpu' : undefined
          self.postMessage({ id: data.id, result: { recommended, backend: recommended ? 'cpu' : null, reason: recommended ? 'cpu_throughput' : 'slow_cpu' } })
        }
        return
      }

      if (selected === undefined) {
        const root = '0'.repeat(64)
        const threshold = 'ff00000000000000'
        try {
          const probe = await gpuWork(root, threshold)
          validate(root, probe.nonce, threshold)
          selected = 'webgpu'
        } catch {
          if (await cpuProbe()) selected = 'cpu'
        }
      }
      if (selected === undefined) throw new Error('Local proof-of-work is not recommended on this device')

      let result
      if (selected === 'webgpu') {
        try {
          result = await gpuWork(data.root, data.threshold)
        } catch (error) {
          if (!await cpuProbe()) throw error
          selected = 'cpu'
        }
      }
      result ??= await cpuWork(data.root, data.threshold)
      validate(data.root, result.nonce, data.threshold)
      self.postMessage({ id: data.id, result })
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error?.message ?? error) })
    }
  })
}
