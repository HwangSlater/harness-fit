// 마우스·손가락을 누르고 있는 동안에는 화면을 다시 그리지 않는다(공통 — 칩 칸·늦게 오는 응답이 함께 쓴다).
// 누르는 사이에 다시 그리면 누른 요소가 새 요소로 바뀌어 그 click 이 먹히지 않는다:
//  - 칩 칸: 칸을 떠날 때(blur — 누를 때 일어남) 적던 글을 넣으며 다시 그리던 일(다시 검토 2026-11-12)
//  - 미리보기·GitHub 확인·기존 훅 시험 응답이 누르는 도중 도착하던 일(전체 검토 2026-11-13)
let pressing = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
document.addEventListener('pointerup', () => { pressing = false; }, true);
document.addEventListener('pointercancel', () => { pressing = false; }, true);
// 손 떼기가 끝내 오지 않는 때(오른쪽 단추 메뉴·끌기·창 밖으로 나감): 누르는 중으로 남아 갱신이 다음 클릭까지 밀리지 않게 풀고, 기다리던 것을 돌린다(검토 2026-11-13)
const release = () => {
  if (!pressing) return;
  pressing = false;
  document.dispatchEvent(new Event('pointercancel'));
};
document.addEventListener('contextmenu', release, true);
document.addEventListener('dragstart', release, true);
window.addEventListener('blur', release);

// fn 을 지금(다음 차례) 또는 손을 뗀 뒤에 돌린다. click 은 pointerup 과 같은 차례에 오므로 그 뒤에 돌게 setTimeout 을 한 번 더
export const afterPress = (fn) => {
  if (!pressing) return void setTimeout(fn, 0);
  const done = () => {
    document.removeEventListener('pointerup', done, true);
    document.removeEventListener('pointercancel', done, true);
    setTimeout(fn, 0);
  };
  document.addEventListener('pointerup', done, true);
  document.addEventListener('pointercancel', done, true);
};

// 늦게 온 응답으로 다시 그릴 때: 누르는 중이 아니면 바로, 누르는 중이면 뗀 뒤 한 번만(여러 응답이 겹쳐도 한 번)
let queued = false;
export const renderWhenFree = (render) => {
  if (!pressing) return render();
  if (queued) return;
  queued = true;
  afterPress(() => {
    queued = false;
    render();
  });
};
