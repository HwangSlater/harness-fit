// 스킬 받기의 네트워크 한 곳: 동시에 받는 수 한도, GitHub 호출 한도 알아보기, API 호출에만 gh 토큰 붙이기.
// 토큰은 어디에도 찍지 않는다(오류 글·로그·결과 JSON 모두). raw 파일 받기에는 붙이지 않는다.
import { defaultRunner } from './github-settings.mjs';

// 한 번에 n 개까지만 돌린다. 여러 스킬이 같은 한도를 나눠 쓴다(스킬 수만큼 연결이 늘지 않게).
export const makeLimiter = (n) => {
  const max = Math.max(1, Number(n) || 1);
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
};

// 한도에 걸린 뒤 다시 될 때까지 남은 분(올림, 최소 1). 알 수 없으면 null.
const waitMinutes = (res, now) => {
  const after = Number(res.headers?.get?.('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.max(1, Math.ceil(after / 60));
  const reset = Number(res.headers?.get?.('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil((reset * 1000 - now) / 60000));
  return null;
};

export const rateLimitText = (lang, min) =>
  lang === 'en'
    ? `GitHub rate limit — try again in ${min ? `about ${min} min` : 'a while'}`
    : `GitHub 호출 한도 — ${min ? `약 ${min}분` : '잠시'} 뒤 다시`;

// 403·429 중 호출 한도인 것만(남은 횟수 0, retry-after, 429). 권한 없음 같은 403 은 보통 오류로 둔다.
const isRateLimited = (res) =>
  res.status === 429 || (res.status === 403 && (res.headers?.get?.('x-ratelimit-remaining') === '0' || !!res.headers?.get?.('retry-after')));

const rateLimitError = (res, lang, now = Date.now()) => {
  const min = waitMinutes(res, now);
  return Object.assign(new Error(rateLimitText(lang, min)), {
    reason: 'rate-limit',
    waitMin: min,
    retryAt: min ? new Date(now + min * 60000).toISOString() : null,
  });
};

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url).split('/')[0]; // 시험의 짧은 주소(「raw/…」)
  }
};

// gh 가 로그인돼 있으면 그 토큰(API 한도 60 → 5000/시간). 없거나 이상하면 null. 실행 결과를 찍지 않는다.
export const ghToken = async (run = defaultRunner) => {
  try {
    const r = await run('gh', ['auth', 'token']);
    const token = r.code === 0 ? String(r.stdout).trim() : '';
    // 머리글에 넣는 값이라 줄바꿈·공백이 섞인 것은 쓰지 않는다
    return /^[\w.-]{20,255}$/.test(token) ? token : null;
  } catch {
    return null;
  }
};

// sources: config/sources.json(githubApi·downloadConcurrency·downloadTimeoutMs). token: 토큰을 얻는 함수(시험이 바꿔 끼운다).
// 한 번 적용(installAll)마다 하나 만든다 — 한도·토큰·「한도에 걸림」 기억을 그 적용 안에서만 나눈다.
export const makeNet = (sources, { token = ghToken, lang = 'ko' } = {}) => {
  const limit = makeLimiter(sources.downloadConcurrency ?? 4);
  const timeout = sources.downloadTimeoutMs ?? 20000;
  let tokenP = null;
  // 호스트마다 한도에 걸렸던 오류. 걸린 뒤로는 같은 호스트를 다시 부르지 않고 같은 이유로 바로 실패한다(남은 횟수를 더 쓰지 않게).
  const blocked = new Map();
  // 본문까지 다 읽은 뒤에 자리를 비운다(read). cancelled: 차례를 기다리는 동안 같은 스킬의 다른 파일이 이미 실패했으면 부르지 않는다.
  const call = (url, headers, read, cancelled) =>
    limit(async () => {
      if (cancelled?.()) throw new Error('cancelled');
      const host = hostOf(url);
      if (blocked.has(host)) throw blocked.get(host);
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return read(res);
      if (isRateLimited(res)) {
        const e = rateLimitError(res, lang);
        blocked.set(host, e);
        throw e;
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    });
  return {
    // GitHub API(파일 목록이 카탈로그에 없을 때만)
    json: async (url) => {
      tokenP ??= Promise.resolve().then(() => token()).catch(() => null);
      const t = await tokenP;
      return call(url, { Accept: 'application/vnd.github+json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, (res) => res.json());
    },
    // 고정 커밋의 파일 하나(raw). 토큰을 붙이지 않는다.
    bytes: (url, cancelled) => call(url, {}, async (res) => Buffer.from(await res.arrayBuffer()), cancelled),
  };
};
