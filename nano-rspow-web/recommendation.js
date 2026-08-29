const CACHE_KEY = 'nano-rspow-web.local-pow-recommendation.v1'

function browserStorage () {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Cache an asynchronous local-PoW recommendation without exposing browser
 * storage details to consumers.
 *
 * @param {() => Promise<boolean>} probe runs the actual capability check
 * @param {{ storage?: Storage | null }} [options] testable browser storage override
 * @returns {(reprobe?: boolean) => Promise<boolean>} cached recommendation function
 */
export function createLocalPowRecommendation (probe, { storage = browserStorage() } = {}) {
  let cacheRead = false
  let cachedRecommendation
  let activeProbe
  let generation = 0

  function readCache () {
    if (cacheRead) return
    cacheRead = true

    try {
      const value = storage?.getItem(CACHE_KEY)
      if (value === 'true') cachedRecommendation = true
      if (value === 'false') cachedRecommendation = false
    } catch {
      // Storage is optional: a private-browser or quota failure falls back to memory.
    }
  }

  function writeCache (recommendation) {
    try {
      storage?.setItem(CACHE_KEY, String(recommendation))
    } catch {
      // The in-memory result remains valid for this page session.
    }
  }

  return function recommendLocalPow (reprobe = false) {
    readCache()

    if (!reprobe && cachedRecommendation !== undefined) {
      return Promise.resolve(cachedRecommendation)
    }

    if (!reprobe && activeProbe) return activeProbe.promise

    const probeGeneration = ++generation
    const promise = Promise.resolve()
      .then(probe)
      .then(recommendation => {
        if (probeGeneration === generation) {
          cachedRecommendation = recommendation
          writeCache(recommendation)
        }
        return recommendation
      })
      .finally(() => {
        if (activeProbe?.generation === probeGeneration) activeProbe = undefined
      })

    activeProbe = { generation: probeGeneration, promise }
    return promise
  }
}
