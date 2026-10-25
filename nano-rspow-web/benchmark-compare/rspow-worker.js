import init, { generate_work } from './nano_rspow_web.js';

const initialization = init();
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      await initialization;
      if (data.operation === 'ready') {
        self.postMessage({ id: data.id, result: true });
        return;
      }
      const result = await generate_work(data.root, data.threshold);
      try {
        self.postMessage({ id: data.id, result: { nonce: result.nonce, is_gpu: result.is_gpu } });
      } finally {
        result.free();
      }
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error?.message ?? error) });
    }
  });
};
