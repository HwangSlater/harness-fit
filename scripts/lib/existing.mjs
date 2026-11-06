// 감지 결과에 「이미 있는 것」을 더한다: 같은 일을 하는 기존 훅(실제로 시험 입력을 넣어 봄), 이미 깔린 스킬.
// 훅 시험은 몇 초~십몇 초 걸려서 detect(빠른 동기 함수)와 나눠 둔다. 고르기 화면과 auto 추천이 이것을 거친다.
// 고르기 화면은 빠른 것(withInstalled)만 먼저 넣어 화면을 띄우고, 훅 시험(withHookProbe)은 뒤에서 마저 한다(hooksPending).
import { probeExistingHooks, skippedProjectHooks } from './existing-hooks.mjs';
import { listSkills } from './installed.mjs';

// 깔린 스킬·건너뛴 저장소 훅 수(빠름). 훅 시험 결과는 아직 없다(hooksPending: true).
export const withInstalled = (det, root, { home } = {}) => ({
  ...det,
  existing: { ...det.existing, hooks: {}, hookProbeFailed: false, hooksPending: true, projectHooksSkipped: skippedProjectHooks(root, home), skillList: listSkills(root, home) },
});

// 기존 훅 시험 결과를 넣는다. 시험이 실패해도 고르기는 막지 않는다. 대신 화면에 「겹치는지 확인하지 못했다」고 알린다(hookProbeFailed).
export const withHookProbe = async (det, root, { home } = {}) => {
  let hooks = {};
  let hookProbeFailed = false;
  try {
    hooks = await probeExistingHooks(root, { home });
  } catch {
    hookProbeFailed = true;
  }
  return { ...det, existing: { ...det.existing, hooks, hookProbeFailed, hooksPending: false } };
};

export const withExisting = async (det, root, opts = {}) => withHookProbe(withInstalled(det, root, opts), root, opts);
