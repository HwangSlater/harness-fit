// 답을 끝낼 때·세션 시작·메시지 보낼 때 도는 훅의 엄격 사례: commit-hash · answer-lang · docs-check · work-checklist · stale-scratch.
// 대화 기록(transcript)은 저장소를 준비한 뒤 만든다(커밋 해시를 넣으려고 — (r) => 기록).
import { W, E, ST, SS, UP, rec, turnSaying } from './helpers.mjs';

const head = (r) => r.git('rev-parse', 'HEAD');
const short = (r, n = 7) => head(r).slice(0, n);
// 커밋 하나(사람 메시지 뒤에 만든 것으로 친다 — 기록의 사람 메시지는 10분 전)
const oneCommit = (r) => r.commit('src/a.js', 'export const a = 2;\n', 'feat: 바꿈');
const twoCommits = (r) => {
  r.commit('src/a.js', 'export const a = 2;\n', 'feat: 하나');
  r.commit('src/b.js', 'export const b = 2;\n', 'feat: 둘');
};

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const doc = (title = '# 가이드', date = today()) => `${title}\n\n> 최종 수정: ${date} · 쓰는 법\n\n본문\n`;
const index = (...links) => `# 문서\n\n> 최종 수정: ${today()} · 목차\n\n${links.map((l) => `- [${l}](${l}) — 설명`).join('\n')}\n`;
// 문서 준비: 목차와 문서들을 커밋하지 않은 새 파일로 둔다
const docs = (files) => (r) => {
  for (const [f, text] of Object.entries(files)) r.put(f, typeof text === 'function' ? text() : text);
};
// stale-scratch: 사례마다 따로 둔 임시 폴더의 claude/ 아래에 만들 것(P = 프로젝트 지문 폴더, <session> = 이 사례의 세션)
const P = '0123456789abcdef';
const STALE = 'Work folders left';
const scratch = (entries) => ({ scratch: entries, expect: STALE });
const sayDone =(r) => [rec.prompt('문서를 써 주세요'), rec.say('문서를 고쳤어요.')];
const EN = 'I updated the config file and all the tests pass now. Let me know if you want anything else changed.';
const KO = '설정 파일을 고쳤고 테스트가 모두 통과했어요. 더 바꿀 것이 있으면 알려 주세요.';

export default {
  'commit-hash': {
    block: [
      ST(() => turnSaying('커밋했어요. 바꾼 파일은 src/a.js 하나예요.'), '커밋했는데 해시가 없음', { setup: oneCommit }),
      ST((r) => turnSaying(`첫 커밋은 ${r.git('rev-parse', '--short', 'HEAD~1')} 이에요.`), '커밋 둘 중 하나만 알림', { setup: twoCommits }),
      ST(() => turnSaying('커밋했어요.', { tool: 'PowerShell' }), 'PowerShell 로 커밋', { setup: oneCommit }),
      ST(() => [rec.prompt('커밋해 주세요'), rec.say('예전 커밋 abcdef1 위에 올릴게요.', -400), rec.shell('git commit -m "feat: 바꿈"'), rec.result('ok'), rec.say('커밋했어요.')], '커밋 전에 쓴 다른 해시는 셈하지 않음', { setup: oneCommit }),
      ST((r) => {
        const old = r.git('rev-parse', '--short', 'HEAD');
        r.git('commit', '-q', '--amend', '-m', 'feat: 고친 메시지');
        return turnSaying(`커밋했어요: ${old}`);
      }, 'amend 로 바뀐 커밋 — 옛 해시만 알림', { setup: oneCommit }),
      ST(() => turnSaying('커밋했어요. 해시는 deadbeef 처럼 생겼어요.'), '다른 해시만 있음', { setup: oneCommit }),
    ],
    pass: [
      ST((r) => turnSaying(`커밋했어요: ${short(r)} (되돌리기: git revert ${short(r)})`), '짧은 해시', { setup: oneCommit }),
      ST((r) => turnSaying(`커밋 ${short(r, 12)} 을 만들었어요.`), '더 긴 해시', { setup: oneCommit }),
      ST((r) => [rec.prompt('커밋해 주세요'), rec.shell('git commit -m "feat: 바꿈"', -300), rec.result('ok'), rec.say(`커밋했어요: ${short(r)}`, 2), rec.shell('npm test', 3), rec.result('ok', 4), rec.say('시험도 통과했어요.', 5)], '앞 답에 이미 알림', { setup: oneCommit }),
      ST((r) => turnSaying(`${r.git('rev-parse', '--short', 'HEAD~1')}, ${short(r)} 두 커밋이에요.`), '커밋 둘 다 알림', { setup: twoCommits }),
      ST(() => [rec.prompt('설명해 주세요'), rec.say('설명했어요.')], '셸 명령을 안 쓴 턴(사용자가 터미널에서 커밋)', { setup: oneCommit }),
      ST(() => [rec.prompt('이어서 해 주세요', 30), rec.shell('git status', 40), rec.result('clean', 41), rec.say('바뀐 것이 없어요.', 50)], '사람 메시지 전에 만든 커밋', { setup: oneCommit }),
      ST(() => [...turnSaying('커밋했어요.'), rec.feedback('[harness-fit · commit-hash] 커밋을 했는데 답에 해시가 없어요'), rec.say('알겠어요.', 8)], '이번 사람 턴에 이미 물음', { setup: oneCommit }),
      ST(() => turnSaying('커밋했어요.'), '이미 한 번 막아서 다시 도는 중', { setup: oneCommit, input: { stop_hook_active: true } }),
      ST(() => turnSaying('바꾼 것이 없어요.', { command: 'git status' }), '커밋이 없는 턴'),
      ST((r) => {
        r.git('commit', '-q', '--amend', '-m', 'feat: 고친 메시지');
        return turnSaying(`커밋했어요: ${short(r)}`);
      }, 'amend 한 새 커밋만 알림(버린 옛 커밋은 빼요)', { setup: oneCommit }),
    ],
  },
  'answer-lang': {
    block: [
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say(EN)], '영어 답'),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say('살펴볼게요.', -100), rec.shell('ls', -90), rec.result('a', -89), rec.say(EN)], '중간 안내는 한국어, 마지막 답은 영어'),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say(`${EN} 끝.`)], '한글 한 낱말 섞인 영어 답'),
      ST([rec.prompt('Fix the config'), rec.say(KO)], '영어를 고른 프로젝트에 한국어 답', { opts: { lang: 'en' } }),
      ST([rec.prompt('設定を直して'), rec.say(EN)], '일본어를 고른 프로젝트에 영어 답', { opts: { lang: 'ja' } }),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say('設定ファイルを直しました。テストもすべて通りました。ほかに変えたいところがあれば教えてください。')], '한국어 프로젝트에 일본어 답'),
    ],
    pass: [
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say(KO)], '한국어 답'),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say(`고쳤어요.\n\`\`\`js\n// update the config and run all the tests now\nconst x = 1;\n\`\`\``)], '코드 블록 속 영어'),
      ST([rec.prompt('비교해 주세요'), rec.say('참고한 곳: Toss · Duolingo · Samsung Health · Google Fit · Apple Health · Strava')], '이름 나열'),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say('Let me check the config file first and then run the tests.', -100), rec.shell('ls', -90), rec.result('a', -89), rec.say(KO)], '영어 중간 안내, 마지막 답은 한국어'),
      ST([rec.prompt('Fix the config'), rec.say(EN)], '영어를 고른 프로젝트에 영어 답', { opts: { lang: 'en' } }),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say('OK')], '아주 짧은 답'),
      ST([rec.prompt('설정을 고쳐 주세요'), rec.say(EN)], '이미 한 번 막아서 다시 도는 중', { input: { stop_hook_active: true } }),
      ST([rec.prompt('경로 알려 주세요'), rec.say('파일은 `C:\\Users\\me\\project\\config\\settings.json` 와 https://example.com/docs/getting-started 에 있어요.')], '경로·주소'),
    ],
  },
  'docs-check': {
    block: [
      W('docs/notes.txt', '메모\n', 'docs/ 에 .txt'),
      W('docs/keys/server.pem', 'x\n', 'docs/ 에 키 파일'),
      E('docs/data.json', '{}', '{"a":1}', 'docs/ 의 JSON 고치기', { setup: (r) => r.put('docs/data.json', '{}\n') }),
      ST(sayDone, '제목 없음', { setup: docs({ 'docs/README.md': index('guide.md'), 'docs/guide.md': '가이드\n' }) }),
      ST(sayDone, '날짜 줄 없음', { setup: docs({ 'docs/README.md': index('guide.md'), 'docs/guide.md': '# 가이드\n\n본문\n' }) }),
      ST(sayDone, '날짜가 고친 날이 아님', { setup: docs({ 'docs/README.md': index('guide.md'), 'docs/guide.md': doc('# 가이드', '2020-01-01') }) }),
      ST(sayDone, '목차에 없음', { setup: docs({ 'docs/README.md': index(), 'docs/guide.md': doc }) }),
      ST(sayDone, '목차가 없음', { setup: docs({ 'docs/guide.md': doc }) }),
      ST(sayDone, '목차가 없는 문서를 가리킴', { setup: docs({ 'docs/README.md': index('gone.md') }) }),
      ST(sayDone, '셸로 쓴 .md 아닌 파일', { setup: docs({ 'docs/README.md': index(), 'docs/dump.json': '{}\n' }) }),
      ST(() => [rec.prompt('문서를 써 주세요'), rec.say('썼어요.')], '이번 턴에 커밋한 문서(제목 없음)', {
        setup: (r) => {
          r.commit('docs/README.md', index('guide.md'), 'docs: 목차');
          r.commit('docs/guide.md', '가이드\n', 'docs: 가이드');
        },
      }),
      ST(sayDone, '지운 문서가 목차에 남음', {
        setup: (r) => {
          r.commit('docs/README.md', index('old.md'), 'docs: 목차');
          r.commit('docs/old.md', doc('# 옛 문서'), 'docs: 옛 문서');
          r.git('rm', '-q', 'docs/old.md');
        },
      }),
    ],
    pass: [
      W('docs/guide.md', doc(), 'docs/ 에 .md'),
      W('docs/images/flow.png', 'x', 'docs/ 에 그림'),
      W('src/notes.txt', '메모\n', 'docs/ 밖'),
      ST(sayDone, '형식이 맞는 문서', { setup: docs({ 'docs/README.md': index('guide.md'), 'docs/guide.md': doc }) }),
      ST(sayDone, '하위 폴더 문서', { setup: docs({ 'docs/README.md': index('team/guide.md'), 'docs/team/guide.md': doc }) }),
      ST(sayDone, 'docs/ 변경 없음'),
      ST(sayDone, '그림만 새로', { setup: docs({ 'docs/flow.svg': '<svg/>\n' }) }),
      ST(sayDone, '날짜 줄 검사를 끔', { opts: { dateLine: false }, setup: docs({ 'docs/README.md': '# 문서\n\n- [가이드](guide.md)\n', 'docs/guide.md': '# 가이드\n\n본문\n' }) }),
      ST(() => [rec.prompt('이어서 해 주세요', 30), rec.say('다른 일을 했어요.', 40)], '사람 메시지 전에 커밋한 옛 문서(고치지 않음)', {
        setup: (r) => r.commit('docs/old.md', '옛 문서\n', 'docs: 옛 문서'),
      }),
      ST(sayDone, '문서를 지우고 목차에서도 뺌', {
        setup: (r) => {
          r.commit('docs/README.md', index('old.md'), 'docs: 목차');
          r.commit('docs/old.md', doc('# 옛 문서'), 'docs: 옛 문서');
          r.git('rm', '-q', 'docs/old.md');
          r.put('docs/README.md', index());
        },
      }),
      ST(sayDone, '이미 한 번 막아서 다시 도는 중', { input: { stop_hook_active: true }, setup: docs({ 'docs/guide.md': '가이드\n' }) }),
    ],
  },
  'work-checklist': {
    block: [
      SS('세션 시작: 체크리스트 경로를 알려 줌', { expect: 'harness-fit' }),
      UP('남은 항목 하나', { checklist: '- [ ] 남은 일 하나\n- [x] 끝난 일\n', expect: '남은 일 하나' }),
      UP('* 로 쓴 항목', { checklist: '* [ ] 별표 항목\n', expect: '별표 항목' }),
      UP('들여 쓴 항목', { checklist: '- [x] 큰 일\n  - [ ] 들여 쓴 항목\n', expect: '들여 쓴 항목' }),
      UP('6개 넘으면 5개까지와 남은 수', { checklist: [1, 2, 3, 4, 5, 6, 7].map((n) => `- [ ] 할 일 ${n}`).join('\n'), expect: 'and 2 more' }),
    ],
    pass: [
      SS('session_id 가 없으면 알리지 않음', { expect: 'harness-fit', noSession: true }),
      UP('체크리스트 파일이 없음', { expect: '체크리스트' }),
      UP('다 끝난 항목만', { checklist: '- [x] 끝난 일\n- [X] 대문자 X\n', expect: '끝난 일' }),
      UP('항목 글이 비었음', { checklist: '- [ ]\n- [ ]   \n', expect: '남은 항목' }),
      UP('다른 세션의 파일', { checklist: '- [ ] 남의 일\n', expect: '남의 일', otherSession: true }),
      UP('[ ] 가 항목 줄 가운데', { checklist: '설명에 - [ ] 라고 적음\n', expect: '라고 적음' }),
    ],
  },
  'stale-scratch': {
    block: [
      SS('지난 세션 scratchpad 의 venv', scratch([{ dir: `${P}/old1/scratchpad/venv`, files: ['pyvenv.cfg'], days: 5 }])),
      SS('지난 세션의 node_modules', scratch([{ dir: `${P}/old1/scratchpad/app/node_modules`, days: 5 }])),
      SS('지난 세션의 브라우저 프로필', scratch([{ dir: `${P}/old1/scratchpad/profile`, files: ['Local State'], days: 5 }])),
      SS('한 폴더에 캡처 그림 500장', scratch([{ dir: `${P}/old1/scratchpad/frames`, images: 500, days: 5 }])),
      SS('무거운 것 없이 지난 폴더 21개', scratch(Array.from({ length: 21 }, (_, k) => ({ dir: `${P}/s${k}/scratchpad`, days: 5 })))),
      SS('지문 폴더가 아닌 바로 아래 폴더의 venv', scratch([{ dir: 'my-test/venv', files: ['pyvenv.cfg'], days: 5 }])),
    ],
    pass: [
      SS('작업 폴더 자리가 없음', { expect: STALE }),
      SS('venv 가 있지만 1일 전', scratch([{ dir: `${P}/old1/scratchpad/venv`, files: ['pyvenv.cfg'], days: 1 }])),
      SS('지금 세션 폴더의 오래된 venv', scratch([{ dir: `${P}/<session>/scratchpad/venv`, files: ['pyvenv.cfg'], days: 5 }])),
      SS('무거운 것 없이 지난 폴더 20개', scratch(Array.from({ length: 20 }, (_, k) => ({ dir: `${P}/s${k}/scratchpad`, days: 5 })))),
      SS('깊이 3의 venv 는 보지 않음', scratch([{ dir: `${P}/old1/scratchpad/a/b/venv`, files: ['pyvenv.cfg'], days: 5 }])),
      SS('그림 499장', scratch([{ dir: `${P}/old1/scratchpad/frames`, images: 499, days: 5 }])),
      SS('세션 폴더는 오래됐지만 scratchpad 를 오늘 고침', scratch([{ dir: `${P}/old1/scratchpad/venv`, files: ['pyvenv.cfg'], days: 5 }, { dir: `${P}/old1/scratchpad`, days: 0 }])),
    ],
  },
};
