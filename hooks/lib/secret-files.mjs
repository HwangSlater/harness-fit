// 비밀 파일 읽기 묻기(protected-files 의 askRead, kind ask) — 역할극 15 회차 G5·16 회차 G4, 2026-11-16.
// 읽은 값은 대화 기록에 남는다. 다만 .env 읽기는 디버깅에 흔해 기본으로는 묻지 않는다(헛물음이 놓침보다 나쁘다).
// 묻는 것: 키·인증서·SSH 키(forbiddenFile 의 file.key·file.ssh), *.tfvars·*.auto.tfvars(.json), kubeconfig*·.kube/config,
// 사용자가 적은 보호 경로 가운데 그 파일을 그대로 적은 것과, 글롭·폴더·확장자 꼴이라도 비밀 파일 이름처럼 보이는 것(*.tfstate*·secrets/·.env).
// data/raw/ 같은 보통 보호 경로는 묻지 않는다(쓰기만 막는다).
import fs from 'node:fs';
import path from 'node:path';
import { forbiddenFile, protectedBy, foldCase } from './secrets.mjs';
import { commandSegments } from './cmdline.mjs';
import { runWords } from './run-prefix.mjs';
import { normPath } from './lines.mjs';

// 틀·예시 이름은 끝에 붙은 것만(kubeconfig.tpl · server.key.example · kubeconfig.yaml.j2). 가운데 낀 것(prod.tpl.key)은 틀이 아니다(검토 2026-11-16).
// 틀이라도 키·kubeconfig 이름이면 안의 글을 보고 진짜 값(PRIVATE KEY·client-key-data·token:)이 있으면 묻는다.
const TEMPLATE_END = /\.(?:example|sample|template|tmpl|tpl|dist|j2|jinja2?|gotmpl)$/i;
// kubeconfig 이름의 코드·문서(kubeconfig.go · kubeconfig.md · kubeconfig.sh …)는 설정 파일이 아니다(검토 2026-11-16). .yaml·.yml·확장자 없음은 묻는다.
// .txt 는 넣지 않는다 — `kubectl config view --raw > kubeconfig.txt` 의 결과가 진짜 kubeconfig 다. j2·gotmpl 은 틀(TEMPLATE_END)로 안을 본다
const CODE_DOC = /\.(?:md|markdown|mdx|rst|adoc|html?|sh|bash|zsh|ps1|[cm]?[jt]sx?|go|py|rb|rs|java|kt|swift|php|cs)$/i;
// 틀 속 진짜 비밀 값. {{ … }}·${ … }·<…> 자리 표시는 값이 아니다
const SECRET_TEXT = /PRIVATE KEY|^[ \t]*(?:-[ \t]*)?(?:client-key-data|token):[ \t]*(?!["']?(?:\{\{|\$\{|<)|""|'')\S/m;
// 키 파일을 시험·의존성 자리에서 읽는 것은 흔하다(가짜 키·라이브러리 시험 자료). 경로를 풀어 저장소 안일 때만 본다
const KEY_FIXTURE = /(?:^|\/)(?:node_modules|testdata)\/|(?:^|\/)tests?\/fixtures\//i;
// 사용자가 적은 꼴이 비밀 파일 이름처럼 보이는지(.vault_pass*·*.tfstate*·kubeconfig*·secrets/·.env·*.pem)
const SECRETISH = /(?:^|[/._*-])(?:env|pem|key|keys|p8|p12|pfx|tfvars|tfstate|tfplan|kubeconfig|kube|secrets?|credentials?|keystore|jks|vault[-_]?pass(?:word)?)(?:$|[/._*-])/i;
const tidy = (g) => foldCase(normPath(g).trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, ''));

// 파일 글을 1MB 까지 읽는다 → 글 | 'missing'(없음) | 'unsure'(더 크거나·폴더·권한으로 못 읽음)
// HAProxy·nginx 의 묶음 .pem 은 인증서 뒤 맨 끝에 키가 있어 앞부분만 보면 놓친다(검토 2026-11-16)
const MAX_SCAN_BYTES = 1024 * 1024;
const scan = (abs) => {
  if (!abs) return 'missing';
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) return 'unsure';
    return fs.readFileSync(abs, 'latin1');
  } catch (e) {
    return e?.code === 'ENOENT' ? 'missing' : 'unsure';
  }
};
// 틀 안에 진짜 값이 있을 수 있나. 없는 파일은 읽을 것도 없다
const secretInside = (abs) => {
  const text = scan(abs);
  if (text === 'missing') return false;
  return text === 'unsure' || SECRET_TEXT.test(text);
};
// helm 차트의 templates/ 밑인지: templates 바로 위 폴더에 Chart.yaml 이 있을 때만(아무 templates/ 나 helm 으로 보던 일 — 검토 2026-11-16).
// 경로 조각 수만큼만 본다(앞의 몇 개)
const MAX_TEMPLATE_DIRS = 4;
const helmTemplate = (p, root) => {
  if (!root) return false;
  const parts = p.split('/');
  let seen = 0;
  for (let i = 0; i < parts.length - 1 && seen < MAX_TEMPLATE_DIRS; i++) {
    if (parts[i].toLowerCase() !== 'templates') continue;
    seen++;
    if (fs.existsSync(path.join(root, ...parts.slice(0, i), 'Chart.yaml'))) return true;
  }
  return false;
};

// 읽기를 물을 까닭(문구 키) 또는 null. rel: 프로젝트 맨 위 기준(밖이면 푼 절대 경로)
// inRepo: 저장소 안일 때만 시험 자료·helm 틀로 봐준다. abs: 안의 글을 볼 파일(없으면 글을 보지 않는다). root: 프로젝트 맨 위
export const readSecretWhy = (rel, extra = [], { inRepo = true, abs = null, root = null } = {}) => {
  const p = normPath(rel);
  const base = p.split('/').pop().toLowerCase();
  if (!base) return null;
  const template = TEMPLATE_END.test(base);
  const inner = template ? p.replace(TEMPLATE_END, '') : p;
  const innerBase = inner.split('/').pop().toLowerCase();
  const why = forbiddenFile(inner, []);
  const key = why === 'file.key' || why === 'file.ssh';
  const kube = (/^kubeconfig/.test(innerBase) && !CODE_DOC.test(innerBase)) || /(?:^|\/)\.kube\/config$/i.test(inner);
  if (template) return (key || kube) && secretInside(abs) ? (key ? why : 'file.kubeconfig') : null;
  if (key) return inRepo && KEY_FIXTURE.test(p) ? null : why;
  if (/\.tfvars(?:\.json)?$/.test(base)) return 'file.tfvars';
  if (kube) return inRepo && helmTemplate(p, root) && !secretInside(abs) ? null : 'file.kubeconfig';
  const norm = `/${foldCase(p).replace(/^\.\//, '')}`;
  for (const g of Array.isArray(extra) ? extra : []) {
    const s = String(g ?? '');
    if (!s.trim() || !protectedBy(p, s)) continue;
    const want = tidy(s);
    const exact = !s.includes('*') && !/[/\\]\s*$/.test(s) && want && norm.endsWith(`/${want}`);
    if (exact || SECRETISH.test(s)) return 'file.protected';
  }
  return null;
};

// .pem·.crt 는 대개 공개 인증서(체인·CA 묶음)다 — 파일 안(1MB 까지)에 PRIVATE KEY 가 있을 때만 묻는다. 더 크거나 못 읽으면(없음·권한) 묻는다
const CERT_FILE = /\.(?:pem|crt)$/i;
const hasPrivateKey = (abs) => {
  const text = scan(abs);
  return text === 'missing' || text === 'unsure' || text.includes('PRIVATE KEY');
};

// 파일 하나를 읽으려 할 때의 묻는 글. 경로는 먼저 절대 경로로 푼 뒤 프로젝트 맨 위 기준으로 맞춘다(files.mjs protectedFiles 와 같게).
// 풀지 않고 보면 node_modules/../../.ssh/id_rsa 가 시험 자료로 보여 지나갔다(검토 2026-11-16)
export const readAsk = (file, { cwd, project, opts, t }) => {
  if (!file || opts.askRead === false) return null;
  const here = cwd || process.cwd();
  const raw = String(file);
  const home = /^(?:~|\$HOME|\$env:USERPROFILE)(?:[/\\]|$)/i.test(raw);
  const root = project || here;
  const abs = home ? null : path.resolve(here, raw);
  const rel = abs ? normPath(path.relative(root, abs)) : '';
  const inRepo = !!rel && rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel);
  const where = inRepo ? rel : abs ? normPath(abs) : raw;
  const why = readSecretWhy(where, opts.paths, { inRepo, abs, root: inRepo ? root : null });
  if (why === 'file.key' && CERT_FILE.test(raw) && abs && !hasPrivateKey(abs)) return null;
  return why ? t('protected.read', { file: raw, why: t(why) }) : null;
};

// 파일 내용을 화면에 찍는 명령(셸). 인자 가운데 - 로 시작하지 않는 낱말을 파일로 본다(숫자 값 -n 20 의 20 은 파일 이름에 안 걸린다)
const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'nl', 'type', 'get-content', 'gc']);
const exe = (w) => String(w || '').replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
// 넘겨쓰기(> f · 2> f · >f · >>f · 2>&1)의 대상은 쓰는 파일이다(검토 2026-11-16). 낱말이 연산자뿐이면 다음 낱말이 대상
const REDIRECT_OUT = /^(?:\d+|&)?>>?(?:&\d*-?|\|)?/;
// 2>&1 · >&2 · 2>&- 는 파일이 아니라 다른 출력으로 잇는 것이라 낱말 안에서 끝난다 — 다음 낱말은 그대로 읽는 파일 후보다
const FD_DUP = /^\d*>&(?:\d+|-)$/;
// 이 낱말이 넘겨쓰기면 → 'next'(다음 낱말이 대상) | 'self'(대상까지 낱말 안에) | null(넘겨쓰기 아님)
export const redirectWord = (a) => {
  const out = REDIRECT_OUT.exec(a);
  if (!out) return null;
  return out[0] === a && !FD_DUP.test(a) ? 'next' : 'self';
};
// bash 의 type 은 명령 이름을 알려 주는 내장 명령이다(type kubectl). PowerShell 의 type(Get-Content) 이거나 인자가 경로(. 또는 /)일 때만 읽기로 본다
const typeReads = (shell, a) => /powershell/i.test(shell || '') || /[./\\]/.test(a);
export const shellReadAsk = (ctx) => {
  if (ctx.opts.askRead === false) return null;
  for (const seg of commandSegments(ctx.cmd, ctx.shell)) {
    const w = runWords(seg.words);
    if (!w.length || !READERS.has(exe(w[0]))) continue;
    const isType = exe(w[0]) === 'type';
    for (let i = 1; i < w.length; i++) {
      let a = w[i];
      const redirect = redirectWord(a);
      if (redirect) { if (redirect === 'next') i++; continue; }
      if (a.startsWith('-') || a.startsWith('|') || a.startsWith('<<') || a.startsWith('<(')) continue;
      // cat <file(붙여 쓴 <) — 읽는 파일이다. 따로 쓴 < 는 다음 낱말이 그대로 파일로 잡힌다
      if (a.startsWith('<')) a = a.slice(1);
      a = a.replace(/^["']|["']$/g, '');
      if (!a || (isType && !typeReads(ctx.shell, a))) continue;
      const msg = readAsk(a, ctx);
      if (msg) return msg;
    }
  }
  return null;
};
