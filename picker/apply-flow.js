// 적용·그만두기 흐름(app.js 에서 나눔): 확인 → 기다리는 동안 진행 표시(/api/progress 를 짧게 되풀이해 묻는다) → 끝 화면 또는 알림 창.
// 상태(ui·선택)는 app.js 가 갖고, 여기는 그것을 받아 바꾸기만 한다.
import { api, errInfo } from './api.js';
import { applyBlock } from './frame.js';
import { snapshot } from './selection.js';

const PROGRESS_POLL_MS = 400;

// env: { ui, t, current(): 지금 선택, ctx(): 그리기 문맥, payload(sel), render(), openPanel(d) }
export const applyActions = ({ ui, t, current, ctx, payload, render, openPanel }) => ({
  // 적용은 확인 단계의 단추만 한다(요약 카드·휴대폰 막대는 확인 단계로 데려간다). 확인한 순간의 선택·미리보기를 따로 떠 둔다. 끝 화면은 이것으로 그린다(적용 중에 바뀐 화면 상태와 섞이지 않게).
  async confirmApply() {
    if (ui.step !== 'review' || applyBlock(ctx())) return;
    ui.applied = { sel: snapshot(current()), preview: ui.preview };
    ui.panel = null;
    ui.busy = true;
    ui.progress = null;
    render();
    const poll = setInterval(async () => {
      try {
        ui.progress = await api('/api/progress');
        render();
      } catch {}
    }, PROGRESS_POLL_MS);
    try {
      ui.done = await api('/api/apply', payload(ui.applied.sel));
    } catch (e) {
      // 연결이 끊겼으면 서버가 이미 적용하고 꺼졌을 수 있어 바뀌었을 수 있다고 본다.
      // 서버가 답했으면 그 답대로: partial 이 아니면 스스로 되돌렸으니 바뀐 것이 없다 — 되돌리기를 권하면 지난 적용까지 지워진다(검토 2026-11-13)
      const maybeChanged = e.code === 'network' || !e.answered || e.partial;
      // 파일 오류는 사람 말로(읽기 전용·디스크 가득·잠김) — 「처리하다가 오류가 났어요」만으로는 무엇을 고칠지 몰랐다(화면 역할 평가 2026-11-13)
      const FS = { EPERM: 'applyFsPerm', EACCES: 'applyFsPerm', EROFS: 'applyFsPerm', ENOSPC: 'applyFsSpace', EBUSY: 'applyFsBusy' };
      const fsText = FS[e.fsCode] ? { text: t(FS[e.fsCode]) } : {};
      ui.panel = { kind: 'failed', maybeChanged, nothingChanged: !maybeChanged, network: e.code === 'network', ...errInfo(t, e), ...fsText, ...(e.code === 'network' ? { text: t('applyNetwork') } : {}) };
    } finally {
      clearInterval(poll);
      ui.busy = false;
    }
    render();
  },
  cancel: () => openPanel({ kind: 'cancel' }),
  async confirmCancel() {
    ui.panel = null;
    ui.busy = true;
    render();
    try {
      await api('/api/cancel', {});
      ui.done = null;
    } catch (e) {
      ui.panel = { kind: 'failed', maybeChanged: false, ...errInfo(t, e) };
    } finally {
      ui.busy = false;
    }
    render();
  },
});
