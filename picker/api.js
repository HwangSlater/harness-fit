// 서버(scripts/picker.mjs)와 주고받기. 데이터 요청은 모두 X-Harness-Token 헤더를 붙인다(다른 사이트는 CORS 때문에 못 붙인다).
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const ERR_DETAIL_MAX = 160; // 화면에 보이는 원래 오류 글은 짧게

// 오류에 code 를 붙인다: network(연결 끊김) · forbidden(토큰·Host 거절) · tooLarge · server(그 밖)
const fail = (code, detail) => Object.assign(new Error(detail || code), { code, detail });
const SERVER_CODES = { forbidden: 'forbidden', 'too large': 'tooLarge' };

export const api = async (p, body) => {
  let res;
  try {
    res = await fetch(p, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Harness-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw fail('network', String(e.message || e));
  }
  const data = await res.json().catch(() => ({}));
  // partial: 적용 실패 때 서버가 「바뀐 것이 남았는지」 알린다(apply-flow.js 가 되돌리기를 권할지 가른다)
  if (!res.ok || data.error) throw Object.assign(fail(SERVER_CODES[data.error] || 'server', String(data.error || `HTTP ${res.status}`)), { partial: data.partial === true, answered: true, fsCode: typeof data.fsCode === 'string' ? data.fsCode : null });
  return data;
};

const ERR_KEYS = { network: 'errNetwork', forbidden: 'errForbidden', tooLarge: 'errTooLarge', server: 'errServer' };
export const errText = (t, e) => t(ERR_KEYS[e.code] || 'errServer');
// 길면 뒤쪽을 남긴다(Windows 긴 경로에서 어느 파일인지는 끝에 있다).
const errDetail = (e) => {
  const d = e.code === 'server' && e.detail ? String(e.detail) : '';
  return d.length > ERR_DETAIL_MAX ? `…${d.slice(-ERR_DETAIL_MAX)}` : d;
};
export const errInfo = (t, e) => ({ text: errText(t, e), detail: errDetail(e) });
