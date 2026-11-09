// 판정 일꾼 여럿(judge-worker.mjs)에 사례를 나눠 돌린다. 일꾼은 이 프로세스의 작업 폴더를 함께 쓴다(process.chdir 은 일꾼을 만들기 전에).
import { Worker } from 'node:worker_threads';

export const judgePool = (size = 4) => {
  const workers = Array.from({ length: size }, () => new Worker(new URL('./judge-worker.mjs', import.meta.url)));
  const waiting = new Map();
  let seq = 0;
  for (const w of workers) {
    w.on('message', (msg) => {
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    });
    w.unref();
  }
  const idle = [...workers];
  const queue = [];
  const next = () => {
    while (idle.length && queue.length) {
      const w = idle.shift();
      const { job, resolve } = queue.shift();
      const id = ++seq;
      waiting.set(id, (msg) => {
        idle.push(w);
        resolve(msg);
        next();
      });
      w.postMessage({ id, ...job });
    }
  };
  // job: { raw, event?, pathValue?, budget, tries } → { got, errors, ms, shapeOk } 또는 { threw }
  const judge = (job) => new Promise((resolve) => { queue.push({ job, resolve }); next(); });
  const close = () => Promise.all(workers.map((w) => w.terminate()));
  return { judge, close };
};
