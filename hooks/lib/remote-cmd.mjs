// 원격·운영에 닿는 명령인지(ask-cmd 의 remote — hooks/rules/shell.mjs askCmd). shell.mjs 가 길어져 나눴다(2026-11-11).
// ssh·scp·원격 rsync·바꾸는 kubectl·helm·terraform·ansible, aws·gcloud·az·gsutil 의 바꾸는 명령, 원격 호스트의 DB 클라이언트, 원격 docker.
import { VAULT_VALUE } from './secret-read.mjs';
import { shellWrites } from './shell-writes.mjs';
import { justLooking } from './ask-match.mjs';
// 하위 명령: 앞 옵션과 그 값(-n prod, --context x)을 건너뛴 첫 낱말
const KUBE_VALUE = /^(?:-n|--namespace|--context|--cluster|--kubeconfig|--user|-s|--server|--as|--token)$/;
const HELM_VALUE = /^(?:-n|--namespace|--kube-context|--kubeconfig)$/;
const verbOf = (w, valueOpt) => {
  for (let i = 1; i < w.length; i++) {
    if (!w[i].startsWith('-')) return w[i];
    if (valueOpt.test(w[i])) i++;
  }
  return '';
};
// 원격 주소 인자: 「호스트:경로」·「사람@호스트:경로」·rsync:// (Windows 드라이브 C:/ 는 아님). 정규식 대신 : 앞부분만 본다(긴 낱말에서 제곱 시간 — 검토 2026-11-11)
const HOST = /^[\w.-]+(?:@[\w.-]+)?$/;
const remoteArg = (x) => {
  if (x.startsWith('-')) return false;
  if (x.startsWith('rsync://')) return true;
  const at = x.indexOf(':');
  if (at <= 0 || /^[A-Za-z]$/.test(x.slice(0, at))) return false;
  return HOST.test(x.slice(0, at)) || /^\[[0-9a-fA-F:]+\]$/.test(x.slice(0, at));
};
// 클라우드·원격 DB·원격 docker(역할극 6 회차 2차: aws·gcloud·az·psql -h·docker -H 가 묻지 않고 지나갔다, 2026-11-11)
// 값을 받는 옵션은 그 값을 하위 명령으로 읽지 않게 건너뛴다(aws --cli-read-timeout 5 ec2 …, az vm show --name set — 검토 2026-11-11)
const AWS_VALUE = /^(?:--profile|--region|--output|--query|--endpoint-url|--color|--cli-input-json|--ca-bundle|--cli-read-timeout|--cli-connect-timeout|--page-size|--max-items|--starting-token|--exclude|--include|--acl|--storage-class|--sse|--content-type|--cache-control|--expires|--metadata)$/;
const AWS_CHANGE = /^(?:create|delete|terminate|put|update|modify|run|start|stop|reboot|attach|detach|remove|deregister|register|revoke|authorize|reset|restore|replace|cancel|disable|enable|import|invoke|publish|send|restart|rotate|associate|disassociate|deploy|execute|purge|release|tag|untag|set)(?:-|$)/;
const plainWords = (w, valueOpt) => {
  const out = [];
  for (let i = 1; i < w.length; i++) {
    if (!w[i].startsWith('-')) out.push(w[i]);
    else if (valueOpt.test(w[i])) i++;
  }
  return out;
};
// 올리는 쪽(마지막 위치 인자)이 클라우드 저장소면 바꾸는 것 — 내려받기(s3://… ./)는 아님
const toBucket = (words, scheme) => (words.at(-1) || '').startsWith(scheme);
const awsChanges = (w) => {
  const words = plainWords(w, AWS_VALUE);
  const [service, op = ''] = words;
  if (service === 'configure') return false; // 이 PC 의 설정
  // sync·cp 는 받는 쪽(마지막 위치 인자)이 s3:// 일 때만 — 내려받기(s3 sync s3://… ./data)는 이 PC 만 바꾼다(검토 2026-11-11).
  // mv 는 내려받아도 원래 객체를 지우니 늘 묻는다.
  if (service === 's3') return /^(?:rm|mv|rb|mb)$/.test(op) || (/^(?:cp|sync)$/.test(op) && toBucket(words, 's3://'));
  return AWS_CHANGE.test(op);
};
// gcloud·az: 바꾸는 낱말이 명령 안에 있으면. 이 컴퓨터의 설정만 바꾸는 config·auth·account·login 은 아님
const CLOUD_VALUE = /^(?:--project|--subscription|--resource-group|-g|--zone|--region|--format|--account|--configuration|-n|--name|-l|--location|-o|--output|--query|--container-name|-c|--file|-f|--account-name|--source|-s|--destination|-d)$/;
const CLOUD_CHANGE = /^(?:create|delete|update|deploy|set|reset|stop|start|restart|resize|remove|add|import|ssh|scp|patch|apply|rollback|upgrade|purge|cancel|attach|detach|enable|disable|upload|upload-batch|delete-batch|sync|(?:add|remove|set)-[\w-]+)$/;
const cloudChanges = (w) => {
  const words = plainWords(w, CLOUD_VALUE);
  if (['config', 'auth', 'account', 'login', 'logout', 'init', 'components', 'extension'].includes(words[0])) return false;
  // gcloud storage rm·cp·mv·rsync(gsutil 과 같은 꼴)
  if (w[0] === 'gcloud' && words[0] === 'storage') return /^(?:rm|rb|mb)$/.test(words[1] || '') || (/^(?:cp|mv|rsync)$/.test(words[1] || '') && toBucket(words, 'gs://'));
  return words.some((x) => CLOUD_CHANGE.test(x));
};
const gsutilChanges = (w) => {
  const words = plainWords(w, /^(?:-o|-h|-p|-u)$/);
  return /^(?:rm|rb|mb|setmeta|acl|iam)$/.test(words[0] || '') || (/^(?:cp|mv|rsync)$/.test(words[0] || '') && toBucket(words, 'gs://'));
};
const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)$/i;
// 포트(:5432)는 콜론이 하나일 때만 뗀다(::1 같은 IPv6 를 망가뜨리지 않게)
const remoteHost = (h) => {
  const x = String(h || '').trim();
  if (!x || x.startsWith('/') || LOCAL_HOST.test(x)) return false;
  return !LOCAL_HOST.test(x.replace(/^([^:]+):\d+$/, '$1').replace(/^(\[[^\]]+\]):\d+$/, '$1'));
};
// -h 값·-h값·--host=값·--host 값
const optValues = (w, short, long) => {
  const out = [];
  for (let i = 1; i < w.length; i++) {
    const x = w[i];
    if (x === short || x === long) out.push(w[i + 1] || '');
    else if (x.startsWith(`${long}=`)) out.push(x.slice(long.length + 1));
    else if (short && x.startsWith(short) && x.length > 2 && !x.startsWith('--')) out.push(x.slice(2));
  }
  return out;
};
const DB_URI = /^(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^/:?,]+)/i;
const DB_CLIENT = new Set(['psql', 'pg_dump', 'pg_restore', 'pg_dumpall', 'mysql', 'mariadb', 'mysqldump', 'mongosh', 'mongo', 'mongodump', 'mongorestore', 'redis-cli']);
// 호스트를 정하는 환경 변수(명령 앞에 붙이거나 같은 줄 앞에서 export)
const DB_HOST_ENV = ['PGHOST', 'MYSQL_HOST'];
const uriHost = (x) => DB_URI.exec(x.slice(x.indexOf('=') + 1))?.[1] || DB_URI.exec(x)?.[1];
// 이름이 운영을 뜻하는 환경 변수 참조($PROD_DATABASE_URL·${DB_PROD_URL}·$env:PRODUCTION_DSN·%PROD_DB%) — 접속 주소를 변수로 넘기는 꼴.
// -h·주소 글자만 보아 psql "$PROD_DATABASE_URL"·goose … "$PROD_DATABASE_URL" up 이 지나갔다(역할극 14 회차 정답지, 2026-11-13).
// $DATABASE_URL·$DEV_*·$TEST_*·$STAGING_* 는 어디인지 모르니 묻지 않는다(헛물음이 놓침보다 나쁘다). PRODUCT_* 는 운영이 아니다
const PROD_NAME = /(?:^|_)PROD(?:UCTION)?(?:_|$)/i;
const VAR_REF = /\$\{?(?:env:)?([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/g;
const prodRef = (x) => String(x).includes('$') || String(x).includes('%') ? [...String(x).matchAll(VAR_REF)].some((m) => PROD_NAME.test(m[1] || m[2])) : false;
// 접속 자리만 본다: 위치 인자(DB 이름·주소), 접속 옵션 값(-d·--dbname·--url·-database·-u·-h …), 도구 앞 변수=값.
// SQL·스크립트·변수 글을 받는 옵션(-c·--command·-f·-v·-e·--eval …)의 값은 접속이 아니다 —
// psql -c "… '$PROD'" 처럼 SQL 속 $PROD 가 운영 접속으로 읽혀 물었다(검토 2026-11-13)
const TEXT_OPT = /^(?:-c|--command|-f|--file|-v|--set|--variable|-e|--execute|--eval|-o|--output|-L|--log-file|-P|--pset)$/;
const TEXT_SHORT = /^-[cfveoLP]./;
const connArgs = (w) => {
  const out = [];
  for (let i = 1; i < w.length; i++) {
    const x = w[i];
    if (!x.startsWith('-')) { out.push(x); continue; }
    if (TEXT_OPT.test(x)) { i++; continue; }
    const eq = x.indexOf('=');
    if (eq > 0) { if (!TEXT_OPT.test(x.slice(0, eq))) out.push(x.slice(eq + 1)); continue; }
    // 붙여 쓴 짧은 꼴(-d$PROD_URL·-h$PROD_HOST) — 글을 받는 짧은 옵션(-c"…")은 빼고
    if (!x.startsWith('--') && x.length > 2 && !TEXT_SHORT.test(x)) out.push(x.slice(2));
  }
  return out;
};
// prefix: 도구 앞의 낱말(GOOSE_DBSTRING=$PROD_DATABASE_URL goose up 의 변수=값)
const prodTarget = (w, prefix = []) => connArgs(w).some(prodRef) || prefix.some((x) => ENV_WORD.test(x) && prodRef(x.slice(x.indexOf('=') + 1)));
const dbRemote = (w, env = {}, prefix = []) => DB_CLIENT.has(w[0]) && !w.includes('--help') && !w.includes('--version')
  && (optValues(w, '-h', '--host').some(remoteHost) || w.slice(1).some((x) => remoteHost(uriHost(x))) || DB_HOST_ENV.some((k) => remoteHost(env[k])) || prodTarget(w, prefix));
// 마이그레이션 도구(goose·golang-migrate·dbmate·atlas·flyway·liquibase·sqlx·sql-migrate)는 운영 변수로 가면서 스키마를 바꿀 때만.
// status·version·validate·info·lint 같은 보기와 create(새 파일 만들기)는 묻지 않는다. migrate 낱말은 마지막 위치 인자일 때만
// 바꾸기(flyway migrate·dbmate migrate — atlas migrate status·sqlx migrate info 는 보기). 글자 그대로의 주소는 보지 않는다 —
// docker compose 안 호스트(db·postgres)도 원격처럼 보여 헛물음이 잦다
const MIGRATE_TOOL = new Set(['goose', 'migrate', 'dbmate', 'atlas', 'flyway', 'liquibase', 'sqlx', 'sql-migrate']);
const MIGRATE_CHANGE = /^(?:up|up-by-one|up-to|down|down-to|redo|reset|drop|force|goto|rollback|apply|clean|undo|repair|baseline|load|run|revert|update|update-count|update-to-tag|rollback-count|rollback-to-date|rollback-to-tag|dropall|drop-all)$/;
// 다만 호스트 이름에 prod·production 마디가 든 글자 주소는 운영으로 본다(goose postgres "postgres://u@db.prod.internal/x" up —
// 역할극 14 회차, 2026-11-13). 마디는 영문·숫자 아닌 글자로 나눈다(payments-prod.db·db.prod.internal 은 운영, product-db 는 아님).
// 주소 꼴: 스킴://[사람@]호스트, MySQL DSN 의 @tcp(호스트), key=value DSN 의 host=호스트
// JDBC 주소(jdbc:postgresql://…)는 앞의 jdbc: 를 떼고 본다. 파일 DB(sqlite3://prod.db·file:)는 호스트가 아니다(검토 2026-11-13)
const URL_HOST = /^(?:jdbc:)?([a-z][a-z0-9+.-]{0,30}):\/\/(?:[^@/\s]{0,256}@)?(\[[^\]]{0,64}\]|[^/:?,\s]{1,253})/i;
const FILE_DB = /^(?:sqlite3?|file|duckdb|libsql\+file)$/i;
const urlHost = (t) => {
  const m = URL_HOST.exec(t);
  return m && !FILE_DB.test(m[1]) ? m[2] : null;
};
const TCP_HOST = /@tcp\(([^):]{1,253})/i;
const KV_HOST = /(?:^|\s)host=([^\s]{1,253})/i;
const PROD_LABEL = /^(?:prod|production)$/;
const prodHost = (x) => {
  const s = String(x).slice(0, 2048);
  if (URL_HOST.test(s.slice(s.indexOf('=') + 1)) && !urlHost(s.slice(s.indexOf('=') + 1))) return false;
  const host = urlHost(s.slice(s.indexOf('=') + 1)) || urlHost(s) || TCP_HOST.exec(s)?.[1] || KV_HOST.exec(s)?.[1];
  return !!host && host.toLowerCase().split(/[^a-z0-9]+/).some((p) => PROD_LABEL.test(p));
};
const literalProd = (w, prefix) => connArgs(w).some(prodHost) || prefix.some((x) => ENV_WORD.test(x) && prodHost(x.slice(x.indexOf('=') + 1)));
const migrateRemote = (w, prefix = []) => {
  if (!MIGRATE_TOOL.has(w[0]) || w.includes('--help') || w.includes('-h') || w.includes('--version')) return false;
  const pos = w.slice(1).filter((x) => !x.startsWith('-') && !x.includes('='));
  const changes = pos.some((x) => MIGRATE_CHANGE.test(x)) || pos.at(-1) === 'migrate';
  return changes && (prodTarget(w, prefix) || literalProd(w, prefix));
};
const dockerHostRemote = (v) => !!v && !/^(?:unix|npipe|fd):\/\//.test(v) && remoteHost(v.replace(/^\w+:\/\//, '').replace(/^[^@/]*@/, '').replace(/\/.*$/, ''));
// 보기만 하는 하위 명령(docker ps, docker compose logs, docker image ls …)
const DOCKER_LOOK = /^(?:ps|images|logs|inspect|version|info|stats|top|events|context|ls|list|config|df|port|diff|history|search)$/;
const DOCKER_GROUP = /^(?:compose|image|container|volume|network|system|builder|buildx|plugin|node|service|stack|secret)$/;
const DOCKER_VALUE = /^(?:-H|--host|--context|-c|--config|-l|--log-level)$/;
// 하위 명령 앞의 전역 옵션만 본다(docker run -c 512 의 -c 는 CPU 몫)
const dockerGlobals = (w) => {
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) i += DOCKER_VALUE.test(w[i]) ? 2 : 1;
  return w.slice(0, i);
};
const dockerLooking = (w, at) => {
  if (DOCKER_LOOK.test(w[at] || '')) return true;
  if (!DOCKER_GROUP.test(w[at] || '')) return false;
  // compose -f x.yml logs → 묶음 뒤 옵션과 그 값을 건너뛴 다음 낱말
  return DOCKER_LOOK.test(verbOf(w.slice(at), /^(?:-f|--file|-p|--project-name|--env-file|--profile|--project-directory)$/));
};
const dockerRemote = (w, env = {}) => {
  if (w[0] !== 'docker') return false;
  const g = dockerGlobals(w);
  const ctx = [...optValues(g, '-c', '--context'), env.DOCKER_CONTEXT].filter(Boolean);
  const remote = optValues(g, '-H', '--host').some(dockerHostRemote) || ctx.some((c) => c !== 'default') || dockerHostRemote(env.DOCKER_HOST);
  return remote && !dockerLooking(w, g.length);
};
// 명령 앞의 환경 변수(DOCKER_HOST=… docker, sudo PGHOST=… psql)와 그 도구부터의 낱말. runWords 는 docker run·exec 의
// 이미지·컨테이너 뒤까지 벗겨 docker 를 잃어서 원래 낱말에서 찾는다(검토 2026-11-11). 앞에는 변수·앞붙이 명령·그 옵션만 와야 한다.
const baseName = (x) => String(x).replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
const ENV_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const LEAD = new Set(['sudo', 'doas', 'env', 'command', 'nohup', 'time', 'exec']);
const toolWords = (words, carried) => {
  const at = words.findIndex((x) => baseName(x) === 'docker' || DB_CLIENT.has(baseName(x)));
  if (at < 0 || !words.slice(0, at).every((x) => ENV_WORD.test(x) || LEAD.has(baseName(x)) || x.startsWith('-'))) return null;
  const env = { ...carried };
  for (const x of words.slice(0, at)) if (ENV_WORD.test(x)) env[x.slice(0, x.indexOf('='))] = x.slice(x.indexOf('=') + 1);
  return { w: [baseName(words[at]), ...words.slice(at + 1)], env, prefix: words.slice(0, at) };
};
// 같은 줄 앞 조각의 export DOCKER_HOST=… · $env:DOCKER_HOST = '…'(PowerShell)
const ENV_KEYS = ['DOCKER_HOST', 'DOCKER_CONTEXT', ...DB_HOST_ENV];
const exportsOf = (words) => {
  const out = {};
  if (words[0] === 'export' || words[0] === 'set') for (const x of words.slice(1)) if (ENV_WORD.test(x)) out[x.slice(0, x.indexOf('='))] = x.slice(x.indexOf('=') + 1);
  // PowerShell: $env:X="값"(한 낱말) · $env:X= "값" · $env:X = "값"
  const ps = /^\$env:([A-Za-z_]\w*)(=?)(.*)$/is.exec(words[0] || '');
  if (ps) out[ps[1].toUpperCase()] = (ps[3] ? ps[3] : ps[2] ? words[1] : words[1] === '=' ? words[2] : '') || '';
  const unquote = (v) => String(v).replace(/^(["'])(.*)\1$/s, '$2');
  return Object.fromEntries(Object.entries(out).filter(([k]) => ENV_KEYS.includes(k)).map(([k, v]) => [k, unquote(v)]));
};
const terraformState = (w) => {
  const [group, verb = ''] = plainWords(w, /^$/);
  if (w.includes('-dry-run')) return false;
  return (group === 'state' && /^(?:rm|mv|push|replace-provider)$/.test(verb)) || (group === 'workspace' && verb === 'delete');
};
// Argo CD: 앱을 바꾸는 명령(sync·rollback·delete·set …). get·list·diff·history·logs·manifests·wait 는 보기만(역할극 15 회차, 2026-11-12)
const ARGO_VALUE = /^(?:--server|--auth-token|--config|--argocd-context|--kube-context|--port-forward-namespace|--header|-H|--client-crt|--client-crt-key|--server-crt|--loglevel|--logformat|--http-retry-max|--grpc-web-root-path|--redis-haproxy-name|--repo-server-name|--server-name|--controller-name)$/;
const argoChanges = (w) => {
  const [group, verb = '', sub = ''] = plainWords(w, ARGO_VALUE);
  if (group !== 'app') return false;
  return /^(?:sync|rollback|delete|delete-resource|set|unset|patch|patch-resource|edit|create|terminate-op)$/.test(verb) || (verb === 'actions' && sub === 'run');
};
// Vault: 비밀값 저장소를 바꾸는 명령(write·delete·kv put·patch·delete·destroy·rollback·metadata delete). 값 읽기는 lib/secret-read.mjs
// 값을 받는 옵션은 lib/secret-read.mjs 와 같은 목록(-address 도 --address 도 — 검토 2026-11-12, --address https://v kv put 이 묻지 않고 지나갔다)
const vaultChanges = (w) => {
  const [a, b = '', c = ''] = plainWords(w, VAULT_VALUE);
  if (a === 'write' || a === 'delete') return true;
  return a === 'kv' && (/^(?:put|patch|delete|destroy|undelete|rollback)$/.test(b) || (b === 'metadata' && /^(?:put|patch|delete)$/.test(c)));
};
// kafka-topics.sh·kafka-topics·kafka-topics.bat 를 같은 이름으로
const kafkaName = (x) => String(x || '').replace(/\.(?:sh|bat|cmd)$/i, '');
const kafkaChanges = (w) => {
  const name = kafkaName(w[0]);
  const has = (o) => w.includes(o);
  if (name === 'kafka-topics') return has('--delete');
  if (name === 'kafka-consumer-groups') return (has('--reset-offsets') && has('--execute')) || has('--delete') || has('--delete-offsets');
  if (name === 'kafka-configs') return has('--alter');
  return false;
};
const REMOTE = [
  (w) => w[0] === 'aws' && awsChanges(w),
  (w) => (w[0] === 'gcloud' || w[0] === 'az') && cloudChanges(w),
  (w) => w[0] === 'gsutil' && gsutilChanges(w),
  // ssh 는 버전·설정 보기(-V·-G)만이면 묻지 않는다. scp 는 원격 주소가 있을 때만(아래)
  (w) => ['ssh', 'sftp', 'mosh'].includes(w[0]) && !(w.length === 2 && w[1] === '-V') && !w.includes('-G'),
  (w) => (w[0] === 'rsync' || w[0] === 'scp') && w.slice(1).some(remoteArg),
  // rollout status·history 는 보기만(restart·undo·pause·resume 은 바꾼다 — 검토 2026-11-13)
  (w) => w[0] === 'kubectl' && /^(?:apply|create|delete|replace|patch|edit|scale|autoscale|rollout|set|drain|cordon|uncordon|taint|label|annotate|exec|cp|run|expose|debug)$/.test(verbOf(w, KUBE_VALUE))
    && !(verbOf(w, KUBE_VALUE) === 'rollout' && /^(?:status|history)$/.test(plainWords(w, KUBE_VALUE)[1] || '')),
  (w) => w[0] === 'helm' && /^(?:install|upgrade|uninstall|delete|rollback)$/.test(verbOf(w, HELM_VALUE)),
  // force-unlock: 남이 잡은 상태 잠금을 푼다 — 다른 apply 가 돌고 있으면 상태가 깨진다
  (w) => (w[0] === 'terraform' || w[0] === 'tofu') && /^(?:apply|destroy|import|taint|untaint|force-unlock)$/.test(verbOf(w, /^$/)),
  (w) => w[0] === 'argocd' && argoChanges(w),
  (w) => w[0] === 'vault' && vaultChanges(w),
  // 상태 파일을 바로 고치기(state rm·mv·push)·워크스페이스 지우기 — 원격 상태 저장소의 기록이 바뀐다(-dry-run 은 보기만)
  (w) => (w[0] === 'terraform' || w[0] === 'tofu') && terraformState(w),
  // Kafka 관리 도구(클러스터가 어디든): 토픽 지우기, 오프셋 되돌리기(--execute 일 때만 — 없으면 보기만), 그룹 지우기, 설정 바꾸기
  (w) => kafkaChanges(w),
  // ansible-playbook(--check·--syntax-check 는 보기만), 모듈을 바로 돌리는 ansible <호스트> -m …
  (w) => w[0] === 'ansible-playbook' && !w.some((x) => x === '--check' || x === '-C' || x === '--syntax-check' || x === '--list-hosts'),
  (w) => w[0] === 'ansible' && w.some((x) => x === '-m' || x === '-a' || x.startsWith('--module-name')),
];
// 보기만 하는 꼴(--dry-run)은 묻지 않는다(kubectl apply --dry-run=client, helm upgrade --dry-run)
export const dryRun = (w) => w.some((x) => x === '--dry-run' || (x.startsWith('--dry-run=') && x !== '--dry-run=none'));

// 한 명령 조각이 원격·운영에 닿는가. words: 조각의 원래 낱말, line: 앞붙이를 벗긴 낱말(runWords), carried: 앞 조각에서 export 한 변수
// 도움말·버전 보기(terraform apply -help·kubectl delete --help)는 묻지 않는다 — 묻기 목록과 같은 justLooking(lib/ask-match.mjs).
// 원격에서 명령을 돌리는 ssh 계열과 -- 뒤 명령(kubectl exec … -- x --help)은 그 --help 가 원격 명령의 것이라 빼지 않는다
const REMOTE_SHELL = new Set(['ssh', 'sftp', 'mosh', 'scp', 'rsync']);
const helpLook = (w) => w.length > 0 && !REMOTE_SHELL.has(w[0]) && !w.includes('--') && justLooking(w);
export const remoteCommand = (words, line, carried = {}) => {
  const bare = words.length ? [baseName(words[0]), ...words.slice(1)] : [];
  // 벗기기 전 낱말로도 본다 — runWords 가 kubectl exec … -- 를 벗겨 안쪽 명령의 --help 만 남는다
  if (helpLook(bare) && (!line.length || helpLook(line))) return false;
  if (line.length && !dryRun(line) && (REMOTE.some((f) => f(line)) || REMOTE.some((f) => f(bare)))) return true;
  const tool = toolWords(words, carried);
  if (tool && !dryRun(tool.w) && (dockerRemote(tool.w, tool.env) || dbRemote(tool.w, tool.env, tool.prefix))) return true;
  // 값이 있는 앞붙이(sudo -u root·timeout 30·npx·uv run …) 뒤의 docker·DB 클라이언트는 벗긴 낱말로 본다 — 앞의 변수=값도 함께
  // (toolWords 만 보다가 이 꼴을 놓치던 d8ea85f 회귀 — 검토 2026-11-11)
  if (!line.length || dryRun(line)) return false;
  const at = words.findIndex((x) => baseName(x) === line[0]);
  const env = { ...carried };
  const prefix = words.slice(0, at < 0 ? 0 : at);
  for (const x of prefix) if (ENV_WORD.test(x)) env[x.slice(0, x.indexOf('='))] = x.slice(x.indexOf('=') + 1);
  return dockerRemote(line, env) || dbRemote(line, env, prefix) || migrateRemote(line, prefix);
};

export { tagPush, followTagsOn, withFollowTags } from './tag-push.mjs';
export { exportsOf };

// 이 Mac 의 프로비저닝 프로필 폴더를 지우기(rm -rf ~/Library/MobileDevice/Provisioning\ Profiles/* — 역할극 16 회차 정답지 M3, 2026-11-13).
// 원격은 아니지만 Xcode 서명이 모두 깨지는 「실제 장비」 쪽 일이라 원격 묻기와 함께 묻는다. 지우는 대상은 lib/shell-writes.mjs 가 읽는다(rm·Remove-Item·mv 의 보내는 쪽)
const PROFILES = /(?:^|[\\/])Library[\\/]+MobileDevice[\\/]+Provisioning Profiles(?=[\\/"'*\s]|$)/i;
// shellWrites 는 $HOME 처럼 변수가 든 경로를 「모름」으로 뺀다 — 이 폴더는 이름이 정해져 있어 지우는 명령의 인자를 글자로도 본다
const WIPE_CMD = new Set(['rm', 'rmdir', 'unlink', 'trash', 'remove-item', 'ri', 'del', 'rd', 'erase']);
export const profilesWipe = (raw, shell, words = []) => {
  if (!PROFILES.test(String(raw).replace(/\\ /g, ' '))) return false;
  if (shellWrites(raw, shell).some((w) => w.op === 'delete' && PROFILES.test(String(w.file)))) return true;
  const w = words.filter((x) => !LEAD.has(baseName(x)) && !ENV_WORD.test(x));
  // 역슬래시로 띄운 이름(Provisioning\ Profiles)은 낱말 둘로 갈려 온다 — 이어 붙여 본다
  return WIPE_CMD.has(baseName(w[0] || '')) && PROFILES.test(w.slice(1).join(' ').replace(/\\ /g, ' '));
};
