// git pre-commit 훅 본체. 적용할 때 .git/hooks/pre-commit 에 넣는 실행기(lib/git-hook.mjs launcherText)가 이 파일을 불러온다.
// 프로젝트 .claude/harness.json 에서 켠 쓰기 훅(비밀값·.env 같은 파일·위험한 HTML·버전 범위·워크플로·큰 새 파일)으로
// 지금 커밋에 실제로 들어가는 내용(색인)의 더한 줄·파일을 본다. 문구와 찾는 함수는 쓰기 검사·PreToolUse 커밋 검사와 같다.
// 결과: 막을 것이 있으면 이유를 stderr 에 쓰고 1, 아니면 0. 무슨 오류든 한 줄 알리고 0(검사 오류로 커밋을 막지 않는다).
import { loadConfig, pickLang, translator, repoRoot } from './lib/core.mjs';
import { COMMIT_HOOK_IDS } from './lib/git-hook.mjs';

const say = (text) => process.stderr.write(`${text}\n`);

const main = async () => {
  const root = repoRoot(process.cwd());
  if (!root) return 0;
  const cfg = loadConfig(root);
  if (!cfg) return 0;
  const t = translator(pickLang(cfg.lang));
  if (cfg.broken) {
    say(t('config.broken', { file: cfg.broken }));
    return 0;
  }
  const ids = COMMIT_HOOK_IDS.filter((id) => cfg.rules[id]);
  if (!ids.length) return 0;
  const [{ stagedPlan }, { INSPECT, claudeEnv }, { allowReport, allowNotice }, { runRules }] = await Promise.all([
    import('./lib/staged.mjs'),
    import('./rules/commit.mjs'),
    import('./lib/allow.mjs'),
    import('./lib/dispatch.mjs'),
  ]);
  const plan = stagedPlan(root);
  if (!plan) return 0;
  const crashed = [];
  const allows = allowReport();
  // 검사 하나가 터져도 나머지는 본다(막지는 않는다). 대신 그 검사 없이 커밋된다고 알린다.
  const rules = ids.map((id) => ({ id, check: INSPECT[id] }));
  const found = new Set(runRules(rules, cfg, (rule, opts) => rule.check(plan, { opts, t, root, allows, claude: claudeEnv(process.env.CLAUDECODE) }), { errors: crashed, allows, t }));
  if (crashed.length) say(`harness-fit: ${t('gitHook.ruleCrashed', { ids: crashed.join(', ') })}`);
  if (!found.size) {
    // 허용 주석으로 넘긴 줄은 커밋을 막지 않되 하나하나 알린다
    const used = allowNotice(allows, t);
    if (used) say(used);
    return 0;
  }
  say(`harness-fit: ${t('commit.prefix')}`);
  for (const msg of found) say(`- ${msg}`);
  say(t('gitHook.howToFix'));
  return 1;
};

try {
  process.exitCode = await main();
} catch {
  try {
    say(`harness-fit: ${translator(pickLang())('gitHook.error')}`);
  } catch {}
  process.exitCode = 0;
}
