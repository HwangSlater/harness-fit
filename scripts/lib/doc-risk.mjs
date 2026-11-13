// README·CI 에서 읽은 명령이 평소 명령이 아닌지 가리는 낱말 판정(doc-commands.mjs 가 쓴다).
// 낱말 목록을 하나씩 덧대던 방식(이름 낱말 경계로만 맞춤)은 run_migrations.py·deployModel.py·--drop-existing·$PROD_URL 을 놓쳤다(독립 검토 2026-11-13).
// 이제는 이름·인자·옵션을 모두 조각(_ - . / 와 camelCase 경계)으로 나눠, 조각이 위험한 낱말 뿌리로 시작하면 뺀다.
// 「그 밖의 명령」은 Claude 에게 「평소 돌려도 되는 명령」이라고 알리는 목록이다 — 안전한 명령을 빠뜨리는 값은 작고, 위험한 명령을 넣는 값은 크다.

// 낱말 뿌리: 조각이 이것으로 시작하면 위험(migrat → migrate·migration·migrations, delet → delete·deleted)
const STEMS = ['migrat', 'deploy', 'ship', 'publish', 'releas', 'upload', 'push', 'rollback', 'destroy', 'drop', 'delet', 'remov', 'wipe', 'reset',
  'flush', 'nuke', 'purge', 'clean', 'clear', 'eras', 'truncat', 'seed', 'sync', 'rebuild', 'overwrit', 'prod', 'backfill', 'restor', 'send', 'email',
  'notif', 'force', 'commit', 'apply', 'kill'];
// 짧아서 뿌리로 맞추면 다른 낱말까지 걸리는 것은 조각 전체가 같을 때만(-y·--yes 는 확인 없이 진행)
const EXACT = new Set(['yes', 'y', 'rm', 'live']);
// 뿌리는 맞지만 위험하지 않은 조각(학습의 dropout)
const SAFE = new Set(['dropout']);
// 두 조각이 이어질 때만 위험: init_db·create_tables·setup_schema
const MAKE_WORD = new Set(['init', 'create', 'setup', 'recreate', 'bootstrap']);
const STORE_WORD = new Set(['db', 'database', 'databases', 'schema', 'tables', 'table', 'index', 'indices']);
// 학습 스크립트의 난수 시드(--seed 42·seed=42)는 DB 시드가 아니다
const SEED_OPT = /^--?(?:random[-_]?)?seed$/i;
const SEED_KV = /^(?:--?)?(?:[\w-]+\.)*(?:random[-_]?)?seed=\d+$/i;

// 글 → 소문자 조각. camelCase 경계([a-z0-9][A-Z])와 영문·숫자 아닌 글자에서 나눈다($PROD_URL → prod·url, deployModel → deploy·model)
export const wordParts = (x) => String(x).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const riskyParts = (ps) => ps.some((p, k) => !SAFE.has(p) && (EXACT.has(p) || STEMS.some((s) => p.startsWith(s)) || (MAKE_WORD.has(p) && STORE_WORD.has(ps[k + 1]))));

// 명령 낱말 가운데 하나라도 위험한 조각이 있는지. cargo: --release 는 빌드 옵션이라 본다
export const riskyWords = (words, { cargo = false } = {}) => {
  for (let i = 0; i < words.length; i++) {
    const x = String(words[i]);
    if (cargo && x === '--release') continue;
    if (SEED_OPT.test(x) && /^\d+$/.test(String(words[i + 1] ?? ''))) { i++; continue; }
    if (SEED_KV.test(x)) continue;
    if (riskyParts(wordParts(x))) return true;
  }
  return false;
};

// 글에 운영(prod·production) 조각이 있는지 — 대소문자·꼴(--env=PROD·$PROD_URL·production-db)과 상관없이
export const prodIn = (text) => wordParts(String(text).slice(0, 400)).some((p) => p === 'prod' || p === 'production' || p === 'prd');

// 주의·부정 낱말: 주석(# WARNING: …)이나 글(Never run `…`)에 이것이 있으면 그 명령은 평소 명령이 아니다
export const WARN_WORDS = /warn|careful|danger|caution|never|don'?t|do not|must not|avoid|outside|unless|only\b|\bnot\b|prod|주의|운영|조심|위험|금지|절대|하지\s*마|마세요|말\s*것|말고|않/i;
