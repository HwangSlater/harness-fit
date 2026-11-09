// 날짜 글(YYYY-MM-DD)은 사용자 PC 시간대로 쓴다 — UTC 로 적으면 한국 오전에는 전날로 보인다.
// 훅(문서 날짜 검사)과 scripts(적용 기록·시험 입력)가 같이 쓴다.
const pad = (n) => String(n).padStart(2, '0');

// t: 밀리초 또는 Date(안 주면 지금)
export const localDate = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
