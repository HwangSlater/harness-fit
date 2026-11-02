// 셸 명령(Bash/PowerShell) 규칙: 위험 명령·명령줄 비밀번호·비밀값 커밋.
import { git, GIT, dataMasked } from '../lib/core.mjs';
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';
import { wipesEverything } from '../lib/delete.mjs';
import { commitPlan } from '../lib/staged.mjs';

// 위험 명령은 실행되지 않는 글(커밋 메시지·echo 인자)을 비운 명령에서 찾는다(dataMasked).
// `bash -c "…"`·`eval "…"` 처럼 실행되는 따옴표 속은 그대로 본다.
const DANGER = [
  // rm·Remove-Item·del·rd 등으로 루트·홈·지금 폴더를 통째로 지우기(정책은 lib/delete.mjs 맨 위)
  wipesEverything,
  // 인터넷에서 받은 스크립트를 바로 실행
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:irm|Invoke-RestMethod)\b[^|\n]*\|\s*iex\b/i,
  /\bchmod\s+(?:-R\s+)?0?777\b/,
  /\bmkfs(?:\.\w+)?\s|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk)/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export const dangerCmd = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, t }) {
    const view = dataMasked(cmd, shell);
    return DANGER.some((d) => (typeof d === 'function' ? d(view) : d.test(view))) ? t('danger.cmd') : null;
  },
};

// 커밋하지 않은 변경을 날리는 명령은 작업 트리가 깨끗할 때만 둔다.
const DISCARD = new RegExp(GIT + String.raw`(?:reset\s+[^;&|\n]*--hard|clean\s+-[a-zA-Z]*f|checkout\s+(?:--\s+)?\.(?=\s|$)|restore\s+(?:--\S+\s+)*\.(?=\s|$))`);
export const discardChanges = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, root, t }) {
    if (!root || !DISCARD.test(cmd)) return null;
    // clean 은 추적 안 된 파일을, 나머지는 추적 중인 파일의 변경을 지운다.
    const untracked = /\bclean\b/.test(cmd) ? 'normal' : 'no';
    const dirty = (git(root, ['status', '--porcelain', `--untracked-files=${untracked}`]) || '').trim();
    return dirty ? t('danger.discard', { count: dirty.split('\n').length }) : null;
  },
};

const PASSWORD_ON_CLI = [
  /--password[= ](?!-?stdin)(?!["']?\$)\S+/i,
  // mysql 의 -p 는 비밀번호, -P 는 포트라 대소문자를 가린다.
  /\b(?:mysql|mysqldump|mysqladmin|mongo\w*)\b[^|;&\n]*\s-p(?!\s|$)(?!["']?\$)\S+/,
  /\bsshpass\s+-p\s*(?!["']?\$)\S+/i,
  /\bcurl\b[^|;&\n]*\s-u\s+["']?[^\s:"'$]+:(?!\$)[^\s"']+/i,
  /\b(?:PGPASSWORD|MYSQL_PWD)=(?!["']?\$)\S+/,
];
export const passwordCli = {
  id: 'password-cli',
  on: 'shell',
  check({ cmd, t }) {
    return PASSWORD_ON_CLI.some((re) => re.test(cmd)) ? t('password.cli') : null;
  },
};

// 커밋에 비밀값·키 파일이 들어가는지. 무엇이 들어가는지는 lib/staged.mjs(commitPlan) 가 정한다.
// 지우는 변경은 보지 않는다(저장소에서 .env 를 빼는 커밋은 통과).
export const secretsCommit = {
  id: 'secrets',
  on: 'shell',
  check({ cmd, shell, cwd, root, opts, t }) {
    if (!root) return null;
    const plan = commitPlan(cmd, cwd, root, shell);
    if (!plan) return null;
    const bad = plan.files.map((f) => [f, forbiddenFile(f, opts.paths || [])]).filter(([, why]) => why);
    if (bad.length) return t('secrets.commitFile', { files: bad.map(([f, w]) => `${f}(${t(w)})`).join(', ') });
    // 파일마다 경로와 함께 본다 — 쓰기 검사와 같이 테스트 파일은 대입 검사에서 뺀다.
    const hits = [...plan.added].flatMap(([file, ls]) => findSecrets(ls.join('\n'), file));
    return hits.length ? t('secrets.commit', { hits: [...new Set(hits)].join(', ') }) : null;
  },
};

export default [dangerCmd, discardChanges, passwordCli, secretsCommit];
