// v0.4.1 두 번째 검토(2026-11-16): 헛물음을 줄이며 느슨해진 검사가 진짜 비밀·운영 고침을 놓치던 것(73f1c76 이전보다 덜 묻던 회귀).
// iac-edit: 파일 이름 속 _test·dev, modules/ 밑 dev-, 운영 낱말(prd·live)이 시험·개발 자리보다 앞섬, JSON 꼴 Argo CD.
// protected-files askRead: .pem 끝의 키, ../ 로 빠져나간 시험 자료 경로, kubeconfig.txt, 가운데 낀 .tpl, 틀 속 진짜 값, Chart.yaml 없는 templates/.
// strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import { B, W, R, keyed, FAKE } from './helpers.mjs';

const ask = (extra = {}) => ({ decision: 'ask', ...extra });
const RDS = (body) => `resource "aws_db_instance" "main" {\n  engine = "postgres"\n${body}}\n`;
const SG = (port) => `resource "aws_security_group" "db" {\n  ingress {\n    from_port   = ${port}\n    to_port     = ${port}\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n`;
const AUTO = '  syncPolicy:\n    automated:\n      prune: true\n';
const app = (api) => `apiVersion: ${api}\nkind: Application\nmetadata:\n  name: api\nspec:\n${AUTO}`;
const jsonApp = (prune) => ({ apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name: 'api' }, spec: { syncPolicy: { automated: { prune } } } });

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const KEY_BLOCK = `${FAKE.privateKey}\nx\n-----END RSA PRIVATE KEY-----\n`;
const FILES = keyed('v041r2-files', (r) => {
  // HAProxy·nginx 묶음: 인증서 여러 개(4KB 넘게) 뒤 맨 끝에 키
  r.put('certs/haproxy.pem', `${CERT.repeat(200)}${KEY_BLOCK}`);
  // 1MB 넘는 .pem 은 다 읽지 않고 묻는다
  r.put('certs/huge.pem', CERT.repeat(30000));
  r.put('certs/bundle.pem', CERT.repeat(200));
  r.put('kubeconfig.txt', 'apiVersion: v1\nusers:\n- name: a\n  user:\n    client-key-data: QUJD\n');
  r.put('deploy/prod.tpl.key', KEY_BLOCK);
  r.put('deploy/server.key.example', KEY_BLOCK);
  r.put('deploy/client.key.example', '# 여기에 키를 넣으세요\n');
  r.put('deploy/kubeconfig.tpl', 'users:\n- name: a\n  user:\n    client-key-data: QUJDREVG\n');
  r.put('deploy/kubeconfig-token.tmpl', 'users:\n- name: a\n  user:\n    token: abc.def.ghi\n');
  r.put('deploy/kubeconfig-blank.tpl', 'users:\n- name: a\n  user:\n    token: {{ .Values.token }}\n    client-key-data: <base64>\n');
  r.put('roles/k8s/templates/kubeconfig.yaml.j2', 'users:\n- name: a\n  user:\n    token: "{{ k8s_token }}"\n');
  r.put('ops/templates/kubeconfig.yaml', 'apiVersion: v1\n');
  r.put('charts/app/Chart.yaml', 'apiVersion: v2\nname: app\n');
  r.put('charts/app/templates/kubeconfig.yaml', 'users:\n- user:\n    token: {{ .Values.token }}\n');
  r.put('charts/app/templates/kubeconfig-baked.yaml', 'users:\n- user:\n    token: eyJhbGciOi\n');
  r.put('docs/kubeconfig.html', '<p>kubeconfig</p>\n');
  r.put('README.md', 'hi\n');
});
const fs_ = { setup: FILES };
// 저장소 밖(한 단계 위)의 .ssh/id_rsa — 경로를 풀면 시험 자료 폴더가 아니다
const outsideKey = { setup: keyed('v041r2-outside', (r) => { r.put('node_modules/x/k', 'x\n'); r.put('testdata/k', 'x\n'); }), abs: false };

export default {
  'iac-edit': {
    block: [
      W('envs/prod/load_test_db.tf', RDS('  skip_final_snapshot = true\n'), '파일 이름 속 _test 는 시험 자리가 아니다', ask()),
      W('infra/ab_testing.tf', RDS('  deletion_protection = false\n'), 'ab_testing.tf', ask()),
      W('infra/db_test.tf', RDS('  deletion_protection = false\n'), 'db_test.tf', ask()),
      W('envs/prod/examples/main.tf', RDS('  deletion_protection = false\n'), '운영 낱말이 examples/ 보다 앞선다', ask()),
      W('envs/prod/tests/db.tf', RDS('  skip_final_snapshot = true\n'), '운영 낱말이 tests/ 보다 앞선다', ask()),
      W('deploy/prod/tests/app.yaml', app('argoproj.io/v1alpha1'), '운영 Argo CD 는 tests/ 밑이라도 묻는다', ask()),
      W('envs/prd/dev-db.tf', RDS('  skip_final_snapshot = true\n'), 'prd 는 운영, 파일 이름 dev- 는 개발 자리가 아니다', ask()),
      W('live/us-east-1/dev-tools.tf', RDS('  deletion_protection = false\n'), '환경을 모르는 자리(live/ 는 Terragrunt 저장소 이름이라 운영 낱말로 보지 않는다)', ask()),
      W('infra/dev-db.tf', RDS('  skip_final_snapshot = true\n'), '파일 이름의 dev 는 개발 자리가 아니다', ask()),
      W('modules/dev-portal/rds.tf', RDS('  deletion_protection = false\n'), 'modules/ 밑 폴더 이름의 dev 는 모듈 이름', ask()),
      W('deploy/prod/app.yaml', JSON.stringify(jsonApp(true)), 'JSON 한 줄로 쓴 Argo CD Application', ask()),
      W('deploy/prod/app.yaml', `${JSON.stringify(jsonApp(true), null, 2)}\n`, '여러 줄 JSON 의 Argo CD Application', ask()),
    ],
    pass: [
      W('envs/dev/modules/db/main.tf', RDS('  deletion_protection = false\n'), 'dev 자리 밑의 modules/'),
      W('envs/dev-us/db.tf', RDS('  skip_final_snapshot = true\n'), 'dev-us 폴더'),
      W('envs/dev/liveness.tf', RDS('  skip_final_snapshot = true\n'), 'liveness 는 live(운영)가 아니다 — dev 자리 그대로'),
      W('sandbox.tfvars', 'skip_final_snapshot = true\n', '환경별 변수 파일은 파일 이름이 곧 환경(.tf 이름은 보지 않음)'),
      W('infrastructure-live/dev/rds/main.tf', RDS('  skip_final_snapshot = true\n'), 'Terragrunt infrastructure-live/dev'),
      W('tests/db.tftest.hcl', RDS('  deletion_protection = false\n'), '*.tftest.hcl'),
      W('deploy/prod/app.yaml', JSON.stringify(jsonApp(false)), 'JSON Argo CD 의 prune: false'),
    ],
  },
  'protected-files': {
    block: [
      R('certs/haproxy.pem', 'Read: 인증서 뒤 맨 끝(4KB 넘어)의 키', { ...fs_, ...ask() }),
      R('certs/huge.pem', 'Read: 1MB 넘는 .pem 은 묻는다', { ...fs_, ...ask() }),
      R('node_modules/../../.ssh/id_rsa', 'Read: node_modules/../ 로 저장소 밖 키', { ...outsideKey, ...ask() }),
      R('testdata/../../.ssh/id_rsa', 'Read: testdata/../ 로 저장소 밖 키', { ...outsideKey, ...ask() }),
      B('cat node_modules/../../.ssh/id_rsa', '셸: node_modules/../ 로 저장소 밖 키', { ...outsideKey, ...ask() }),
      R('kubeconfig.txt', 'Read: kubectl config view --raw > kubeconfig.txt', { ...fs_, ...ask() }),
      R('deploy/prod.tpl.key', 'Read: 가운데 낀 .tpl 은 틀이 아니다', { ...fs_, ...ask() }),
      R('deploy/server.key.example', 'Read: 예시 이름이라도 진짜 키가 들었다', { ...fs_, ...ask() }),
      R('deploy/kubeconfig.tpl', 'Read: 틀 속 client-key-data 값', { ...fs_, ...ask() }),
      R('deploy/kubeconfig-token.tmpl', 'Read: 틀 속 token 값', { ...fs_, ...ask() }),
      R('ops/templates/kubeconfig.yaml', 'Read: Chart.yaml 없는 templates/ 는 helm 이 아니다', { ...fs_, ...ask() }),
      R('charts/app/templates/kubeconfig-baked.yaml', 'Read: helm 틀이라도 진짜 token 값', { ...fs_, ...ask() }),
      B('cat .ssh/id_rsa 2>&1', '셸: 2>&1 앞의 진짜 읽기', { ...fs_, ...ask() }),
    ],
    pass: [
      R('certs/bundle.pem', 'Read: 4KB 넘는 공개 인증서 묶음', fs_),
      R('deploy/client.key.example', 'Read: 키가 없는 예시', fs_),
      R('deploy/kubeconfig-blank.tpl', 'Read: 자리 표시만 있는 틀', fs_),
      R('roles/k8s/templates/kubeconfig.yaml.j2', 'Read: Ansible 틀(.j2)의 자리 표시', fs_),
      R('charts/app/templates/kubeconfig.yaml', 'Read: Chart.yaml 이 있는 helm 틀', fs_),
      R('docs/kubeconfig.html', 'Read: kubeconfig 이름의 html 문서', fs_),
      R('node_modules/x/../ssh2/test/fixtures/id_rsa', 'Read: 풀어도 저장소 안 node_modules', { ...outsideKey }),
      B('cat README.md 2>&1', '셸: 2>&1 만 있는 보통 읽기', fs_),
    ],
  },
};
