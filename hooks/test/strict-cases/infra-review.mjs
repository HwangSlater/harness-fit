// 역할극 15 회차(인프라) 독립 검토에서 나온 헛막음·헛물음과 놓침(2026-11-12).
// 도구가 만드는 폴더 지우기, 값을 찍지 않고 넘기는 비밀값 명령, vault --옵션, 앞이 / 인 보호 경로.
import { S, B, P, W, keyed } from './helpers.mjs';

const TF = { paths: ['*.tfstate*', 'kubeconfig*'] };
const o = (extra = {}) => ({ opts: TF, ...extra });

// terraform init 이 만든 .terraform/terraform.tfstate(백엔드 정보)와 번들러 결과
const toolRepo = keyed('review-tool-dirs', (r) => {
  r.put('.terraform/terraform.tfstate', '{}\n');
  r.put('envs/prod/.terraform/terraform.tfstate', '{}\n');
  r.put('envs/prod/main.tf', 'x\n');
  // dist 는 흔한 이름이라 git 이 무시할 때만 안을 건너뛴다(두 번째 검토 2026-11-12)
  r.put('.gitignore', 'dist/\n');
  r.put('dist/assets/kubeconfig-ABCD.js', 'x\n');
  r.put('web/node_modules/kubeconfig-x/index.js', 'x\n');
});
// 같은 폴더에 진짜 상태 파일도 있다
const realState = keyed('review-real-state', (r) => {
  r.put('envs/prod/.terraform/terraform.tfstate', '{}\n');
  r.put('envs/prod/terraform.tfstate', '{}\n');
});
// 훑는 수 한도와 너비 우선은 hooks/test/path-glob.test.mjs 가 작은 한도로 본다(파일 5,000개를 만들지 않으려고)
const topKube = keyed('review-top-kube', (r) => {
  r.put('internal/kubeconfig.go', 'package internal\n');
  r.put('kubeconfig-prod', 'x\n');
});

const LEAD = { paths: ['/kubeconfig*', '/secrets.yml', '/kubeconfig', '/data/'] };
const lead = (extra = {}) => ({ opts: LEAD, ...extra });

export default {
  'protected-files': {
    block: [
      S('rm -rf envs/prod', '도구 폴더 밖의 진짜 terraform.tfstate', o({ setup: realState })),
      S('rm -rf .terraform', '꼴이 .terraform 을 마디로 적었으면 안을 본다', { opts: { paths: ['.terraform/*.tfstate'] }, setup: toolRepo }),
      // 앞이 / 인 경로는 맨 위 기준
      W('kubeconfig-prod', 'x', '/kubeconfig* — 맨 위', lead()),
      W('kubeconfig', 'x', '/kubeconfig — 맨 위 파일', lead()),
      W('kubeconfig/prod.yaml', 'x', '/kubeconfig — 맨 위 폴더 안', lead()),
      W('secrets.yml', 'x', '/secrets.yml', lead()),
      W('data/a.csv', 'x', '/data/ — 앞뒤 / 폴더', lead()),
      S('rm -f kubeconfig-prod', '셸로 지우기', lead({ setup: topKube })),
      P('Remove-Item kubeconfig-prod', 'PowerShell 지우기', lead({ setup: topKube })),
    ],
    pass: [
      S('rm -rf .terraform', 'terraform init 이 만든 .terraform/terraform.tfstate', o({ setup: toolRepo })),
      S('rm -rf envs/prod/.terraform && terraform init', '하위 폴더의 .terraform', o({ setup: toolRepo })),
      S('rm -rf envs', '안의 .terraform 에만 맞는 것이 있다', o({ setup: toolRepo })),
      S('rm -rf dist', '번들러가 만든 kubeconfig-ABCD.js', o({ setup: toolRepo })),
      S('rm -rf web', '안의 node_modules 에만 맞는 것', o({ setup: toolRepo })),
      P('Remove-Item -Recurse -Force .terraform', 'PowerShell 로 .terraform 지우기', o({ setup: toolRepo })),
      W('internal/kubeconfig.go', 'package internal', '/kubeconfig* 는 하위 폴더에 안 맞음', lead()),
      W('pkg/kubeconfig/loader.go', 'package kubeconfig', '/kubeconfig 는 하위 폴더 이름에 안 맞음', lead()),
      W('config/secrets.yml', 'x', '/secrets.yml 은 맨 위만', lead()),
      W('src/data/a.csv', 'x', '/data/ 는 맨 위만', lead()),
      S('rm -rf internal', '하위 폴더의 kubeconfig.go', lead({ setup: topKube })),
      W('docs/tfstate-notes.md', 'x', '*.tfstate · *.tfstate.* 는 점이 앞에 있어야', { opts: { paths: ['*.tfstate', '*.tfstate.*'] } }),
      S('rm -rf .terraform', '*.tfstate · *.tfstate.* 꼴도 .terraform 안은 안 봄', { opts: { paths: ['*.tfstate', '*.tfstate.*'] }, setup: toolRepo }),
    ],
  },

  'ask-cmd': {
    block: [
      S('vault --address https://vault.example.com:8200 kv get secret/app', 'vault --옵션 값 뒤 kv get'),
      S('vault --address=https://vault.example.com:8200 kv get secret/app', 'vault --옵션=값'),
      S('vault --address https://vault.example.com:8200 kv put secret/app a=b', 'vault --옵션 값 뒤 kv put'),
      S('vault --namespace team kv delete secret/app', 'vault --namespace'),
      S('vault read sys/raw/core/keyring', 'sys/raw 는 저장소 날것'),
      S('kubectl get secret app -o yaml | cat', '찍는 도구로 넘기기'),
      S('kubectl get secret app -o yaml | yq .data', 'yq'),
      S('kubectl get secret app -o json | jq .data', 'jq'),
      S('kubectl get secret app -o yaml | tee backup.yaml', 'tee 는 화면에도 찍는다'),
      S('kubectl get secret app -o yaml | head -n 20', 'head'),
      S('kubectl get secret app -o yaml 2>/dev/null', '오류만 버림'),
      S('kubectl get secret app -o yaml >&2', '오류 출력으로 — 화면에 남는다'),
      S('echo $(aws secretsmanager get-secret-value --secret-id x)', 'echo 가 받아 찍음'),
      S('terraform output -json 2>/dev/null', '2> 를 output 이름으로 읽지 않음'),
      S('kubectl get secret/app configmap/b -o yaml', '종류/이름 꼴은 어디에 있어도'),
      P('kubectl get secret app -o yaml | ConvertFrom-Json', 'PowerShell 에서 찍는 cmdlet'),
      P('kubectl get secret app -o yaml | Select-String password', 'Select-String'),
    ],
    pass: [
      S('kubectl get secret app -o yaml | kubeseal -o yaml', 'kubeseal 로 넘김(봉인된 것만 찍힘)'),
      S('kubectl get secret app -o yaml > backup.yaml', '파일로'),
      S('kubectl get secret app -o yaml >> backup.yaml', '파일에 덧붙이기'),
      S('terraform output -json > outputs.json', 'terraform output -json 을 파일로'),
      S('export DB=$(aws secretsmanager get-secret-value --secret-id x --query SecretString --output text)', '$( ) 로 받기'),
      S("kubectl get secret app -o jsonpath='{.data.password}' | base64 -d > pass.txt", '풀어서 파일로'),
      B('DB=`vault kv get -field=password secret/app`', '백틱으로 받기'),
      P('kubectl get secret app -o yaml | Out-File backup.yaml', 'PowerShell Out-File'),
      P('$s = kubectl get secret app -o yaml', 'PowerShell 변수로 받기'),
      S('kubectl get configmap secrets -o yaml', 'configmap 이름이 secrets'),
      S('kubectl get pod secret -o yaml', 'pod 이름이 secret'),
      S('kubectl get secret -o jsonpath={.items[*].metadata.name}', '이름만 꺼내는 jsonpath'),
      S('kubectl get secret app -o custom-columns=NAME:.metadata.name,TYPE:.type', '이름·종류 열'),
      S('vault read sys/health', 'vault 서버 상태'),
      S('vault read sys/mounts', 'mounts'),
      S('vault read sys/policies/acl/app', '정책'),
      S('vault --address https://vault.example.com:8200 status', 'vault --옵션 뒤 status'),
      S('vault --address https://vault.example.com:8200 kv list secret/', 'vault --옵션 뒤 kv list'),
    ],
  },
};
