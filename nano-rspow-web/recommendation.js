/** Cache capability assessments only for the lifetime of the current page. */
export function createLocalPowRecommendation (probe) {
  let cached
  let active
  let generation = 0
  return function recommendLocalPow (reprobe = false) {
    if (!reprobe && cached !== undefined) return Promise.resolve(cached)
    if (!reprobe && active) return active.promise
    const current = ++generation
    const promise = Promise.resolve().then(probe).then(result => {
      if (current === generation) cached = result
      return result
    }).finally(() => {
      if (active?.generation === current) active = undefined
    })
    active = { generation: current, promise }
    return promise
  }
}
