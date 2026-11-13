// fastlane 의 올리기·서명 동작 이름. 훅(ask-match.mjs — fastlane run <동작> 맞추기)과 추천(scripts/lib/fastlane.mjs — 레인 본문 판정)이
// 같은 목록을 쓴다(역할극 16 회차 다시 매기기: `fastlane run upload_to_testflight` 가 묻는 명령 `fastlane pilot upload` 를 지나갔다, 2026-11-13).

// 올리기·서명 자료를 만드는 동작(docs.fastlane.tools/actions). match·sync_code_signing 은 readonly 일 때만 받기다
export const SHIP_ACTION = /^(?:deliver|upload_to_app_store|appstore|pilot|upload_to_testflight|testflight|supply|upload_to_play_store|cert|get_certificates|sigh|get_provisioning_profile|produce|create_app_online|pem|match_nuke)$/;
export const MATCH_ACTION = /^(?:match|sync_code_signing)$/;

// `fastlane run <동작>` 을 같은 일을 하는 도구 명령으로(동작 이름과 별칭 — docs.fastlane.tools/actions 의 「Aliases」).
// 사용자가 적은 「fastlane pilot upload」 「fastlane deliver」 가 run 꼴에도 맞게. 여기 없는 동작(get_version_number 등)은 그대로 둔다
const TOOL_OF = {
  upload_to_testflight: ['pilot', 'upload'], testflight: ['pilot', 'upload'], pilot: ['pilot', 'upload'],
  upload_to_app_store: ['deliver'], appstore: ['deliver'], deliver: ['deliver'],
  get_certificates: ['cert'], cert: ['cert'],
  get_provisioning_profile: ['sigh'], sigh: ['sigh'],
  create_app_online: ['produce'], produce: ['produce'],
  upload_to_play_store: ['supply'], supply: ['supply'],
  pem: ['pem'],
  match_nuke: ['match', 'nuke'], match: ['match'], sync_code_signing: ['match'],
};
// fastlane 전역 옵션 가운데 값을 받는 것(--env beta). 나머지(--verbose·--capture_output·--troubleshoot …)는 값이 없다
const GLOBAL_VALUE = /^--env$/;
// 명령 낱말(fastlane [전역 옵션] [ios|android|mac] run <동작> …) → 도구 꼴 낱말(fastlane <도구> …). 해당 없으면 null.
// run 앞의 전역 옵션을 건너뛴다 — fastlane --verbose run upload_to_testflight 가 지나가고 fastlane --verbose pilot upload 는 묻던 일(독립 검토 2026-11-13)
export const runActionForm = (w) => {
  if (!Array.isArray(w) || w[0] !== 'fastlane') return null;
  let at = 1;
  for (let guard = 0; guard < 16 && at < w.length; guard++) {
    const x = String(w[at] ?? '');
    if (/^(?:ios|android|mac)$/.test(x)) at++;
    else if (x.startsWith('-')) at += GLOBAL_VALUE.test(x) ? 2 : 1;
    else break;
  }
  if (w[at] !== 'run') return null;
  const tool = Object.hasOwn(TOOL_OF, String(w[at + 1] ?? '')) ? TOOL_OF[w[at + 1]] : null;
  return tool ? ['fastlane', ...tool, ...w.slice(at + 2)] : null;
};
