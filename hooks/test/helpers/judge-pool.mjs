// 판정 일꾼 여럿(judge-worker.mjs)에 사례를 나눠 돌린다. 일꾼은 이 프로세스의 작업 폴더를 함께 쓴다(process.chdir 은 일꾼을 만들기 전에).
// 일꾼이 죽거나(규칙의 process.exit·터짐) 한 사례가 한도를 넘기면 그 사례를 threw 로 끝내고 새 일꾼으로 바꾼다 — 시험이 끝없이 멈추지 않게(검토 2026-11-19).
import { Worker } from 'node:worker_threads';

const TIMEOUT_MS = 120000; // 진입점 프로세스로 돌던 때와 같은 한도

// env: 일꾼의 환경(없으면 이 프로세스 것 복사) — strict-run.mjs 는 시험 밖 Claude 설정을 떼어 놓는다
export const judgePool = (size = 4, { env } = {}) => {
  const url = new URL('./judge-worker.mjs', import.meta.url);
  const all = new Set();
  const idle = [];
  const queue = [];
  let seq = 0;
  let closing = false;

  const spawn = () => {
    const w = new Worker(url, env ? { env } : {});
    w.current = null; // { id, resolve, timer }
    const finish = (msg) => {
      const cur = w.current;
      if (!cur) return;
      clearTimeout(cur.timer);
      w.current = null;
      cur.resolve(msg);
    };
    w.on('message', (msg) => {
      if (w.current?.id !== msg.id) return;
      finish(msg);
      idle.push(w);
      next();
    });
    const died = (why) => {
      if (!all.delete(w)) return;
      finish({ threw: `일꾼이 멈춤(${why}) — 규칙이 process.exit 를 부르거나 판정이 한도를 넘겼다` });
      if (!closing) {
        idle.push(spawn());
        next();
      }
    };
    w.on('error', (e) => died(String(e?.message || e).slice(0, 200)));
    w.on('exit', (code) => died(`exit ${code}`));
    w.unref();
    all.add(w);
    return w;
  };

  const next = () => {
    while (idle.length && queue.length) {
      const w = idle.shift();
      if (!all.has(w)) continue;
      const { job, resolve } = queue.shift();
      const id = ++seq;
      const timer = setTimeout(() => w.terminate(), job.timeoutMs || TIMEOUT_MS);
      w.current = { id, resolve, timer };
      w.postMessage({ id, ...job });
    }
  };
  for (let i = 0; i < size; i++) idle.push(spawn());

  // job: { raw, event?, pathValue?, budget, tries } → { got, errors, ms, shapeOk } 또는 { threw }
  //      { raw, detail: true } → { msgs, asks, hints, notes, errors, stdout } 또는 { threw }
  const judge = (job) => new Promise((resolve) => { queue.push({ job, resolve }); next(); });
  const close = () => {
    closing = true;
    return Promise.all([...all].map((w) => w.terminate()));
  };
  return { judge, close };
};
