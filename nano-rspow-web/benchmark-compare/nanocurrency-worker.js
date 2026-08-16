import { computeWork } from 'nanocurrency';

self.postMessage({ type: 'ready' });

self.onmessage = async ({ data }) => {
  if (data.type !== 'compute') return;

  try {
    const nonce = await computeWork(data.root, {
      workThreshold: data.threshold,
      workerIndex: data.workerIndex,
      workerCount: data.workerCount,
    });
    if (!nonce) throw new Error('nanocurrency returned no work value');
    self.postMessage({ type: 'result', id: data.id, nonce });
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
