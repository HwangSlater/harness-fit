// 검토 규칙: PR·MR 을 Claude 가 스스로 병합·승인하지 않기(self-merge, 막음), 저장소 보호 설정 바꾸기는 묻기(protect-rules, 물음),
// push·PR·MR 올리기 전에 묻기(ask-publish, 물음 — 맨 아래).
// 실제로 있었던 일(2026-11-21, GitLab 팀 저장소): Claude 가 MR !1~!5 를 같은 계정으로 열고 REST API 로 병합했다 — 팀원 검토 0번.
// gh pr merge 만 보던 pr-merge 는 병합 자체를 막지 않았고 GitLab(glab·REST·GraphQL·push 옵션)은 아예 보지 않았다.
// 보는 길: gh·glab 명령, gh api·glab api, HTTP 도구(curl·wget·httpie·Invoke-RestMethod·Invoke-WebRequest), git push -o,
// 그리고 보호 브랜치로 바로 올리는 git push(로컬에서 합치고 올리면 병합과 같다 — 독립 검토 2026-11-23).
// 따옴표 속·heredoc·주석의 글(커밋 메시지·문서)은 명령 낱말이 아니라 보지 않는다 — GraphQL 본문만 그 호출의 글에서 본다.
// 못 보는 것: 스크립트 파일 안의 호출(node merge.mjs·python -c), 본문을 파일로 주는 호출(--input x.json·-F query=@q.graphql),
// git -c push.pushOption=…, 백틱 속 명령, 웹 화면의 병합 버튼 — 서버 설정(보호 브랜치·승인 규칙)이 막아야 한다.
import { commandSegments } from '../lib/cmdline.mjs';
import { heredocs, scanQuotes } from '../lib/quotes.mjs';
import { runWords } from '../lib/run-prefix.mjs';
import { gitSegments, repoState } from '../lib/core.mjs';
import { timelineOf } from '../lib/branches.mjs';
import { findRepo, refExists } from '../lib/repo-files.mjs';
import { parsePush } from './git.mjs';
import { flowNames } from './flow.mjs';
import { prWordOf } from '../lib/forge.mjs';

// ── 병합·승인으로 가는 곳(앞부분은 무엇이든 — 변수로 만든 주소 "$API/projects/$ID/…" 도) ──
// GitHub REST: PUT …/pulls/{n}/merge, 리뷰 승인 POST …/pulls/{n}/reviews(event=APPROVE), PR 없는 병합 POST …/merges
const SEG = String.raw`[^/\s?#]+`;
const END = String.raw`\/?(?:[?#]|$)`;
const GH_MERGE_PATH = new RegExp(String.raw`(?:^|\/)pulls\/${SEG}\/merge${END}`, 'i');
const GH_REVIEW_PATH = new RegExp(String.raw`(?:^|\/)pulls\/${SEG}\/reviews${END}`, 'i');
const GH_MERGES_PATH = new RegExp(String.raw`(?:^|\/)repos\/(?:${SEG}\/${SEG}|\$\{?\w+\}?)\/merges${END}`, 'i');
// GitLab REST: PUT …/merge_requests/{iid}/merge, POST …/approve, 옛 자동 병합 …/merge_when_pipeline_succeeds, 병합 열차 …/merge_trains/merge_requests/{iid}
const GL_MERGE_PATH = new RegExp(String.raw`(?:^|\/)(?:merge_requests\/${SEG}\/(?:merge|approve|merge_when_pipeline_succeeds)|merge_trains\/merge_requests\/${SEG})${END}`, 'i');
// GraphQL 변경(mutation) 이름
const MERGE_MUTATION = /\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeRequestAccept|mergeRequestSetAutoMerge|mergeRequestApprove)\b/;
const APPROVE_REVIEW = /\b(?:addPullRequestReview|submitPullRequestReview)\b[\s\S]*\bAPPROVE\b/;
// git push -o 로 MR 을 열면서 자동 병합 예약
const PUSH_AUTO_MERGE = /^merge_request\.(?:merge_when_pipeline_succeeds|auto_merge)(?:=|$)/i;

// ── 보호 설정 ──
// GitHub: 브랜치 보호(…/branches/{b}/protection 과 그 아래), 규칙 묶음(rulesets). 자동 병합·병합 방식 같은 저장소 일반 설정은 보지 않는다
const GH_PROTECT_PATH = new RegExp(String.raw`(?:^|\/)(?:branches\/[^\s?#]+\/protection|rulesets)(?:\/|[?#]|$)`, 'i');
// GitLab: 보호 브랜치·태그, 승인 규칙·승인 설정(프로젝트·MR 하나), 푸시 규칙
const GL_PROTECT_PATH = /(?:^|\/)(?:protected_branches|protected_tags|approval_rules|approvals|merge_request_approval_settings?|push_rule)(?:\/|[?#]|$)/i;

// 주소 낱말 → API 경로: 앞의 변수($API·${CI_API_V4_URL}), scheme·호스트(없어도 — gitlab.com/api/v4/…), /api/v3·/api/v4 를 뗀다
const pathOf = (u) =>
  u
    .replace(/^["']|["']$/g, '')
    .replace(/^(?:\$\{?\w+\}?)+\/?/, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?=\/)/, '')
    .replace(/^\/?api\/(?:v\d+\/)?/i, '')
    .replace(/^\//, '');
// 주소로 볼 낱말: / 가 있는 것(옵션 값은 미리 건너뛴다)
const looksPath = (w) => /\//.test(w) && !w.startsWith('-') && !/^@/.test(w);

// gh api · glab api 낱말(api 다음부터) → { method, path, fields }
// 방법을 적지 않으면 GET, 다만 -f·-F·--field·--raw-field·--input 이 있으면 POST(두 CLI 의 설명과 같다). 방법은 대소문자 상관없이
const API_VALUE = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview', '-R', '--repo']);
const parseApi = (w) => {
  let method = null;
  let pathArg = null;
  let data = false;
  let stdin = false;
  const fields = [];
  for (let i = 0; i < w.length; i++) {
    const a = w[i];
    const eq = a.indexOf('=');
    const [flag, inline] = a.startsWith('--') && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, null];
    if (API_VALUE.has(flag)) {
      const v = inline ?? w[++i] ?? '';
      if (flag === '-X' || flag === '--method') method = v.toUpperCase();
      if (['-f', '--raw-field', '-F', '--field'].includes(flag)) (data = true), fields.push(v);
      if (flag === '--input') (data = true), (stdin = stdin || v === '-');
    } else if (/^-X[A-Za-z]+$/.test(a)) method = a.slice(2).toUpperCase();
    else if (!a.startsWith('-') && pathArg === null) pathArg = a;
  }
  return { method: method || (data ? 'POST' : 'GET'), path: pathArg ? pathOf(pathArg) : '', fields, stdin };
};

// HTTP 도구 낱말 → { method, urls, stdin }
// curl: -X/--request(-XPUT·-sXPUT 묶음도), 몸(-d·--data*·--json·-F·--form·-T)이 있으면 POST, -G·--get 이면 GET, -I·--head 면 HEAD.
//   값을 받는 옵션(-H·-o·-u·-e·-x·-A·-b·-c·-w 등)의 값은 주소가 아니다. 옵션이 아닌 낱말 가운데 / 가 있는 것이 주소.
// wget: --method, --post-data·--post-file 이면 POST. httpie(http·https·xh): 옵션이 아닌 첫 낱말이 대문자 방법이면 그것, 몸 항목(a=b·a:=b)이 있으면 POST.
// PowerShell Invoke-RestMethod·Invoke-WebRequest(irm·iwr, PowerShell 5.1 의 curl·wget 별칭): -Method, 없으면 GET.
const HTTP_PROGS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-restmethod', 'invoke-webrequest', 'irm', 'iwr']);
const CURL_DATA = /^(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|--json|-F|--form(?:-string)?|-T|--upload-file)$/;
const CURL_VALUE = /^(?:-[HoOuexAbcwrEKCmYyzQ]|--(?:header|output|user|referer|proxy|user-agent|cookie|cookie-jar|write-out|range|cert|config|max-time|connect-timeout|resolve|cacert|key|retry|max-redirs|limit-rate|interface|dns-servers|proto|oauth2-bearer))$/;
const parseCurl = (w) => {
  let method = null;
  let data = false;
  let get = false;
  let stdin = false;
  const urls = [];
  for (let i = 0; i < w.length; i++) {
    const a = w[i];
    if (a === '-X' || a === '--request') method = (w[++i] || '').toUpperCase();
    else if (/^--request=/.test(a)) method = a.slice(10).toUpperCase();
    else if (a === '-G' || a === '--get') get = true;
    else if (a === '-I' || a === '--head') method = method || 'HEAD';
    else if (CURL_DATA.test(a)) (data = true), (stdin = stdin || /^@-$/.test(w[i + 1] || '')), i++;
    else if (/^--(?:data(?:-raw|-binary|-urlencode|-ascii)?|json|form)=/.test(a)) (data = true), (stdin = stdin || /=@-$/.test(a));
    else if (a === '--url') urls.push(w[++i] || '');
    else if (CURL_VALUE.test(a)) i++;
    else if (/^-[A-Za-z]+$/.test(a) && a.includes('X')) {
      // 짧은 옵션 묶음 속 X(-sXPUT·-sSfX PUT): X 뒤 글자가 방법, 없으면 다음 낱말
      const rest = a.slice(a.indexOf('X') + 1);
      method = (rest || w[++i] || '').toUpperCase();
    } else if (/^-d./.test(a) && !a.startsWith('--')) data = true;
    else if (!a.startsWith('-') && looksPath(a)) urls.push(a);
  }
  return { method: method || (get ? 'GET' : data ? 'POST' : 'GET'), urls, stdin };
};
const parseOther = (prog, w) => {
  let method = null;
  let data = false;
  const urls = [];
  const invoke = prog.startsWith('invoke-') || prog === 'irm' || prog === 'iwr' || w.some((a) => /^-(?:method|uri)(?::|$)/i.test(a));
  for (let i = 0; i < w.length; i++) {
    const a = w[i];
    if (invoke) {
      if (/^-method$/i.test(a)) method = (w[++i] || '').toUpperCase();
      else if (/^-method:/i.test(a)) method = a.slice(8).toUpperCase();
      else if (/^-uri$/i.test(a)) urls.push(w[++i] || '');
      else if (/^-(?:headers?|body|outfile|contenttype|credential|websession|sessionvariable|infile|token|authentication)$/i.test(a)) i++;
      else if (!a.startsWith('-') && looksPath(a)) urls.push(a);
      continue;
    }
    if (prog === 'wget') {
      if (/^--method=/.test(a)) method = a.slice(9).toUpperCase();
      else if (a === '--method') method = (w[++i] || '').toUpperCase();
      else if (/^--post-(?:data|file)/.test(a)) data = true;
      else if (!a.startsWith('-') && looksPath(a)) urls.push(a);
      continue;
    }
    // httpie·xh: 옵션이 아닌 첫 낱말이 방법일 수 있다(http --auth x PUT 주소). 값을 받는 옵션의 값은 건너뛴다
    if (/^-(?:a|-auth|A|-auth-type|-session|-verify|-cert|-cert-key|o|-output)$/.test(a)) i++;
    else if (!method && !urls.length && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(a)) method = a;
    else if (!a.startsWith('-') && looksPath(a) && !/^[\w.[\]-]+:?=/.test(a)) urls.push(a);
    else if (!a.startsWith('-') && /^[\w.[\]-]+:?=(?!=)/.test(a)) data = true;
  }
  return { method: method || (data ? 'POST' : 'GET'), urls, stdin: false };
};

// 명령 조각의 낱말(앞붙이 env·sudo·timeout·nohup·xargs 등을 벗긴 것)
const wordsOf = (seg) => runWords(seg.words);

// 주석을 뺀 조각 글(따옴표 읽기가 찾은 주석 구간을 지운다 — 따옴표 속 # 은 주석이 아니다)
const uncommented = (seg, shell) => {
  const { comments } = scanQuotes(seg.raw, shell);
  let out = seg.raw;
  for (const [from, to] of [...comments].reverse()) out = out.slice(0, from) + out.slice(to);
  return out;
};

// 명령 하나 → 그 안의 API 호출들 [{ method, path, fields, graphql, via, text }]. text: GraphQL 본문을 찾을 글(그 조각, 표준 입력이면 그 heredoc 본문까지)
const apiCalls = (cmd, shell) => {
  const out = [];
  const docs = heredocs(cmd);
  const docsAfter = (seg) => docs.filter((d) => d.op >= seg.start && d.op < seg.start + seg.raw.length).map((d) => d.body).join('\n');
  for (const seg of commandSegments(cmd, shell)) {
    const w = wordsOf(seg);
    const prog = w[0] || '';
    const text = (stdin) => uncommented(seg, shell) + (stdin ? `\n${docsAfter(seg)}` : '');
    if (prog === 'gh' || prog === 'glab') {
      let i = 1;
      while (/^(?:-R|--repo)$/.test(w[i] || '') || /^--repo=/.test(w[i] || '')) i += w[i].includes('=') ? 1 : 2;
      if (w[i] !== 'api') continue;
      const { method, path, fields, stdin } = parseApi(w.slice(i + 1));
      out.push({ method, path, fields, graphql: /^graphql\b/i.test(path), via: prog, text: text(stdin) });
    } else if (HTTP_PROGS.has(prog)) {
      const { method, urls, stdin } = prog === 'curl' && !w.some((a) => /^-(?:method|uri)(?::|$)/i.test(a)) ? parseCurl(w.slice(1)) : parseOther(prog, w.slice(1));
      for (const u of urls) {
        const path = pathOf(u);
        out.push({ method, path, fields: [], graphql: /(?:^|\/)graphql\/?(?:[?#]|$)/i.test(path), via: prog, text: text(stdin) });
      }
    }
  }
  return out;
};

const isWrite = (m) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
const HELP = /^(?:-h|--help)$/;

// gh·glab 의 병합·승인 하위 명령. gh pr merge --disable-auto(예약 풀기)·--help 는 통과. gh pr -R o/r merge 처럼 사이의 -R 도 건너뛴다
const cliMerge = (w) => {
  const prog = w[0];
  if (prog !== 'gh' && prog !== 'glab') return null;
  const rest = [];
  for (let i = 1; i < w.length; i++) {
    if (/^(?:-R|--repo)$/.test(w[i])) i++;
    else if (!/^--repo=/.test(w[i])) rest.push(w[i]);
  }
  const [noun, verb, ...args] = rest;
  if (args.some((a) => HELP.test(a))) return null;
  if (prog === 'gh' && noun === 'pr' && verb === 'merge') return args.includes('--disable-auto') ? null : 'gh pr merge';
  if (prog === 'gh' && noun === 'pr' && verb === 'review' && args.some((a) => a === '--approve' || /^-[a-z]*a[a-z]*$/.test(a))) return 'gh pr review --approve';
  if (prog === 'glab' && noun === 'mr' && ['merge', 'accept', 'approve'].includes(verb)) return `glab mr ${verb}`;
  return null;
};

// git push 의 -o·--push-option 값
const pushOptions = (words) => {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (a === '-o' || a === '--push-option') out.push(words[++i] || '');
    else if (a.startsWith('--push-option=')) out.push(a.slice(14));
    else if (/^-o./.test(a)) out.push(a.slice(2));
  }
  return out;
};

// 보호 브랜치 이름: 보호 브랜치 훅의 목록, 없으면 Git Flow 이름(main·master·develop)
const protectedNames = (rules) => {
  const pb = rules?.['protect-branch'];
  if (pb && typeof pb === 'object' && Array.isArray(pb.branches)) return pb.branches.filter((b) => typeof b === 'string' && b);
  const { prod, dev } = flowNames(rules);
  return [...prod, ...dev];
};

// 보호 브랜치로 바로 올리는 push(태그만·원격에 아직 없는 브랜치 만들기는 통과) → 그 브랜치 이름 · null
const directPush = (cmd, shell, root, repo, rules) => {
  const pushes = gitSegments(cmd, 'push', shell);
  if (!root || !pushes.length) return null;
  const names = protectedNames(rules);
  const state = repo || repoState(root);
  const branchAt = timelineOf(cmd, shell, root, state);
  const files = findRepo(root);
  for (const { words, start } of pushes) {
    if (words.some((w) => HELP.test(w))) continue;
    const branch = branchAt(start);
    const { targets, all, tagsOnly } = parsePush(words, branch);
    if (tagsOnly) continue;
    const refs = all ? names : targets.length ? targets.filter((x) => !x.del).map((x) => x.ref) : [branch];
    const hit = refs.find((r) => r && names.includes(r) && refExists(files, `refs/remotes/origin/${r}`) !== false);
    if (hit) return hit;
  }
  return null;
};

export const selfMerge = {
  id: 'self-merge',
  on: 'shell',
  check({ cmd, shell, cwd, root, repo, rules, t }) {
    for (const seg of commandSegments(cmd, shell)) {
      const how = cliMerge(wordsOf(seg));
      if (how) return t('selfMerge.cli', { how, pr: how.startsWith('glab') ? 'MR' : 'PR' });
    }
    for (const { words } of gitSegments(cmd, 'push', shell)) {
      const opt = pushOptions(words).find((o) => PUSH_AUTO_MERGE.test(o));
      if (opt) return t('selfMerge.pushOption', { opt });
    }
    for (const c of apiCalls(cmd, shell)) {
      if (c.graphql) {
        if (/\bmutation\b/i.test(c.text) && (MERGE_MUTATION.test(c.text) || APPROVE_REVIEW.test(c.text))) return t('selfMerge.api', { how: `${c.via} … graphql`, pr: /mergeRequest/.test(c.text) ? 'MR' : 'PR' });
        continue;
      }
      if (!isWrite(c.method)) continue;
      const approve = GH_REVIEW_PATH.test(c.path) && (c.fields.some((f) => /^event=APPROVE$/i.test(f)) || /\bevent["']?\s*[:=]\s*["']?APPROVE\b/.test(c.text));
      if (GH_MERGE_PATH.test(c.path) || GH_MERGES_PATH.test(c.path) || GL_MERGE_PATH.test(c.path) || approve) return t('selfMerge.api', { how: `${c.method} ${c.path}`, pr: GL_MERGE_PATH.test(c.path) ? 'MR' : 'PR' });
    }
    // 로컬에서 합치고 보호 브랜치로 바로 올리면 병합과 같다(Git Flow 는 보호 브랜치 훅이 바로 올리기를 막지 않는다)
    const branch = directPush(cmd, shell, root, repo, rules);
    // 보호 브랜치 훅이 그 브랜치로 바로 올리기를 이미 막으면(GitHub Flow 의 noDirectPush) 같은 뜻의 막는 글을 두 번 내지 않는다(점검 2026-11-26)
    const pb = rules?.['protect-branch'];
    const pbBlocks = pb && typeof pb === 'object' && pb.noDirectPush && (Array.isArray(pb.branches) ? pb.branches : ['main', 'master']).includes(branch);
    if (branch && !pbBlocks) return t('selfMerge.directPush', { branch, pr: prWordOf(root || cwd) });
    return null;
  },
};

export const protectRules = {
  id: 'protect-rules',
  ask: true,
  on: 'shell',
  check({ cmd, shell, t }) {
    for (const c of apiCalls(cmd, shell)) {
      if (c.graphql || !isWrite(c.method)) continue;
      if (GH_PROTECT_PATH.test(c.path) || GL_PROTECT_PATH.test(c.path)) return t('protectRules.ask', { how: `${c.method} ${c.path}` });
    }
    return null;
  },
};

// ── push·PR·MR 올리기 전에 묻기(ask-publish, 물음) ──
// 「개발해 줘」 하나로 커밋 → push → PR·MR 열기까지 가던 것(사용자 지적 2026-11-24: 「사용자가 확인하고 올려야 하는데 무작정 올린다」).
// 올리는 것은 사용자가 바뀐 것을 본 뒤에. 막지 않고 물어서, 사용자가 올리라고 했으면 확인 창에서 허락하면 된다.
// 보는 것: git push(--help·--dry-run 은 통과), gh pr create, glab mr create|new, PR·MR 을 만드는 API(POST …/pulls · …/merge_requests),
// GraphQL createPullRequest·mergeRequestCreate. 보호 브랜치로 바로 올리는 push 는 self-merge 가 막는다(막음이 물음보다 앞선다).
// /pulls 는 GitHub 에만 있다 — 앞이 변수("$REPO_API/pulls")여도 POST 면 PR 만들기. /merge_requests 는 GitLab
const GH_CREATE_PATH = /(?:^|\/)pulls\/?(?:[?#]|$)/i;
const GL_CREATE_PATH = /(?:^|\/)merge_requests\/?(?:[?#]|$)/i;
const CREATE_MUTATION = /\b(?:createPullRequest|mergeRequestCreate)\b/;
const short = (s) => (s.length > 80 ? `${s.slice(0, 77)}…` : s).trim();
// push 를 시험 삼아(--dry-run·-n, -nv 같은 짧은 옵션 묶음 속 n 도) 하거나 도움말이면 묻지 않는다
const dryPush = (words) => words.some((w) => HELP.test(w) || w === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w));

// 명령으로 낱말이 정해지면 그것(gh·hub·/pulls 는 PR, glab·/merge_requests 는 MR), 아니면 저장소 위치로
const cliOpen = (w) => {
  const prog = w[0];
  if (prog === 'hub' && w[1] === 'pull-request' && !w.slice(2).some((a) => HELP.test(a))) return { how: 'hub pull-request', word: 'PR' };
  if (prog !== 'gh' && prog !== 'glab') return null;
  const rest = w.slice(1).filter((a, i, all) => !/^(?:-R|--repo)$/.test(a) && !/^(?:-R|--repo)$/.test(all[i - 1] || '') && !/^--repo=/.test(a));
  const [noun, verb, ...args] = rest;
  if (args.some((a) => HELP.test(a) || a === '--dry-run')) return null;
  if (prog === 'gh' && noun === 'pr' && (verb === 'create' || verb === 'new')) return { how: `gh pr ${verb}`, word: 'PR' };
  if (prog === 'glab' && noun === 'mr' && (verb === 'create' || verb === 'new')) return { how: `glab mr ${verb}`, word: 'MR' };
  return null;
};

export const askPublish = {
  id: 'ask-publish',
  ask: true,
  on: 'shell',
  check({ cmd, shell, root, repo, rules, opts, t }) {
    for (const seg of commandSegments(cmd, shell)) {
      const hit = cliOpen(wordsOf(seg));
      if (hit) return t('askPublish.open', { how: hit.how, pr: hit.word });
    }
    for (const c of apiCalls(cmd, shell)) {
      if (c.graphql) {
        if (/\bmutation\b/i.test(c.text) && CREATE_MUTATION.test(c.text)) return t('askPublish.open', { how: `${c.via} … graphql`, pr: /mergeRequestCreate/.test(c.text) ? 'MR' : 'PR' });
        continue;
      }
      if (c.method !== 'POST') continue;
      if (GH_CREATE_PATH.test(c.path)) return t('askPublish.open', { how: `${c.method} ${c.path}`, pr: 'PR' });
      if (GL_CREATE_PATH.test(c.path)) return t('askPublish.open', { how: `${c.method} ${c.path}`, pr: 'MR' });
    }
    // protectedOnly(트렁크 기반 — main 에 바로 합치는 방식): 보호 브랜치로 올리는 push 만 묻는다(점검 2026-11-26 — 팀이 트렁크면 묻지 않고 공용 main 에 올렸다)
    const names = opts?.protectedOnly ? protectedNames(rules) : null;
    const branchAt = names && root ? timelineOf(cmd, shell, root, repo || repoState(root)) : null;
    // 저장소가 아닌 곳의 push 는 어차피 실패한다 — 묻지 않는다(git 이 없거나 저장소 밖일 때 확인 창만 뜨던 것)
    for (const seg of root ? gitSegments(cmd, 'push', shell) : []) {
      if (dryPush(seg.words)) continue;
      if (names) {
        if (!branchAt) continue;
        const { targets, all, tagsOnly } = parsePush(seg.words, branchAt(seg.start));
        const refs = all ? names : targets.length ? targets.map((x) => x.ref) : [branchAt(seg.start)];
        if (tagsOnly || !refs.some((r) => r && names.includes(r))) continue;
      }
      // 확인 창에 보일 명령: 주석(# 뒤)은 뺀다 — bare 는 따옴표 속·주석을 비운 글이라 주석 자리를 거기서 찾는다
      const shown = seg.raw.slice(0, seg.raw.length - (seg.bare.length - seg.bare.replace(/\s+$/, '').length));
      return t('askPublish.push', { how: short(`git push ${shown}`.replace(/\s+/g, ' ')) });
    }
    return null;
  },
};

export default [selfMerge, protectRules, askPublish];
