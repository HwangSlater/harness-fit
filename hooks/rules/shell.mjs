// 셸 명령(Bash/PowerShell) 규칙: 위험 명령·명령줄 비밀번호. 비밀값 커밋은 rules/commit.mjs.
// 둘 다 「적어 둔 꼴」만 막는다(packs.json detail 에 적은 목록). 실행되지 않는 글(커밋 메시지·echo 인자·cat heredoc)은 비운 뒤 본다.
import { git, GIT, dataMasked, stripQuoted, gitSegments } from '../lib/core.mjs';
import { wipesEverything } from '../lib/delete.mjs';
import { commandSegments, splitWords } from '../lib/cmdline.mjs';
import { runWords } from '../lib/run-prefix.mjs';
import { remoteCommand, exportsOf, profilesWipe } from '../lib/remote-cmd.mjs';
import { tagPush, withFollowTags } from '../lib/tag-push.mjs';
import { secretRead } from '../lib/secret-read.mjs';
import { hiddenRuns, runForms, substNote } from '../lib/hidden-runs.mjs';
import { valueShown, hiddenSecret, afterPsAssign, substitutions } from '../lib/secret-sink.mjs';
import { askPatterns, entryModules, justLooking, segmentHit, blockHit, cmdList } from '../lib/ask-match.mjs';
import { devUrlLogin } from '../lib/secrets.mjs';
// 보호 파일(.env·키·적은 경로)을 셸로 바꾸거나 지우기는 rules/protected-shell.mjs(여기서 함께 내보낸다)
import protectedRules from './protected-shell.mjs';

// 받은 것을 실행하는 셸·언어(프로세스 치환 꼴용)
const RUNNER = String.raw`(?:(?:ba|z|da|k)?sh|fish|pwsh|powershell|python[23]?|node|perl|ruby|php)`;
const PS_FETCH = String.raw`(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|\(?\s*New-Object\s+(?:System\.)?Net\.WebClient\s*\)?\s*\.\s*DownloadString)`;

// 받은 것을 파이프로 바로 실행: curl … | sh, wget -qO- … | sudo bash, curl … | tee x | sh, iwr … | iex.
// 받는 명령은 파이프 단계의 명령 자리에 있을 때만(`cat curl-out.json` 은 아니다), 실행기는 표준 입력을 코드로 읽을 때만
// (`python3 -m json.tool`·`node -e "…"`·`bash script.sh` 은 받은 것을 실행하지 않는다).
const FETCHERS = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest', 'irm', 'invoke-restmethod']);
const EVALUATORS = new Set(['iex', 'invoke-expression']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const RUNNERS = new Set([...SHELLS, 'pwsh', 'powershell', 'python', 'python2', 'python3', 'node', 'perl', 'ruby', 'php']);
// 실행기마다 「표준 입력 대신 다른 코드·모듈을 돌리는」 옵션
const NOT_STDIN = { python: /^-[mc]/, node: /^(?:-e|-p|--eval|--print)$/, perl: /^-[a-zA-Z]*e/, ruby: /^-[a-zA-Z]*e/, php: /^-r$/, pwsh: /^-(?:c|command|f|file)$/i };
const STAGE_PREFIX = /^(?:sudo|env|nohup|command|exec)$|^[A-Za-z_]\w*=|^-/;
const exeName = (w) => w.replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
const stageWords = (stage) => {
  const w = stage.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < w.length && STAGE_PREFIX.test(w[i])) i++;
  return w.slice(i);
};
const readsStdin = (name, args) => {
  const family = /^python/.test(name) ? 'python' : name === 'powershell' ? 'pwsh' : name;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' || (SHELLS.has(name) && /^-[a-zA-Z]*s/.test(a))) return true;
    if (SHELLS.has(name) && /^-[a-zA-Z]*c/.test(a)) return false;
    if (NOT_STDIN[family]?.test(a)) return family === 'pwsh' && args[i + 1] === '-';
    if (!a.startsWith('-')) return false; // 스크립트 파일
  }
  return true;
};
export const pipedRun = (view) =>
  view.split(/&&|\|\||[;\n]|(?<![|&])&(?!&)/).some((line) => {
    const stages = line.split('|').map(stageWords);
    const from = stages.findIndex((w) => w[0] && FETCHERS.has(exeName(w[0])));
    return from !== -1 && stages.slice(from + 1).some(([cmd, ...args]) => {
      const name = exeName(cmd || '');
      return EVALUATORS.has(name) || (RUNNERS.has(name) && readsStdin(name, args));
    });
  });

// 위험 명령은 실행되지 않는 글(커밋 메시지·echo 인자·실행기로 가지 않는 heredoc 본문)을 비운 명령에서 찾는다(dataMasked).
// `bash -c "…"`·`eval "…"` 처럼 실행되는 따옴표 속은 그대로 본다.
const DANGER = [
  // rm·Remove-Item·del·rd 등으로 루트·홈·지금 폴더를 통째로 지우기(정책은 lib/delete.mjs 맨 위)
  wipesEverything,
  pipedRun,
  // 프로세스 치환 `bash <(curl …)`, `sh -c "$(curl …)"`
  new RegExp(String.raw`\b(?:${RUNNER}|source)\s+<\(\s*(?:curl|wget)\b|\b${RUNNER}\s+-c\s+["']?\$\(\s*(?:curl|wget)\b`, 'i'),
  // PowerShell: iex (irm …), Invoke-Expression ((New-Object Net.WebClient).DownloadString(…)), [scriptblock]::Create((irm …))
  new RegExp(String.raw`\b(?:iex|Invoke-Expression)\b\s*(?:-Command\s*)?\(+\s*${PS_FETCH}|\[scriptblock\]::Create\(\s*\(*\s*${PS_FETCH}`, 'i'),
  // 모두에게 쓰기 권한: chmod 777 · 0777 · a+rwx · ugo+rwx (옵션 앞뒤 순서 상관없음)
  /\bchmod\s+(?:-{1,2}[\w-]+\s+)*(?:0?777|(?:a|ugo)\+rw[xX])(?=\s|$)/,
  // 디스크 통째 지우기: mkfs, dd of=/dev/디스크, Format-Volume, Clear-Disk, format C:
  /\bmkfs(?:\.\w+)?\s|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk|hd|vd|xvd|mmcblk)/,
  /\b(?:Format-Volume|Clear-Disk)\b|(?:^|[\s;&|])format(?:\.com)?\s+[A-Za-z]:/i,
  // fork bomb
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

// 숨은 실행(백틱·$(…)·echo … | bash·find -exec·find -delete·Start-Process cmd -ArgumentList …)도 본다(lib/hidden-runs.mjs — 다시 검토 2026-11-13).
// 앞붙이를 벗긴 낱말은 그 첫 낱말이 지우기·권한·디스크 명령일 때만 이어 붙여 본다(echo 인자 속 글을 명령으로 읽지 않게)
const DANGER_HEAD = /^(?:rm|del|erase|ri|rd|rmdir|remove-item|chmod|dd|mkfs(?:\.\w+)?|format-volume|clear-disk|format(?:\.com)?)$/;
const dangerIn = (text) => DANGER.some((d) => (typeof d === 'function' ? d(text) : d.test(text)));
export const dangerCmd = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, t }) {
    // 백틱·$(…) 속에서 걸렸으면 셸이 실제로 실행한다는 말을 덧붙인다(커밋 메시지 자체가 막힌 줄 알던 일 — 검토 2026-11-13)
    const why = (subst) => t('danger.cmd') + (subst ? substNote(t, shell) : '');
    const view = dataMasked(cmd, shell);
    const inSubst = () => hiddenRuns(cmd, shell, view).some((h) => h.subst && dangerIn(dataMasked(h.cmd, h.shell)));
    if (dangerIn(view)) return why(inSubst());
    for (const h of hiddenRuns(cmd, shell, view)) if (dangerIn(dataMasked(h.cmd, h.shell))) return why(h.subst);
    for (const { line, subst } of runForms(cmd, shell)) if (DANGER_HEAD.test(line[0] || '') && dangerIn(line.join(' '))) return why(subst);
    return null;
  },
};

// DB 데이터를 통째로 지우는 명령(개발 DB 라도 되돌릴 수 없다 — 역할극 1·4·5 회차에서 모두 통과했던 꼴, 2026-11-11).
// 명령 조각(; && | 로 나눈 것)마다 실제로 실행되는 도구가 그 도구일 때만 본다 — `grep "prisma migrate reset"` 같은 검색 인자에 걸리던 일(검토 2026-11-11).
// 앞붙이(sudo·env·npx·pnpm exec·uv run·python -m·docker compose exec <서비스> 등)는 벗긴다. 커밋 메시지·echo 속 글은 dataMasked 가 비운다.
// psql <<EOF 처럼 heredoc·파이프·파일(< x.sql)로 넘긴 SQL, npm run db:reset 처럼 스크립트 속 명령은 못 본다(detail 에 적음).
const stripRun = runWords;
const DJANGO = /^(?:manage\.py|django-admin|django)$/;
// 옵션이 아닌 낱말들(값을 받는 옵션의 값은 건너뛴다 — celery -A proj 의 proj)
const CELERY_VALUE = /^(?:-A|--app|-b|--broker|--result-backend|--loader|--config|--workdir|-Q|--queues|-X|--exclude-queues)$/;
const positional = (w, valueOpt = null) => w.filter((x, i) => !x.startsWith('-') && !(i > 0 && valueOpt?.test(w[i - 1])));
// DB 클라이언트(또는 manage.py dbshell)로 넘기는지: sqlflush 의 출력을 파이프로 실행하는 꼴
const DB_CLIENT = /^(?:psql|mysql|mariadb|sqlite3|sqlcmd|duckdb)$/;
const runsSql = (w) => DB_CLIENT.test(w[0] || '') || (DJANGO.test(w[0] || '') && w[1] === 'dbshell');
const DB_WIPE = [
  // docker compose down -v / --volumes (docker-compose·podman-compose 도, --dry-run 은 보기만), 볼륨 지우기
  (l) => /^(?:docker|podman) compose |^(?:docker|podman)-compose /.test(l) && /\sdown(?:\s|$)/.test(l) && /\s(?:-[a-zA-Z]*v[a-zA-Z]*|--volumes)(?=\s|$)/.test(l) && !/\s--dry-run\b/.test(l),
  /^(?:docker|podman) volume (?:rm|remove|prune)\b/,
  /^(?:docker|podman) system prune\b.*\s--volumes\b/,
  // 마이그레이션 도구의 「DB 를 비우고 다시」
  /^prisma migrate reset\b/,
  /^prisma db push\b.*\s--(?:accept-data-loss|force-reset)\b/,
  /^alembic downgrade base\b/,
  /^(?:manage\.py|django-admin|django) (?:flush|reset_db)\b/,
  // Django 마이그레이션을 맨 처음으로(migrate <앱> zero — 그 앱의 테이블을 모두 지운다). --plan 은 보기만, --fake 는 기록만 바꾼다.
  (l, w) => DJANGO.test(w[0]) && w[1] === 'migrate' && positional(w.slice(2)).includes('zero') && !w.includes('--plan') && !w.includes('--fake'),
  // Flyway clean(스키마의 모든 것을 지운다): flyway clean · gradle flywayClean · mvn flyway:clean
  (l, w) => w[0] === 'flyway' && positional(w.slice(1)).includes('clean'),
  (l, w) => /^(?:gradlew?|gradlew\.bat)$/.test(w[0]) && w.slice(1).some((x) => /^(?:\S*:)?flywayClean$/.test(x)),
  (l, w) => /^(?:mvnw?|mvnw\.cmd|mvn\.cmd)$/.test(w[0]) && w.includes('flyway:clean'),
  // Celery 대기열 비우기: 확인 없이(-f·--force) 지우는 것만 — 그냥 purge 는 묻고, 이 셸은 답할 수 없어 그만둔다
  (l, w) => w[0] === 'celery' && positional(w.slice(1), CELERY_VALUE).includes('purge') && w.some((x) => x === '-f' || x === '--force'),
  /^(?:rails|rake) db:(?:drop|reset|purge|schema:load|seed:replant)\b/,
  /^supabase db reset\b/,
  /^(?:sequelize(?:-cli)? db:drop|typeorm schema:drop)\b/,
  // DB 자체를 지우는 도구
  /^dropdb\s/,
  /^mysqladmin\b.*\sdrop\b/,
  /^redis-cli\b.*\sflush(?:all|db)\b/i,
  // SQL 클라이언트 인자로 넘긴 DROP·TRUNCATE
  /^(?:psql|mysql|mariadb|sqlite3|sqlcmd|mongosh|mongo|duckdb|clickhouse-client|cqlsh)\s.*(?:\bDROP\s+(?:TABLE|DATABASE|SCHEMA|COLLECTION|KEYSPACE)\b|\bTRUNCATE\b|\bdropDatabase\s*\(|\.drop\s*\(\s*\))/i,
];
export const dbWipe = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, t }) {
    const view = dataMasked(cmd, shell);
    const segs = commandSegments(view, shell);
    for (const [k, seg] of segs.entries()) {
      const words = stripRun(seg.words);
      const line = words.join(' ');
      // 도움말 보기: 따옴표 밖 낱말 하나인 --help 만(-h 는 psql·dropdb·redis-cli 의 호스트, 따옴표 속 SQL 주석의 --help 도 아님 — 검토 2026-11-11)
      if (words.slice(1).includes('--help')) continue;
      if (DB_WIPE.some((d) => (typeof d === 'function' ? d(line, words) : d.test(line)))) return t('danger.db');
      // manage.py sqlflush | manage.py dbshell · | psql — 지우는 SQL 을 만들어 바로 실행(| less·> 파일 은 보기만)
      const end = seg.start + seg.raw.length;
      const piped = view[end] === '|' && view[end + 1] !== '|' && segs[k + 1]?.start === end + 1;
      if (DJANGO.test(words[0] || '') && words[1] === 'sqlflush' && piped && runsSql(stripRun(segs[k + 1].words))) return t('danger.db');
    }
    return null;
  },
};

// 실행 전에 사용자에게 묻는 명령(ask-cmd, kind: ask — 막지 않고 Claude Code 가 확인 창을 띄운다).
// 사용자가 적은 명령(commands: 「ros2 launch」, 「python scripts/train.py」 처럼 앞부분)과, remote 를 켜면 원격·운영에 닿는 명령.
// 역할극 2·3·6 회차: 실제 로봇·긴 학습·운영 서버 명령을 묻게 하는 훅이 없어 세션마다 손으로 만들었다(2026-11-11).
export const askCmd = {
  id: 'ask-cmd',
  on: 'shell',
  ask: true,
  check({ cmd, shell, opts, t, root, project, cwd }) {
    const list = cmdList(opts.commands);
    const entries = list.length ? entryModules(project || root || cwd) : {};
    const wants = askPatterns(list, entries, (c) => splitWords(c, shell));
    let carried = {}; // 앞 조각에서 export 한 DOCKER_HOST·PGHOST 등
    const view = dataMasked(cmd, shell);
    const segs = commandSegments(view, shell);
    // 비밀값을 꺼내 찍는 명령(lib/secret-read.mjs) — PowerShell 의 $x = 앞말을 떼고 본다. 찍히는지는 lib/secret-sink.mjs
    const isSecret = (words) => {
      const w = afterPsAssign(words);
      const bare = w.length ? [exeName(w[0]), ...w.slice(1)] : [];
      return [runWords(w), bare].some((x) => x.length && !justLooking(x) && secretRead(x, { cwd }));
    };
    let subs = null;
    for (const [k, seg] of segs.entries()) {
      const exported = exportsOf(seg.words);
      if (Object.keys(exported).length) { carried = { ...carried, ...exported }; continue; }
      const line = runWords(seg.words);
      if (!line.length && !seg.words.length) continue;
      const ask = (key) => t(key, { cmd: seg.raw.trim().slice(0, 120) });
      // 적은 명령(앞 낱말 + 적은 옵션, lib/ask-match.mjs). 도움말·버전 보기와 같은 조각의 시험 실행(DRY_RUN=1·--dry-run·--plan)은 묻지 않는다.
      // push.followTags 가 켜진 git push 는 --follow-tags 를 붙인 꼴로 견준다(lib/tag-push.mjs)
      if (segmentHit(seg.words, withFollowTags(line, cwd, cmd), wants, entries)) return ask('ask.cmd');
      if (opts.remote === false) continue;
      // 찍은 값은 대화 기록에 남는다. 화면에 분명히 닿을 때만 묻는다(valueShown — 헛물음이 놓침보다 나쁘다)
      if (isSecret(seg.words) && valueShown(cmd, view, segs, k, shell, (subs ??= substitutions(view, shell)))) return ask('ask.secret');
      if (remoteCommand(seg.words, line, carried)) return ask('ask.remote');
      if (profilesWipe(seg.raw, shell, seg.words)) return ask('ask.profiles');
      if (tagPush(line, cwd)) return ask('ask.tag');
    }
    // 적은 명령이 숨은 곳(백틱·echo … | bash·bash <<<…·find -exec)에서 실행되는지 — 막기와 같은 길(runForms)
    if (wants.length) {
      for (const { seg, words, line, subst } of runForms(cmd, shell, exportOnly)) {
        if (segmentHit(words, line, wants, entries)) return t('ask.cmd', { cmd: seg.raw.trim().slice(0, 120) }) + (subst ? substNote(t, shell) : '');
      }
    }
    // 조각으로 나뉘지 않는 치환 속(echo "$(…)" · 백틱 · heredoc 본문)
    const hidden = opts.remote === false ? null : hiddenSecret(cmd, view, segs, shell, isSecret, (subs ??= substitutions(view, shell)));
    return hidden ? t('ask.secret', { cmd: hidden.slice(0, 120) }) : null;
  },
};

// 실행하지 못하게 막는 명령(ask-cmd 의 block — 묻지 않고 막는다). 맞추는 법은 commands 와 같다(lib/ask-match.mjs):
// 앞붙이(sudo·npx·bash -c …)·-chdir·cd … &&·옵션 자리가 달라도 맞는다 — permissions.deny 는 앞부분만 맞춰 이 꼴을 놓친다
// (역할극 13·14·15 회차: 운영 명령을 「아예 못 하게」 해 달라는 요청을 들어줄 길이 없었다, 2026-11-13).
// 도움말·버전 보기(그 낱말 하나만 더 붙은 꼴)와 읽기 하위 명령(kubectl get 등 — 비밀값 읽기는 빼고)은 막지 않는다.
// 시험 실행 표시(--dry-run·DRY_RUN=1)는 보지 않는다 — 스크립트가 무시하면 그대로 실행된다(lib/ask-match.mjs blockHit). 막는 글이 묻는 글보다 먼저다(hooks/run.mjs)
// 조각으로 안 보이는 실행(백틱·echo … | bash·bash <<<…·find -exec)도 본다(lib/hidden-runs.mjs). alias·$변수 명령·이미지 속 명령은 못 본다(decisions-hooks.md)
// 명령 글 → 조각마다 [원래 낱말, find -exec 속 낱말…](lib/hidden-runs.mjs runForms). export 만 하는 조각은 건너뛴다
const exportOnly = (seg) => Object.keys(exportsOf(seg.words)).length > 0;
export const blockCmd = {
  id: 'ask-cmd',
  on: 'shell',
  check({ cmd, shell, opts, t, root, project, cwd }) {
    const list = cmdList(opts.block);
    if (!list.length) return null;
    const entries = entryModules(project || root || cwd);
    const split = (c) => splitWords(c, shell);
    const each = list.map((rule) => ({ rule, pats: askPatterns([rule], entries, split) }));
    // 태그 올리기를 막는 줄(git push --tags·--follow-tags)이 있으면 태그를 올리는 push 를 모두 막는다 — 이름 붙인 태그·refs/tags/…·tag v…·태그 지우기
    // (역할극 16 회차 다시: tagPush 는 묻기에만 쓰여 막을 길이 없었다, 2026-11-13). 글롭 맞추기는 하지 않는다
    const tagRule = list.find((r) => /^\s*git\s+push\b.*\s--(?:follow-)?tags\b/.test(r));
    for (const { seg, words, line, subst } of runForms(cmd, shell, exportOnly)) {
      const l = withFollowTags(line, cwd, cmd);
      const hit = each.find((e) => blockHit(words, l, e.pats, entries));
      if (hit) return t('block.cmd', { cmd: seg.raw.trim().slice(0, 120), rule: hit.rule.slice(0, 80) }) + (subst ? substNote(t, shell) : '');
      if (tagRule && tagPush(line, cwd)) return t('block.cmd', { cmd: seg.raw.trim().slice(0, 120), rule: tagRule.slice(0, 80) });
    }
    return null;
  },
};

// 커밋하지 않은 변경을 날리는 명령은 작업 트리가 깨끗할 때만 둔다.
// restore --staged 만 주면 stage 만 비우고 파일은 그대로라 뺀다(--worktree 를 같이 주면 지운다).
// checkout 은 `checkout HEAD -- .`·`checkout main .` 처럼 커밋을 앞에 줘도 지금 폴더 전체를 덮어쓴다. restore 는 `-s HEAD .` 도.
const DISCARD = new RegExp(GIT + String.raw`(?:reset\s+[^;&|\n]*--hard|clean\s+(?:-[a-zA-Z]*\s+)*(?:-[a-zA-Z]*f|--force)|checkout\s+(?:-f\s+|--force\s+)?(?:[^\s;&|-]\S*\s+)?(?:--\s+)?\.(?=\s|$)|restore\s+((?:(?:-s|--source)\s+\S+\s+|--?\S+\s+)*)\.(?=\s|$))`);
export const discardChanges = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, root, cwd, t }) {
    if (!root) return null;
    const bare = stripQuoted(cmd, shell);
    const m = bare.match(DISCARD);
    if (!m) return null;
    if (m[1] !== undefined && /(?:^|\s)(?:--staged|-S)\s/.test(m[1]) && !/(?:^|\s)(?:--worktree|-W)\s/.test(m[1])) return null;
    const rest = bare.slice(m.index);
    const seg = rest.slice(0, rest.search(/[;&|\n]|$/));
    // clean 은 추적 안 된 파일을(-x·-X 면 무시 목록의 파일 — .env 같은 것 — 도), 나머지는 추적 중인 파일의 변경을 지운다.
    const clean = /\bclean\b/.test(m[0]);
    if (clean && /(?:^|\s)(?:-[a-zA-Z]*n[a-zA-Z]*|--dry-run)(?=\s|$)/.test(seg)) return null; // 보기만
    const ignored = clean && /(?:^|\s)-[a-zA-Z]*[xX]/.test(seg);
    // -X 는 무시 목록의 파일만 지운다(추적 안 된 보통 파일은 그대로)
    const onlyIgnored = clean && /(?:^|\s)-[a-zA-Z]*X/.test(seg);
    // 같은 명령 앞에서 git stash 로 보관했으면 지울 것이 없다(clean 은 -u·-a 로 추적 안 된 파일까지 보관했을 때만)
    const stashed = gitSegments(cmd, 'stash', shell).some((s) => {
      if (s.start >= m.index || !(s.words.length === 0 || /^(?:push|save|-)/.test(s.words[0]))) return false;
      const opts = s.words.join(' ');
      return !clean || (ignored ? /(?:^|\s)(?:-a|--all)(?=\s|$)/ : /(?:^|\s)(?:-u|--include-untracked|-a|--all)(?=\s|$)/).test(opts);
    });
    if (stashed) return null;
    // clean 은 git 에게 같은 인자로 시험 실행(-n)을 시켜 실제로 지울 것만 센다 — 주어진 경로 밖이나 추적 중인 파일의 변경은 clean 이 건드리지 않는다
    // (git clean -fd dist 를 저장소 전체 변경 수로 「2개를 버린다」 고 막던 일 — 검토 2026-11-13). -i(대화형)는 뺀다
    if (clean) {
      const cs = gitSegments(cmd, 'clean', shell).find((s) => s.start > m.index);
      if (cs) {
        const words = cs.words.filter((w) => !/^(?:-i|--interactive)$/.test(w));
        const out = git(cwd || root, ['clean', '-n', ...words]);
        if (out !== null) {
          const n = out.split('\n').filter((l) => l.startsWith('Would remove')).length;
          return n ? t('danger.discard', { count: n }) : null;
        }
      }
    }
    const args = ['status', '--porcelain', `--untracked-files=${clean ? 'normal' : 'no'}`, ...(ignored ? ['--ignored'] : [])];
    const dirty = (git(root, args) || '').split('\n').filter((l) => l.trim() && (!onlyIgnored || l.startsWith('!!')));
    return dirty.length ? t('danger.discard', { count: dirty.length }) : null;
  },
};

// 명령줄에 그대로 적은 비밀번호. 값이 $변수·$(…)·`…`·(…)·[…]·파일 읽기 명령이면 둔다(값이 명령줄에 안 남는다).
const NOT_VAR = String.raw`(?!["']?[$\x60(\[])(?!(?:Get-Content|gc|Get-Secret|Read-Host|cat|type)\b)`;
const NOT_SWITCH = String.raw`(?!["']?(?:yes|no|true|false|on|off|[01])["']?(?:[\s;|&)]|$))`;
const PASSWORD_ON_CLI = [
  // --password=값 · --password 값 (--password-stdin·--password-file 은 둔다)
  new RegExp(String.raw`--password(?:=|\s+)(?!-)${NOT_VAR}\S+`, 'i'),
  // mysql 계열의 -p값(붙여 씀). -P 는 포트라 대소문자를 가린다.
  new RegExp(String.raw`\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^|;&\n]*\s-p(?!\s|$)${NOT_VAR}\S+`),
  // mongo·mongosh 의 -p 값(띄어 씀도 비밀번호)
  new RegExp(String.raw`\bmongo(?:sh|dump|restore|import|export)?\b[^|;&\n]*\s-p(?:\s+(?!-)|(?!\s|$))${NOT_VAR}\S+`),
  new RegExp(String.raw`\bsshpass\s+-p\s*${NOT_VAR}\S+`, 'i'),
  // docker·podman login -p 값
  new RegExp(String.raw`\b(?:docker|podman)\s+login\b[^|;&\n]*\s-p(?:\s+(?!-)|(?!\s|$))${NOT_VAR}\S+`),
  // curl -u 아이디:비번 · --user 아이디:비번
  new RegExp(String.raw`\bcurl\b[^|;&\n]*\s(?:-u|--user)(?:\s+|=|(?=[^\s-]))["']?[^\s:"'$]+:${NOT_VAR}[^\s"']+`),
  // 비밀번호 환경 변수에 값 넣기: PGPASSWORD=값, MYSQL_PWD=값, POSTGRES_PASSWORD=값(-e 포함), $env:PGPASSWORD = "값"
  // (PowerShell 환경 변수 이름은 대소문자를 가리지 않는다: $env:db_password)
  // 켜고 끄는 값(MYSQL_ALLOW_EMPTY_PASSWORD=yes · MYSQL_RANDOM_ROOT_PASSWORD=1)은 비밀번호가 아니다.
  new RegExp(String.raw`(?:\b|\$env:)(?:PGPASSWORD|MYSQL_PWD|(?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD))\s*=\s*${NOT_VAR}${NOT_SWITCH}["']?[^\s"'$]`),
  new RegExp(String.raw`\$env:(?:\w*_)?(?:password|passwd|pgpassword|mysql_pwd)\s*=\s*${NOT_VAR}${NOT_SWITCH}["']?[^\s"'$]`, 'i'),
  // 주소 속 비밀번호: postgres://아이디:비번@, redis://:비번@, https://user:token@
  // 시작은 스킴 글자가 이어지는 첫 자리에서만(\b 는 a.a.a… 의 점마다 다시 시작해 길이의 제곱 — 100KB 에 11초, 검토 2026-11-13)
  // 이 PC 주소(localhost·127.*·[::1])와 compose 서비스의 개발 기본값(postgres:postgres@db)은 둔다 — 비밀값 훅과 같은 기준(lib/secrets.mjs devUrlLogin)
  (view) => [...view.matchAll(URL_LOGIN)].some((m) => !devUrlLogin(m[1], m[2], m[3])),
];
const URL_LOGIN = new RegExp(String.raw`(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*://([^\s:/@"'$]*):(${NOT_VAR}[^\s@/"'$]+)@(\[[^\]\s]{0,64}\]|[^\s/:?#"'$@\[]{0,253})`, 'gi');
export const passwordCli = {
  id: 'password-cli',
  on: 'shell',
  check({ cmd, shell, t }) {
    const view = dataMasked(cmd, shell);
    return PASSWORD_ON_CLI.some((re) => (typeof re === 'function' ? re(view) : re.test(view))) ? t('password.cli') : null;
  },
};

export default [dangerCmd, dbWipe, discardChanges, passwordCli, ...protectedRules, blockCmd, askCmd];
