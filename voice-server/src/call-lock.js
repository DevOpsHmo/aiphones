const tails = new Map();

export function withCallLock(callId, work) {
  const key = String(callId || "");
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  tails.set(key, tail);
  return previous.catch(() => {}).then(work).finally(() => {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
}
