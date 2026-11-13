// README·개발 메모의 명령 블록과 GitHub Actions 의 run: 줄에서 명령을 읽는다 — 「이 저장소 명령」의 낮은 차례 출처(commands.mjs).
// 설정 파일만 읽어 실제 명령이 README·CI 에만 있는 저장소에서 빠졌다: 3 회차의 python scripts/eval.py, 11 회차의 시드 재현·miri·fuzz·
// 빠른 벤치·plot.py(정답지 다시 매기기, 2026-11-13).
// 이 목록은 Claude 에게 「평소 돌려도 되는 명령」이라고 알린다. 그래서 넣는 쪽을 좁게 잡는다 — 안전한 명령을 빠뜨리는 값은 작다(독립 검토 2026-11-13).
// 지어내지 않는다: 아래 꼴(python 스크립트·cargo 하위 명령)만, 그리고 그 스크립트·패키지·시험·벤치·fuzz 대상이 저장소에 실제로 있을 때만.
// 셸 스크립트(./scripts/x.sh)·make·패키지 스크립트는 읽지 않는다 — 원격에 닿는 스크립트일 수 있고, make·package.json 은 이미 따로 읽는다.
// 이름·인자·옵션·주석의 낱말 조각이 위험하면 뺀다(doc-risk.mjs). 설치·배포·출시 제목 아래(하위 제목 포함)는 보지 않는다.
// 결과를 지킬 경로(.gitignore 의 data/·.hdf5 — suggest.mjs protect)에 쓰는 명령도 뺀다. 묻는 명령에 든 것은 지침을 만들 때 다시 뺀다(claude-md.mjs withoutAsked).
import fs from 'node:fs';
import path from 'node:path';
import { readText, filesIn } from './stack-scan.mjs';
import { riskyWords, WARN_WORDS } from './doc-risk.mjs';
import { workflowLines } from './doc-workflows.mjs';
import { protectedBy } from '../../hooks/lib/secrets.mjs';

export const MAX_DOC = 8;
const MAX_LEN = 120; // 이보다 긴 줄은 설명용 예시일 때가 많다. 정규식보다 먼저 본다(빈칸 4만 개 줄에서 3초 걸렸다)
const DOC_READ = 256 * 1024;
const CARGO_READ = 64 * 1024;
// README.rst 는 읽지 않는다 — 제목·코드 블록 꼴이 달라 마크다운으로 읽으면 설치·배포 제목을 못 알아본다
const DOCS = ['README.md', 'README', 'CONTRIBUTING.md', 'DEVELOPMENT.md', 'NOTES.md'];
// 이 제목 아래 블록은 평소 명령이 아니다(설치는 한 번, 배포·출시는 묻는 명령 쪽)
const SKIP_HEAD = /설치|install|set\s*up|setup|requirements|prerequisites|배포|deploy|release|출시|publish|license|라이선스|운영|production/i;
const SHELL_FENCE = /^(?:sh|bash|shell|console|zsh|shell-session|)$/i;
const CARGO_SUB = new Set(['test', 'bench', 'build', 'check', 'clippy', 'fmt', 'doc', 'run', 'miri', 'fuzz', 'nextest']);
const DIRS_MAX = 300;

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^[ \t]*(```+|~~~+)[ \t]*([\w-]*)/;

// 마크다운 → 후보 줄 글. 셸 코드 블록 줄(역슬래시로 이은 줄은 붙임)과, 블록 밖 글의 `…` 조각.
// 제목은 깊이를 따른다: 「## Deployment」 아래 「### Steps」 도 건너뛴다. 밑줄 제목(Deployment\n----)도 제목이다.
// `…` 조각은 그 줄에 주의·부정 낱말(Never·outside·주의·운영…)이 없을 때만, 코드 블록은 바로 앞 글 줄에 그런 낱말이 없을 때만
const markdownLines = (text) => {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = null; // 지금 블록을 읽는지(true/false), 블록 밖이면 null
  let skipAt = 0; // 건너뛰는 제목의 깊이(0 이면 건너뛰지 않음)
  let before = ''; // 블록 앞 마지막 글 줄
  let cur = '';
  const heading = (level, title) => {
    if (skipAt && level > skipAt) return;
    skipAt = SKIP_HEAD.test(title || '') ? level : 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const open = FENCE.exec(raw);
    if (open) {
      fence = fence === null ? SHELL_FENCE.test(open[2]) && !skipAt && !WARN_WORDS.test(before) : null;
      cur = '';
      continue;
    }
    if (fence !== null) {
      if (!fence) continue;
      const end = raw.trimEnd();
      if (end.endsWith('\\')) { cur += `${end.slice(0, -1)} `; continue; }
      out.push(cur + raw);
      cur = '';
      continue;
    }
    if (!raw.trim()) continue;
    const atx = ATX.exec(raw);
    if (atx) { heading(atx[1].length, atx[2]); before = ''; continue; }
    const under = SETEXT.exec(lines[i + 1] ?? '');
    if (under && !/^\s*(?:[-*+>]|\d+[.)])\s/.test(raw)) { heading(under[1][0] === '=' ? 1 : 2, raw); before = ''; i++; continue; }
    before = raw;
    if (!skipAt && !WARN_WORDS.test(raw)) for (const m of raw.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  }
  return out;
};

// Cargo.toml 의 [package] name. 한 줄씩(빈 줄 4만 개에서 6초 걸리던 여러 줄 정규식 대신)
const packageName = (text) => {
  let sec = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) { sec = t; continue; }
    const m = sec === '[package]' && /^name\s*=\s*"([^"]+)"/.exec(t);
    if (m) return m[1];
  }
  return null;
};
// [workspace] members = [ … ](여러 줄 꼴도) → 글롭 꼴 목록
const workspaceMembers = (text) => {
  let sec = '';
  let grab = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/#.*$/, '').trim();
    if (grab !== null) { grab += ` ${t}`; if (t.includes(']')) break; continue; }
    if (t.startsWith('[')) { sec = t; continue; }
    if (sec === '[workspace]' && /^members\s*=/.test(t)) { grab = t; if (t.includes(']')) break; }
  }
  return grab === null ? null : [...grab.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\/+$/, ''));
};
const globRe = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

// Cargo 패키지 폴더 → 이름. 맨 위 Cargo.toml 의 [workspace] members 만 본다(폴더 60×60 을 다 훑던 것 대신).
// members 에 끝 마디 밖의 글롭(**)이 있으면 예전처럼 두 단계까지 훑는다
const cargoPackages = (root) => {
  const top = readText(path.join(root, 'Cargo.toml'), CARGO_READ);
  const members = workspaceMembers(top);
  const dirs = ['.'];
  if (members) {
    for (const m of members) {
      const parent = path.posix.dirname(m);
      const last = path.posix.basename(m);
      if (parent.includes('*')) { dirs.push(...walk(root)); break; }
      if (!last.includes('*')) dirs.push(m);
      else dirs.push(...filesIn(root, parent).filter((e) => globRe(last).test(e)).map((e) => (parent === '.' ? e : `${parent}/${e}`)));
    }
  }
  const out = new Map();
  for (const d of [...new Set(dirs)].slice(0, DIRS_MAX)) {
    const name = packageName(d === '.' ? top : readText(path.join(root, d, 'Cargo.toml'), CARGO_READ));
    if (name) out.set(name, d);
  }
  return out;
};
const walk = (root) => filesIn(root, '.').filter((x) => !x.startsWith('.') && x !== 'target' && x !== 'node_modules').slice(0, 60)
  .flatMap((d) => [d, ...filesIn(root, d).slice(0, 60).map((e) => `${d}/${e}`)]);

// cargo 명령 낱말이 저장소에 있는 것만 가리키는지: -p 패키지, --test·--bench·--example 대상 파일, fuzz run 대상
const cargoOk = (root, w, pkgs) => {
  let i = 1;
  if (/^\+[\w.-]+$/.test(w[i] || '')) i++; // +nightly
  const sub = w[i];
  if (!CARGO_SUB.has(sub)) return false;
  if (sub === 'miri' && !/^(?:test|run)$/.test(w[i + 1] || '')) return false;
  if (sub === 'nextest' && w[i + 1] !== 'run') return false;
  if (sub === 'fuzz') return w[i + 1] === 'run' && !!w[i + 2] && /^[\w-]+$/.test(w[i + 2]) && fs.existsSync(path.join(root, 'fuzz', 'fuzz_targets', `${w[i + 2]}.rs`));
  const args = w.slice(i + 1, w.includes('--') ? w.indexOf('--') : w.length);
  const pick = (flag) => args.flatMap((x, k) => (x === flag ? [args[k + 1]] : x.startsWith(`${flag}=`) ? [x.slice(flag.length + 1)] : []));
  const named = [...pick('-p'), ...pick('--package')];
  if (named.some((n) => !n || !pkgs.has(n))) return false;
  const homes = named.length ? named.map((n) => pkgs.get(n)) : [...pkgs.values()];
  const target = (flag, sub2) => pick(flag).every((t) => t && /^[\w-]+$/.test(t) && homes.some((d) => fs.existsSync(path.join(root, d, sub2, `${t}.rs`)) || fs.existsSync(path.join(root, d, sub2, t, 'main.rs'))));
  return target('--test', 'tests') && target('--bench', 'benches') && target('--example', 'examples');
};

// python 스크립트·모듈이 저장소에 있는지. manage.py 는 Django 쪽(commands.mjs fromDjango)이 맡는다 — 하위 명령에 지우는 것(flush)도 있다.
// setup.py 는 패키지 만들기·올리기(sdist upload) 꼴이라 뺀다
const pythonOk = (root, w) => {
  let i = 1;
  while (i < w.length && w[i].startsWith('-') && w[i] !== '-m') { if (w[i] === '-c') return null; i++; }
  if (w[i] === '-m') {
    const mod = w[i + 1] || '';
    if (!/^[\w]+(?:\.[\w]+)*$/.test(mod)) return null;
    const rel = mod.replace(/\./g, '/');
    return [`${rel}.py`, `${rel}/__main__.py`].find((f) => fs.existsSync(path.join(root, f))) || null;
  }
  const file = (w[i] || '').replace(/^\.\//, '');
  if (!/^[\w./-]+\.py$/.test(file) || file.includes('..') || /^(?:manage|setup)\.py$/.test(path.basename(file))) return null;
  return fs.existsSync(path.join(root, file)) ? file : null;
};

// 결과를 쓰는 쪽 인자: -o·--out·--output… 의 값, out=·output_dir=·save_path=… 의 값(앞 마디 hydra.run.out= 도)
const OUT_OPT = /^(?:-o|--out|--output|--output-dir|--outdir|--out-dir|--output-path|--save|--save-dir|--save-path|--dest|--destination|--dump)$/;
const OUT_KEY = new Set(['out', 'output', 'output_dir', 'outdir', 'out_dir', 'output_path', 'save', 'save_path', 'save_dir', 'dest', 'destination', 'dump']);
const outputArgs = (w) => w.flatMap((x, k) => {
  const eq = x.indexOf('=');
  if (x.startsWith('-')) return OUT_OPT.test(x) ? [w[k + 1] || ''] : eq > 0 && OUT_OPT.test(x.slice(0, eq)) ? [x.slice(eq + 1)] : [];
  return eq > 0 && OUT_KEY.has(x.slice(0, eq).split('.').pop().toLowerCase().replace(/-/g, '_')) ? [x.slice(eq + 1)] : [];
}).map((v) => v.replace(/^["']|["']$/g, '')).filter(Boolean);

// 후보 줄 하나 → 명령(그대로 적을 글)과 같은 명령을 한 번만 내려는 열쇠. 꼴이 아니면 null.
// protect: 지킬 경로(폴더 data/·확장자 .hdf5·글롭) — 결과를 그리로 쓰는 명령은 뺀다. 읽는 쪽 인자(dataset.path=data/x.hdf5)는 그대로
const RUNNER = /^(?:uv|poetry|pdm|hatch|pipenv|rye)$/;
export const docCommand = (root, rawText, pkgs, protect = []) => {
  const raw = String(rawText ?? '');
  if (raw.length > MAX_LEN) return null;
  let text = raw.replace(/^\s*[$>]\s+/, '');
  // 끝 주석(# …)도 본다: 주의 낱말(WARNING·운영·never…)이나 위험한 낱말이 있으면 뺀다
  const hash = text.search(/\s#/);
  if (hash >= 0) {
    const note = text.slice(hash + 2);
    if (WARN_WORDS.test(note) || riskyWords(note.split(/\s+/))) return null;
    text = text.slice(0, hash);
  }
  text = text.trim();
  if (!text) return null;
  // 자리표시(<날짜>·<u64>)를 뺀 글에 이음·파이프·넘겨주기·명령 바꿔 넣기가 있으면 한 명령이 아니다. CI 의 ${{ … }} 도 바꿔 넣기다
  if (/[|;&<>`]|\$\(|\$\{\{/.test(text.replace(/<[^<>\s]+>/g, 'X'))) return null;
  const all = text.split(/\s+/);
  let at = 0;
  while (at < all.length && /^[A-Z_][A-Z0-9_]*=\S*$/.test(all[at])) at++; // 앞의 환경 변수(KV_SIM_SEED=1234)
  let w = all.slice(at);
  if (RUNNER.test(w[0] || '') && w[1] === 'run') w = w.slice(2);
  const tool = (w[0] || '').replace(/^.*\//, '');
  // 환경 변수 값(ENV=prod)과, 이름·인자·옵션 모두(--drop-existing·rebuild_db.py·$PROD_URL·--env=PROD) — 환경 변수 이름(KV_SIM_SEED)은 보지 않는다
  if (riskyWords([...all.slice(0, at).map((x) => x.slice(x.indexOf('=') + 1)), ...w], { cargo: tool === 'cargo' })) return null;
  if (protect.length && outputArgs(w).some((v) => protect.some((g) => protectedBy(v, g)))) return null;
  if (/^python[\d.]*$/.test(tool)) {
    const file = pythonOk(root, w);
    return file ? { cmd: text, key: `python:${file}` } : null;
  }
  if (tool === 'cargo' && pkgs.size && cargoOk(root, w, pkgs)) {
    // 같은 명령의 다른 적기(+nightly 있고 없고, -- 뒤 인자만 다른 서버 띄우기 두 줄)는 하나만
    return { cmd: text, key: `cargo:${all.slice(0, at).join(' ')} ${w.filter((x) => !x.startsWith('+')).join(' ').split(' -- ')[0]}` };
  }
  return null;
};

// → 명령 목록(README·개발 메모 차례, 그다음 CI). existing: 이미 찾은 명령 — 같거나 그 명령에 인자만 더한 꼴(cargo fmt --all -- --check)은 뺀다.
// protect: 지킬 경로(suggest.mjs 의 protect)
export const docCommands = (root, existing = [], protect = []) => {
  const pkgs = fs.existsSync(path.join(root, 'Cargo.toml')) ? cargoPackages(root) : new Map();
  const cands = [...DOCS.filter((f) => fs.existsSync(path.join(root, f))).flatMap((f) => markdownLines(readText(path.join(root, f), DOC_READ))), ...workflowLines(root)];
  const keys = new Set();
  const out = [];
  for (const text of cands) {
    if (out.length >= MAX_DOC) break;
    const c = docCommand(root, text, pkgs, protect);
    if (!c || keys.has(c.key) || existing.some((e) => c.cmd === e || c.cmd.startsWith(`${e} `))) continue;
    keys.add(c.key);
    out.push(c.cmd);
  }
  return out;
};
