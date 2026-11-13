// 독립 검토(2026-11-13)가 찾은 막기·묻기 빈틈: 시험 실행 표시를 무시하는 막기, 앞붙이·블록·백틱·파이프로 넘긴 글·find -exec 로 숨긴 막을 명령,
// PowerShell Start-Process·cmd /c·스크립트 블록, 비밀값 읽기와 도구 이름만 적은 묻는 명령, JDBC·파일 DB 주소, plist·python·ruby 쓰기의 다른 꼴.
// strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import { S, B, P } from './helpers.mjs';

const BL = { commands: [], block: ['terraform apply', 'make apply-prod', 'kubectl --context prod-payments', 'scripts/drain-node.sh'], remote: false };
const DENY = { decision: 'deny', reason: /blocked from running/ };
const deny = (opts = BL) => ({ opts, ...DENY });
const ask = (opts) => ({ opts, decision: 'ask' });
// 컨텍스트만 적은 묻는 명령(원격 묻기 끔·켬), 도구 이름만 적은 묻는 명령
const CTX = { commands: ['kubectl --context prod', 'helm --kube-context prod'], remote: false };
const CTX_REMOTE = { commands: ['helm --kube-context prod'] };
const BARE = { commands: ['kubectl'], remote: false };
const TF_ASK = { commands: ['terraform apply'], remote: false };
const REMOTE = { commands: [] };
const PLIST = { paths: ['Ggumi/Info.plist', 'data/'] };

export default {
  'ask-cmd': {
    block: [
      // 1. 시험 실행 표시는 막기에서 보지 않는다
      B('DRY_RUN=1 terraform apply -auto-approve', 'DRY_RUN=1', deny()),
      B('DRYRUN=true kubectl --context prod-payments delete ns payments', 'DRYRUN=true', deny()),
      S('scripts/drain-node.sh --dry-run ip-10-0-1-5', '스크립트 --dry-run', deny()),
      S('scripts/drain-node.sh --plan ip-10-0-1-5', '스크립트 --plan', deny()),
      S('scripts/drain-node.sh ip-10-0-1-5 --version', '인자 뒤 --version', deny()),
      S('kubectl --context prod-payments delete ns payments --dry-run=server', 'kubectl --dry-run=server', deny()),
      // 2. 앞붙이·블록·숨은 실행
      B('exec terraform apply', 'exec', deny()),
      B('builtin command terraform apply', 'builtin command', deny()),
      B('{ terraform apply; }', '{ …; } 묶음', deny()),
      B('echo `terraform apply`', '백틱', deny()),
      B('echo "now: `terraform apply`"', '큰따옴표 속 백틱', deny()),
      B('eval terraform apply -auto-approve', '따옴표 없는 eval', deny()),
      B('echo apply | xargs terraform', 'xargs 가 낱말을 붙임', deny()),
      B('xargs -n1 terraform apply < targets.txt', 'xargs 옵션 뒤', deny()),
      B('find . -maxdepth 0 -exec terraform apply \\;', 'find -exec', deny()),
      B('source scripts/drain-node.sh', 'source', deny()),
      B('. scripts/drain-node.sh', '점(.)으로 읽기', deny()),
      B('bash -x scripts/drain-node.sh ip-10-0-1-5', 'bash -x', deny()),
      B('sh -e scripts/drain-node.sh', 'sh -e', deny()),
      S('gmake apply-prod', 'gmake', deny()),
      B('echo "terraform apply" | bash', 'echo … | bash', deny()),
      B("printf 'terraform apply\\n' | sh", 'printf … | sh', deny()),
      B('bash <<<"terraform apply"', 'here-string', deny()),
      B('if true; then terraform apply; fi', 'if … then', deny()),
      P('Start-Process terraform -ArgumentList apply', 'Start-Process -ArgumentList', deny()),
      P('Start-Process -FilePath terraform -ArgumentList "apply","-auto-approve" -Wait', 'Start-Process -FilePath', deny()),
      P('cmd /c terraform apply', '따옴표 없는 cmd /c', deny()),
      P('& { terraform apply }', '& { } 스크립트 블록', deny()),
      P('if ($true) { terraform apply }', 'if 블록', deny()),
      P('"terraform apply" | iex', '글을 iex 로', deny()),
      // 3. 비밀값 읽기는 읽기로 치지 않는다(막기)
      S('kubectl --context prod-payments get secret db -o yaml', 'get secret 막기', deny()),
      S('kubectl --context prod-payments get --raw /api/v1/namespaces/default/secrets/db', '--raw 의 secrets', deny()),
      // 4. 묻기: 비밀값 읽기, 도구 이름만 적은 목록
      S('kubectl --context prod get secret x -o yaml', 'get secret -o yaml', ask(CTX)),
      B('kubectl --context prod get secret x -o jsonpath={.data.password} | base64 -d', 'jsonpath | base64 -d', ask(CTX)),
      S('kubectl --context prod get secrets -A -o json', 'get secrets -A', ask(CTX)),
      S('kubectl --context prod get --raw /api/v1/namespaces/default/secrets/db', 'get --raw secrets', ask(CTX)),
      S('kubectl --context prod describe secret db', 'describe secret', ask(CTX)),
      S('kubectl --context prod get pods,secrets', '쉼표로 이은 자원', ask(CTX)),
      S('helm --kube-context prod get values api --all', 'helm get values', ask(CTX)),
      S('helm --kube-context prod get manifest api', 'helm get manifest', ask(CTX)),
      S('helm --kube-context prod get values api -o yaml', '원격 묻기 켬에서도 helm get values', ask(CTX_REMOTE)),
      S('kubectl get pods', '도구 이름만 적으면 읽기도', ask(BARE)),
      // 묻기도 숨은 실행을 본다
      B('echo "terraform apply" | bash', '묻기: echo … | bash', ask(TF_ASK)),
      B('echo `terraform apply`', '묻기: 백틱', ask(TF_ASK)),
      B('exec terraform apply', '묻기: exec', ask(TF_ASK)),
      // 5. JDBC 주소의 운영 호스트
      S('flyway -url=jdbc:postgresql://db.prod.internal:5432/app migrate', 'flyway jdbc:', ask(REMOTE)),
      S('liquibase --url=jdbc:postgresql://db.prod.internal/app update', 'liquibase jdbc:', ask(REMOTE)),
    ],
    pass: [
      // 도움말·버전은 그 낱말 하나만 더 붙은 꼴만
      S('terraform apply -help', 'terraform -help', { opts: BL }),
      S('terraform apply -h', '-h 하나', { opts: BL }),
      S('terraform apply --version', '--version 하나', { opts: BL }),
      S('scripts/drain-node.sh --help', '스크립트 --help', { opts: BL }),
      // 글일 뿐인 것
      S('git commit -m "terraform apply"', '커밋 메시지', { opts: BL }),
      S('echo terraform apply', 'echo 인자', { opts: BL }),
      S('cat scripts/drain-node.sh', '스크립트 읽기', { opts: BL }),
      B('cat <<EOF > notes.md\nterraform apply\nEOF', 'heredoc 을 파일로', { opts: BL }),
      B("git commit -m \"$(cat <<'EOF'\ndocs: `terraform apply` 는 사람이\nEOF\n)\"", '따옴표 친 heredoc 속 백틱', { opts: BL }),
      B("grep -n '`terraform apply`' README.md", '작은따옴표 속 백틱', { opts: BL }),
      B('echo apply | xargs echo terraform', 'xargs 뒤 다른 프로그램', { opts: BL }),
      B('find . -name "*.tf" -exec cat {} \\;', 'find -exec 다른 명령', { opts: BL }),
      B('bash -c "echo terraform apply"', 'bash -c 속 echo', { opts: BL }),
      // 컨텍스트를 적은 묻는 명령의 보통 읽기는 그대로 묻지 않는다
      S('kubectl --context prod get pods', 'get pods', { opts: CTX }),
      S('kubectl --context prod get configmap app -o yaml', 'configmap', { opts: CTX }),
      S('helm --kube-context prod list -A', 'helm list', { opts: CTX }),
      S('helm --kube-context prod status api', 'helm status', { opts: CTX }),
      // 묻기는 시험 실행을 그대로 묻지 않는다
      B('DRY_RUN=1 terraform apply', '묻기의 DRY_RUN=1', { opts: TF_ASK }),
      // 파일 DB 는 호스트가 아니다
      S('migrate -database sqlite3://prod.db -path m up', 'sqlite3 파일', { opts: REMOTE }),
      S('flyway -url=jdbc:postgresql://localhost:5432/app migrate', 'jdbc localhost', { opts: REMOTE }),
    ],
  },

  'protected-files': {
    block: [
      S('plutil -replace CFBundleVersion -string 42 Ggumi/Info.plist -s', 'plutil 파일 뒤 옵션', { opts: PLIST }),
      S('plutil -create xml1 Ggumi/Info.plist', 'plutil -create', { opts: PLIST }),
      S('plutil -extract K xml1 -o Ggumi/Info.plist Other.plist', 'plutil -extract -o', { opts: PLIST }),
      S("python3.12 -c \"open('Ggumi/Info.plist','w').write('x')\"", 'python3.12 -c', { opts: PLIST }),
      S("py -c \"open('Ggumi/Info.plist','w')\"", 'py -c', { opts: PLIST }),
      S("python -c \"open(file='Ggumi/Info.plist', mode='w')\"", 'open(file=, mode=)', { opts: PLIST }),
      S("python -c \"import os; os.remove('Ggumi/Info.plist')\"", 'os.remove', { opts: PLIST }),
      S("python -c \"import shutil; shutil.rmtree('data')\"", 'shutil.rmtree', { opts: PLIST }),
      S("python -c \"import shutil; shutil.move('Ggumi/Info.plist', 'x.plist')\"", 'shutil.move 원본', { opts: PLIST }),
      S("ruby -i -pe \"gsub(/a/,'b')\" Ggumi/Info.plist", 'ruby -i', { opts: PLIST }),
      S("ruby -e \"IO.write('Ggumi/Info.plist', 'x')\"", 'IO.write', { opts: PLIST }),
    ],
    pass: [
      S('plutil -extract CFBundleVersion raw Ggumi/Info.plist', 'plutil -extract 화면', { opts: PLIST }),
      S('plutil -extract K xml1 -o - Ggumi/Info.plist', 'plutil -extract -o -', { opts: PLIST }),
      S("python -c \"import os; os.remove('tmp.txt')\"", '다른 파일 지우기', { opts: PLIST }),
      S("ruby -i -pe \"gsub(/a/,'b')\" notes.txt", '다른 파일 제자리 고치기', { opts: PLIST }),
      S("python3.12 -c \"print(open('Ggumi/Info.plist').read())\"", 'python3.12 읽기', { opts: PLIST }),
    ],
  },
};
