// GitHub Actions 워크플로의 run: 값(한 줄 꼴과 | · > 블록 꼴)을 읽는다 — doc-commands.mjs 의 CI 출처.
// 배포·출시 쪽은 통째로 건너뛴다. 한 줄씩 훑으며 그때그때 정하니 단계 끝에 적힌 name: Deploy·steps: 뒤의 작업 name:·environment: 를 늦게 봐
// 이미 읽은 run: 줄이 들어갔다(독립 검토 2026-11-13). 이제는 워크플로·작업·단계를 통째로 나눈 뒤 정한다.
// 건너뛰는 것: 파일 이름·맨 위 name: 에 deploy·release·publish·ship·deliver·cd 조각, 태그 push·release 로 도는 워크플로,
// 맨 위 설정에 운영(prod) 조각, 작업 이름·name:·uses: 가 배포 쪽이거나 environment: 가 있는 작업, if: 가 태그·출시를 보는 작업·단계,
// run 값 밖의 설정(env: 등)에 운영 조각이 든 작업·단계.
import path from 'node:path';
import { readText, filesIn } from './stack-scan.mjs';
import { wordParts, prodIn } from './doc-risk.mjs';

const WF_MAX = 256 * 1024;
const FILES_MAX = 20;
const RISKY_NAME = /deploy|release|publish|ship|deliver/i;
const risky = (x) => RISKY_NAME.test(String(x || '')) || wordParts(String(x || '').slice(0, 200)).includes('cd');
// if: 가 태그·출시를 보는지(startsWith(github.ref, 'refs/tags/') · github.event_name == 'release')
const tagIf = (x) => /refs\/tags|release/i.test(String(x || ''));

const linesOf = (text) => text.split(/\r?\n/).map((raw) => {
  const t = raw.trim();
  return { ind: raw.length - raw.trimStart().length, t, skip: !t || t.startsWith('#') };
});
// 키 줄: key: 값(값은 없을 수 있다). 키는 따옴표로 쌀 수 있다("on":)
const keyOf = (t) => /^["']?([\w-]+)["']?:(?:[ \t]+(.*))?$/.exec(t);
// 같은 들여쓰기의 키들 → Map(키 → { value, kids: 그 키 아래 줄들 })
const mapping = (entries) => {
  const out = new Map();
  const base = entries.find((e) => !e.skip)?.ind;
  let cur = null;
  for (const e of entries) {
    if (e.skip) continue;
    const m = e.ind === base && keyOf(e.t);
    if (m) { cur = { value: m[2] || '', kids: [] }; out.set(m[1], cur); }
    // 목록은 키와 같은 들여쓰기로도 적는다(steps:\n- run: x)
    else if (cur && (e.ind > base || e.t.startsWith('-'))) cur.kids.push(e);
  }
  return out;
};
const textOf = (map, but = []) => [...map].filter(([k]) => !but.includes(k)).flatMap(([k, v]) => [`${k}: ${v.value}`, ...v.kids.map((e) => e.t)]).join('\n');
// run: 값 → 명령 줄들. | · > 블록이면 아래 줄, 아니면 한 줄(바깥 따옴표는 뗀다)
const runsOf = (run) => {
  if (!run) return [];
  if (/^[|>][-+]?\d*$/.test(run.value)) return run.kids.map((e) => e.t);
  return run.value ? [run.value.replace(/^(["'])(.*)\1$/, '$2')] : [];
};
// steps: 아래 줄 → 단계마다의 줄(맨 앞 「- 」 뒤 글을 첫 키 줄로)
const stepsOf = (kids) => {
  const dashAt = kids.find((e) => e.t.startsWith('-'))?.ind;
  const out = [];
  for (const e of kids) {
    if (e.ind === dashAt && e.t.startsWith('-')) {
      const rest = e.t.slice(1).trimStart();
      out.push([{ ind: e.ind + (e.t.length - rest.length), t: rest, skip: !rest }]);
    } else if (out.length && e.ind > dashAt) out.at(-1).push(e);
  }
  return out.map(mapping);
};

const jobRuns = (key, job) => {
  const name = job.get('name')?.value;
  if (risky(key) || risky(name) || risky(job.get('uses')?.value) || job.has('environment') || tagIf(job.get('if')?.value)) return [];
  if (prodIn(textOf(job, ['steps']))) return [];
  const out = [];
  for (const step of stepsOf(job.get('steps')?.kids || [])) {
    if (risky(step.get('name')?.value) || tagIf(step.get('if')?.value) || prodIn(textOf(step, ['run']))) continue;
    out.push(...runsOf(step.get('run')));
  }
  return out;
};

// 맨 위 on: 이 태그 push·release 로 도는지(on: release · on: [push, release] · on: push: tags: …)
const releaseTrigger = (on) => {
  if (!on) return false;
  const text = [on.value, ...on.kids.map((e) => e.t)].join('\n');
  return /(?:^|[\s[,'"-])release(?:[\s\]:,'"]|$)/m.test(text) || on.kids.some((e) => /^tags:/.test(e.t));
};

export const workflowRuns = (text) => {
  const top = mapping(linesOf(text));
  const on = top.get('on') || top.get('true'); // YAML 1.1 은 on 을 true 로 읽기도 한다
  if (risky(top.get('name')?.value) || releaseTrigger(on) || prodIn(textOf(top, ['jobs']))) return [];
  const jobs = mapping(top.get('jobs')?.kids || []);
  return [...jobs].flatMap(([key, j]) => jobRuns(key, mapping(j.kids)));
};

export const workflowLines = (root) => {
  const rel = path.join('.github', 'workflows');
  return filesIn(root, rel).filter((f) => /\.ya?ml$/i.test(f) && !risky(f.replace(/\.ya?ml$/i, ''))).slice(0, FILES_MAX)
    .flatMap((f) => workflowRuns(readText(path.join(root, rel, f), WF_MAX)));
};
