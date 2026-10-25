let worker;
let initialization;
let nextId = 0;
const pending = new Map();

function request(operation, fields = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, operation, ...fields });
  });
}

export default function ready() {
  if (!initialization) {
    worker = new Worker(new URL('./rspow-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    worker.onerror = (event) => {
      for (const entry of pending.values()) entry.reject(new Error(event.message || 'PoW Worker failed'));
      pending.clear();
      worker.terminate();
      initialization = undefined;
    };
    initialization = request('ready');
  }
  return initialization;
}

export async function generateWork(root, threshold) {
  await ready();
  return request('generate', { root, threshold });
}
