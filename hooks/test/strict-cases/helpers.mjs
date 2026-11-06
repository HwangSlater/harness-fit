// 엄격 시험 사례를 적는 도우미. 사례 하나 = 훅 입력 하나 + 기대(막음/통과)는 사례 목록의 자리(block/pass)로 정한다.
//   S(명령): Bash·PowerShell 둘 다에서 같은 글로, B(명령): Bash 에서만, P(명령): PowerShell 에서만
//   W(파일, 내용): Write, E(파일, 옛 글, 새 글): Edit, N(파일, 새 칸): NotebookEdit, F(주소): WebFetch
//   extra.setup(r): 그 사례만 쓰는 새 저장소를 준비한다(r.put·r.git·r.commit). extra.opts: 그 사례만 쓰는 훅 옵션.
// 비밀값·위험한 코드처럼 생긴 글은 이어 붙여 만든다(이 파일을 쓸 때 전역 훅·harness-fit 훅이 막지 않게).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launcherText } from '../../lib/git-hook.mjs';

export const S =(cmd, why, extra = {}) => ({ shells: ['Bash', 'PowerShell'], cmd, why, ...extra });
export const B = (cmd, why, extra = {}) => ({ shells: ['Bash'], cmd, why, ...extra });
export const P = (cmd, why, extra = {}) => ({ shells: ['PowerShell'], cmd, why, ...extra });
export const W = (file, content, why, extra = {}) => ({ tool: 'Write', file, content, why, ...extra });
export const E = (file, old_string, new_string, why, extra = {}) => ({ tool: 'Edit', file, old_string, new_string, why, ...extra });
export const N = (file, new_source, why, extra = {}) => ({ tool: 'NotebookEdit', file, new_source, why, ...extra });
export const F = (url, why) => ({ tool: 'WebFetch', url, why });

// 비밀값 모양(시험용 가짜)
export const FAKE = {
  github: 'gh' + 'p_' + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVc',
  aws: 'AK' + 'IA' + 'IOSFODNN7EXAMPL1',
  openai: 'sk' + '-proj-' + 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78',
  privateKey: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  slack: 'xo' + 'xb-' + '1234567890-abcdefghij',
  google: 'AI' + 'za' + 'SyB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R',
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abcdefghijklmnop',
  stripe: 's' + 'k_live_' + 'Ab12Cd34Ef56Gh78Ij90Kl12',
  password: 'hunter2' + '-correct-horse',
};
export const assign = (name, value) => `${name} = "${value}"`;

// 줄 n 개짜리 코드
export const linesOf = (n, line = 'export const v = 1;') => Array.from({ length: n }, (_, i) => `${line} // ${i}`).join('\n') + '\n';

// 자주 쓰는 저장소 준비. key 가 같은 준비는 한 번만 만들고 복사해 쓴다(시험 시간을 줄이려고).
export const keyed = (key, fn) => Object.assign(fn, { key });
export const stage = (file, text) =>
  keyed(`stage\0${file}\0${text}`, (r) => {
    r.put(file, text);
    r.git('add', file);
  });
export const onBranch = (name) => keyed(`branch\0${name}`, (r) => r.git('switch', '-q', '-c', name));
export const both = (...fns) => (r) => fns.forEach((f) => f(r));

// 적용이 넣는 git pre-commit 훅(실행기). recorded: 실행기가 찾을 플러그인 경로(없는 곳이면 「플러그인을 못 찾음」)
export const PLUGIN = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const gitHook = (recorded = PLUGIN) =>
  keyed(`githook\0${recorded}`, (r) => {
    r.put('.git/hooks/pre-commit', launcherText(recorded));
    fs.chmodSync(path.join(r.dir, '.git', 'hooks', 'pre-commit'), 0o755);
  });

// 도구 호출이 아닌 때의 사례(hooks/stop.mjs · session-start.mjs · prompt-submit.mjs 로 돈다)
//   ST(기록, 왜): Stop. 기록 = 대화 기록 줄 배열, 또는 (r) => 배열(저장소 준비 뒤에 만든다 — 커밋 해시를 넣으려고)
//   SS(왜): SessionStart, UP(왜, { checklist }): UserPromptSubmit. 둘 다 extra.expect 글이 보이면 「막음」(보여 줌)으로 친다.
//   extra.input: 훅 입력에 더할 칸(stop_hook_active 등), extra.noSession: session_id 를 빼고 넣는다.
export const ST = (transcript, why, extra = {}) => ({ event: 'Stop', transcript, why, ...extra });
export const SS = (why, extra = {}) => ({ event: 'SessionStart', why, ...extra });
export const UP = (why, extra = {}) => ({ event: 'UserPromptSubmit', why, ...extra });

// 대화 기록 줄 만들기. at = 지금 기준 몇 초 앞뒤(기록을 만드는 때 기준)
let toolSeq = 0;
const iso = (at) => new Date(Date.now() + at * 1000).toISOString();
const assistant = (content, at) => ({ type: 'assistant', message: { role: 'assistant', content }, timestamp: iso(at) });
export const rec = {
  prompt: (text, at = -600) => ({ type: 'user', message: { role: 'user', content: text }, timestamp: iso(at) }),
  shell: (command, at = -300, name = 'Bash') => assistant([{ type: 'tool_use', id: `toolu_${++toolSeq}`, name, input: { command } }], at),
  result: (text, at = -299) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${toolSeq}`, content: text }] }, timestamp: iso(at) }),
  say: (text, at = 5) => assistant([{ type: 'text', text }], at),
  feedback: (text, at = 6) => ({ type: 'user', isMeta: true, message: { role: 'user', content: `Stop hook feedback:\n${text}` }, timestamp: iso(at) }),
  notice: (text, at = 7) => ({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: text }, timestamp: iso(at) }),
};
// 사람 메시지 → 셸 명령 하나 → 답(가장 흔한 턴)
export const turnSaying = (answer, { prompt = '바꾼 것을 커밋해 주세요', command = 'git commit -m "feat: 바꿈"', tool = 'Bash' } = {}) =>
  [rec.prompt(prompt), rec.shell(command, -300, tool), rec.result('1 file changed'), rec.say(answer)];
