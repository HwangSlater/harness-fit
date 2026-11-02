// 셸 명령(Bash/PowerShell) 규칙: 위험 명령·명령줄 비밀번호·비밀값 커밋.
import fs from 'node:fs';
import path from 'node:path';
import { git, addArgs } from '../lib/core.mjs';
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';

const RM_TARGET = String.raw`(?:\/\*?|~\/?\*?|\$HOME\/?|\.{1,2}\/?|\*)`;
const DANGER = [
  // rm -rf / · ~ · $HOME · . · .. · *
  new RegExp(String.raw`\brm\s+(?:-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\s+["']?${RM_TARGET}["']?(?=\s|$|;|&|\|)`),
  // PowerShell: 드라이브 루트·홈을 통째로 지우기
  /\bRemove-Item\b[^;|&\n]*-Recurse[^;|&\n]*\s["']?(?:[A-Za-z]:\\?|~|\$HOME|\$env:USERPROFILE)["']?(?=\s|$)/i,
  // 인터넷에서 받은 스크립트를 바로 실행
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:irm|Invoke-RestMethod)\b[^|\n]*\|\s*iex\b/i,
  /\bchmod\s+(?:-R\s+)?0?777\b/,
  /\bmkfs(?:\.\w+)?\s|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk)/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export const dangerCmd = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, t }) {
    return DANGER.some((re) => re.test(cmd)) ? t('danger.cmd') : null;
  },
};

// 커밋하지 않은 변경을 날리는 명령은 작업 트리가 깨끗할 때만 둔다.
const DISCARD = /\bgit\s+(?:-C\s+\S+\s+)?(?:reset\s+[^;&|\n]*--hard|clean\s+-[a-zA-Z]*f|checkout\s+(?:--\s+)?\.(?=\s|$)|restore\s+(?:--\S+\s+)*\.(?=\s|$))/;
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
  /\b(?:mysql|mysqldump|mysqladmin|mongo\w*)\b[^|;&\n]*\s-p(?!\s|$)(?!["']?\$)\S+/i,
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

// 커밋에 비밀값·키 파일이 들어가는지. 이미 stage 한 것 + 같은 명령에서 add 하는 것.
export const secretsCommit = {
  id: 'secrets',
  on: 'shell',
  check({ cmd, cwd, root, opts, t }) {
    if (!root || !/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(cmd)) return null;
    const adds = addArgs(cmd);
    const staged = (git(root, ['diff', '--cached', '--name-only']) || '').split('\n').filter(Boolean);
    const files = [...new Set([...staged, ...adds.map((f) => path.relative(root, path.resolve(cwd, f)).split(path.sep).join('/'))])];
    const bad = files.map((f) => [f, forbiddenFile(f, opts.paths || [])]).filter(([, why]) => why);
    if (bad.length) return t('secrets.commitFile', { files: bad.map(([f, w]) => `${f}(${t(w)})`).join(', ') });
    const cached = git(root, ['diff', '--cached', '-U0', '--no-color']) || '';
    const pending = adds.length ? git(root, ['diff', '-U0', '--no-color', '--', ...adds.map((f) => path.resolve(cwd, f))]) || '' : '';
    const added = `${cached}\n${pending}`.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    // 아직 추적하지 않는 새 파일은 diff 에 안 나오므로 내용을 직접 읽는다(1MB 미만만).
    for (const f of adds) {
      const abs = path.resolve(cwd, f);
      if (git(root, ['ls-files', '--error-unmatch', '--', abs]) !== null) continue;
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && st.size < 1 << 20) added.push(fs.readFileSync(abs, 'utf8'));
      } catch {}
    }
    const hits = findSecrets(added.join('\n'));
    return hits.length ? t('secrets.commit', { hits: hits.join(', ') }) : null;
  },
};

export default [dangerCmd, discardChanges, passwordCli, secretsCommit];
