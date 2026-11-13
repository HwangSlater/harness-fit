// 역할극 15 회차(인프라 저장소, 2026-11-12)에서 나온 꼴: 보호 경로 글롭(* · **), Argo CD·Vault·terraform force-unlock, 비밀값을 찍는 명령.
// strict.test.mjs 가 followup.mjs 처럼 같은 훅의 사례에 이어 붙인다. 사례마다 opts 를 따로 준다.
import { S, B, P, W, E, keyed } from './helpers.mjs';

const INFRA = { paths: ['*.tfstate*', 'kubeconfig*', '*.tfplan', '.terraform/', '.vault_pass*', 'infra/**/*.tfvars', 'secrets/*.json'] };
const o = (extra = {}) => ({ opts: INFRA, ...extra });

// 상태 파일·kubeconfig 가 든 저장소(지우기·커밋 사례)
const infraRepo = keyed('infra-files', (r) => {
  r.commit('infra/prod/main.tf', 'x\n', 'chore: tf');
  r.put('infra/prod/terraform.tfstate.backup', '{}\n');
  r.put('ops/kubeconfig-prod', 'x\n');
  r.put('docs/a.md', 'x\n');
});
const tfvarsChanged = keyed('infra-tfvars', (r) => {
  r.commit('infra/env/prod/app.tfvars', 'a = 1\n', 'chore: tfvars');
  r.put('infra/env/prod/app.tfvars', 'a = 2\n');
});
const newState = keyed('infra-newstate', (r) => r.put('terraform.tfstate.backup', '{}\n'));
const looseRepo = keyed('infra-loose', (r) => {
  r.put('infra/modules/vpc/main.tf', 'x\n');
  r.put('README2.md', 'x\n');
});
// terraform output 이름: sensitive 로 적은 것만 묻는다
const TF_OUT = 'output "vpc_id" {\n  value = aws_vpc.main.id\n}\n\noutput "db_password" {\n  value     = random_password.db.result\n  sensitive = true\n}\n';
const tfRepo = keyed('infra-tf-out', (r) => {
  r.put('outputs.tf', TF_OUT);
  r.put('infra/outputs.tf', TF_OUT);
});
const tf = { setup: tfRepo };

export default {
  'protected-files': {
    block: [
      W('terraform.tfstate.backup', '{}', '*.tfstate* — 뒤에 .backup 이 붙은 상태 파일', o()),
      W('infra/prod/terraform.tfstate', '{}', '/ 없는 꼴은 어느 깊이든', o()),
      W('kubeconfig-prod', 'x', 'kubeconfig* — 뒤에 -prod', o()),
      W('ops/kubeconfig', 'x', '폴더 안의 kubeconfig', o()),
      W('plans/prod.tfplan', 'x', '*.tfplan', o()),
      W('ansible/.vault_pass', 'x', '.vault_pass* — 점으로 시작해도 글롭이면 이름으로', o()),
      W('ansible/.vault_pass.txt', 'x', '.vault_pass* 뒤에 확장자', o()),
      W('.terraform/providers/lock.json', 'x', '.terraform/ 폴더(맨 위)', o()),
      W('infra/env/prod/app.tfvars', 'a = 1', 'infra/**/*.tfvars — 여러 깊이', o()),
      W('infra/app.tfvars', 'a = 1', '** 는 마디 0개도', o()),
      W('secrets/db.json', '{}', 'secrets/*.json(맨 위 기준)', o()),
      E('kubeconfig-prod', 'a', 'b', 'Edit 도 같은 맞추기', o()),
      S('echo x > terraform.tfstate.backup', '셸 넘겨쓰기', o()),
      S('rm -f infra/prod/terraform.tfstate.backup', '셸 지우기', o()),
      S('cp /tmp/k ops/kubeconfig-staging', 'cp 받는 쪽', o()),
      P('Remove-Item ops\\kubeconfig-prod', 'PowerShell 역슬래시 경로', o()),
      P('Set-Content -Path ansible/.vault_pass -Value x', 'PowerShell Set-Content', o()),
      // 글롭 보호 경로를 품은 폴더 지우기는 안의 실제 파일로 본다
      S('rm -rf infra', '안에 terraform.tfstate.backup 이 있는 폴더', o({ setup: infraRepo })),
      S('rm -rf ops', '안에 kubeconfig-prod 가 있는 폴더', o({ setup: infraRepo })),
      P('Remove-Item -Recurse -Force infra', 'PowerShell 폴더 지우기', o({ setup: infraRepo })),
      S('mv infra infra-old', 'mv 로 옮기면 원래 자리가 사라짐', o({ setup: infraRepo })),
      // 커밋에 넣기
      S('git add terraform.tfstate.backup', 'git add 글롭 보호 파일', o({ setup: newState })),
      S('git add -A', 'git add -A 에 섞인 상태 파일', o({ setup: newState })),
      S('git commit -am "chore: 값"', 'commit -a 가 고친 tfvars', o({ setup: tfvarsChanged })),
      S('git add infra', '폴더 add 가 고친 tfvars', o({ setup: tfvarsChanged })),
    ],
    pass: [
      W('docs/terraform-state.md', 'x', '이름에 tfstate 가 없는 문서', o()),
      W('infra/tfstate.md', 'x', '*.tfstate* 는 점 앞에 글자가 있어야(.tfstate 앞)', o()),
      W('docs/kubeconfig.md', 'x', 'kubeconfig-* 는 kubeconfig.md 에 안 맞음', { opts: { paths: ['kubeconfig-*'] } }),
      W('plans/prod.tfplan.md', 'x', '*.tfplan 은 끝까지 맞아야', o()),
      W('infra/.terraform.lock.hcl', 'x', '.terraform/ 는 폴더만(잠금 파일은 커밋한다)', o()),
      W('modules/.terraform/x', 'x', '끝이 / 인 꼴은 맨 위 기준', o()),
      W('x/infra/app.tfvars', 'a = 1', '/ 가 든 꼴은 맨 위 기준', o()),
      W('secrets/sub/db.json', '{}', '* 는 / 를 넘지 않음', o()),
      W('ansible/vault_pass', 'x', '점 없는 이름', o()),
      S('rm -rf infra/modules', '보호 파일이 없는 폴더(실제로 훑음)', o({ setup: looseRepo })),
      S('rm -rf docs', '보호 파일이 없는 다른 폴더', o({ setup: infraRepo })),
      S('rm -f README2.md', '보호 꼴에 안 맞는 파일', o({ setup: looseRepo })),
      S('cat infra/prod/terraform.tfstate.backup', '읽기만', o({ setup: infraRepo })),
      S('git add docs/a.md', '보호 꼴에 안 맞는 add', o({ setup: infraRepo })),
    ],
  },

  'ask-cmd': {
    block: [
      S('argocd app sync payments-prod', 'argocd app sync'),
      S('argocd --server cd.example.com app rollback payments 3', 'argocd 전역 옵션 값 뒤 rollback'),
      S('argocd app delete payments --cascade', 'argocd app delete'),
      S('argocd app set payments --revision v2', 'argocd app set'),
      S('argocd app terminate-op payments', 'argocd app terminate-op'),
      S('argocd app actions run payments restart --kind Deployment', 'argocd app actions run'),
      S('terraform force-unlock 1234-abcd', 'terraform force-unlock'),
      S('terraform -chdir=infra force-unlock -force 1234', '-chdir 뒤 force-unlock'),
      S('vault kv put secret/app password=x', 'vault kv put'),
      S('vault write auth/token/create policies=admin', 'vault write'),
      // 비밀값을 찍는 명령
      S('aws secretsmanager get-secret-value --secret-id prod/db', 'Secrets Manager 값 읽기'),
      S('aws --profile prod secretsmanager get-secret-value --secret-id x --query SecretString --output text', 'aws 전역 옵션 뒤'),
      S('aws ssm get-parameter --name /prod/db/pass --with-decryption', 'SSM 복호화 읽기'),
      S('aws ssm get-parameters-by-path --path /prod --recursive --with-decryption', 'SSM 경로째 복호화'),
      S('kubectl get secret db-pass -o yaml', 'kubectl get secret -o yaml'),
      S('kubectl -n prod get secrets -o json', 'kubectl get secrets -o json'),
      S('kubectl get secret/db-pass -ojsonpath={.data.password}', '-o 붙여 쓴 jsonpath'),
      B("kubectl get secret db-pass -o jsonpath='{.data.password}' | base64 -d", 'jsonpath + base64 풀기'),
      P("kubectl get secret db-pass -o jsonpath='{.data.password}'", 'PowerShell jsonpath'),
      S('kubectl get secret db-pass --output=go-template={{.data}}', '--output= go-template'),
      S('kubectl get configmap,secret -n prod -o yaml', '쉼표로 묶은 종류'),
      S('kubectl view-secret db-pass password', 'view-secret 플러그인'),
      S('terraform output -raw db_password', 'terraform output -raw sensitive 이름', tf),
      S('terraform output db_password', '이름으로 고르면 sensitive 도 그대로 찍힌다', tf),
      S('terraform -chdir=infra output -raw db_password', '-chdir 폴더의 .tf', tf),
      S('terraform output -raw db_password', '.tf 가 없으면 모르니 묻는다'),
      S('terraform output -json', 'terraform output -json(sensitive 도 그대로)', tf),
      S('tofu output -raw db_password', 'tofu output -raw', tf),
      S('gcloud secrets versions access latest --secret=db-pass', 'gcloud secrets versions access'),
      S('az keyvault secret show --vault-name kv-prod --name db-pass', 'az keyvault secret show'),
      S('vault kv get secret/app', 'vault kv get'),
      S('vault kv get -field=password secret/app', 'vault kv get -field'),
      S('vault read database/creds/app', 'vault read'),
      S('sudo vault read secret/x', 'sudo 앞붙이'),
      P('aws.exe secretsmanager get-secret-value --secret-id x', 'PowerShell aws.exe'),
    ],
    pass: [
      S('argocd app get payments', 'argocd app get'),
      S('argocd app list', 'argocd app list'),
      S('argocd app diff payments', 'argocd app diff'),
      S('argocd app history payments', 'argocd app history'),
      S('argocd app sync payments --dry-run', 'argocd --dry-run'),
      S('terraform plan', 'terraform plan'),
      S('terraform output', 'terraform output(sensitive 는 가림)'),
      S('terraform output vpc_id', 'sensitive 아닌 이름', tf),
      S('terraform output -raw vpc_id', '-raw 라도 sensitive 아닌 이름', tf),
      S('terraform -chdir=infra output -json vpc_id', '-chdir + sensitive 아닌 이름', tf),
      S('aws secretsmanager list-secrets', '목록만'),
      S('aws secretsmanager describe-secret --secret-id x', '설명만(값 없음)'),
      S('aws ssm get-parameter --name /prod/region', '복호화 없이(평문 값)'),
      S('kubectl get secrets', '표(이름·종류·개수)'),
      S('kubectl get secret db-pass', '이름 하나 표'),
      S('kubectl get secrets -o name', '-o name'),
      S('kubectl get secrets -o wide', '-o wide'),
      S('kubectl describe secret db-pass', 'describe 는 키 이름과 크기만'),
      S('kubectl get pods -o yaml', '비밀값 아닌 종류'),
      S('kubectl get configmap app -o yaml', 'configmap'),
      S('gcloud secrets list', 'gcloud secrets list'),
      S('gcloud secrets versions list db-pass', 'versions list'),
      S('az keyvault secret list --vault-name kv-prod', 'keyvault secret list'),
      S('vault kv list secret/', 'vault kv list'),
      S('vault kv metadata get secret/app', 'kv metadata get'),
      S('vault status', 'vault status'),
      S('vault kv get --help', '도움말'),
      S('grep -rn "vault read" docs', '검색어 속 글'),
      S('git commit -m "docs: kubectl get secret -o yaml 안내"', '커밋 메시지 속 글'),
    ],
  },
};
