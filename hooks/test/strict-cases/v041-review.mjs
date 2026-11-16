// v0.4.1 독립 검토(2026-11-16)에서 찾은 헛물음·놓침: iac-edit 의 heredoc·시험 자리·개발 자리·.tf.json·.tofu·Argo CD apiVersion,
// protected-files askRead 의 kubeconfig 코드·문서·helm 틀, 공개 인증서 .pem, 시험 자료 키, 셸 넘겨쓰기·bash type·붙여 쓴 <.
// strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import { S, B, P, W, R, keyed, FAKE } from './helpers.mjs';

const ask = (extra = {}) => ({ decision: 'ask', ...extra });
const RDS = (body) => `resource "aws_db_instance" "main" {\n  engine = "postgres"\n${body}}\n`;
const SG = (port) => `resource "aws_security_group" "db" {\n  ingress {\n    from_port   = ${port}\n    to_port     = ${port}\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n`;
const AUTO = '  syncPolicy:\n    automated:\n      prune: true\n';
const app = (api) => `apiVersion: ${api}\nkind: Application\nmetadata:\n  name: api\nspec:\n${AUTO}`;
// heredoc 속 글(IAM 정책·사용자 데이터)
const HEREDOC = (body, tag = 'EOT', dash = '') => `resource "aws_iam_policy" "p" {\n  policy = <<${dash}${tag}\n${body}\n${dash ? '  ' : ''}${tag}\n}\n`;
const TF_JSON = (body) => `{\n  "resource": {\n    "aws_db_instance": {\n      "main": {\n        "engine": "postgres",\n${body}\n      }\n    }\n  }\n}\n`;
const JSON_SG = (port) => `{\n  "resource": {\n    "aws_security_group": {\n      "db": {\n        "ingress": [\n          {\n            "from_port": ${port},\n            "to_port": ${port},\n            "protocol": "tcp",\n            "cidr_blocks": ["0.0.0.0/0"]\n          }\n        ]\n      }\n    }\n  }\n}\n`;

const PUBLIC_CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const FILES = keyed('v041r-files', (r) => {
  r.put('certs/chain.pem', PUBLIC_CERT);
  r.put('certs/server.pem', `${FAKE.privateKey}\nx\n`);
  r.put('certs/mixed.pem', `${PUBLIC_CERT}${FAKE.privateKey}\n`);
  r.put('kubeconfig-prod', 'apiVersion: v1\n');
  r.put('kubeconfig.yaml', 'apiVersion: v1\n');
  r.put('pkg/kubeconfig.go', 'package pkg\n');
  r.put('docs/kubeconfig.md', '# kubeconfig\n');
  r.put('charts/app/templates/kubeconfig.yaml', 'apiVersion: v1\n');
  r.put('charts/app/Chart.yaml', 'apiVersion: v2\nname: app\n');
  r.put('node_modules/ssh2/test/fixtures/id_rsa', 'x\n');
  r.put('testdata/server.key', 'x\n');
  r.put('README.md', 'hi\n');
});
const fs_ = { setup: FILES };

export default {
  'iac-edit': {
    block: [
      // heredoc 앞뒤의 진짜 설정은 여전히 묻는다
      W('infra/iam.tf', `${HEREDOC('#!/bin/sh\nrm -rf /tmp/cache/*')}${RDS('  skip_final_snapshot = true\n')}`, 'heredoc 속 따옴표 밖 /* 뒤의 진짜 설정', ask()),
      W('infra/iam.tf', `${HEREDOC('echo "hi')}${SG(22)}`, 'heredoc 속 홀수 개의 " 뒤의 열린 포트', ask()),
      W('infra/iam.tf', `${HEREDOC('x /* y', 'POLICY', '-')}${SG(22)}`, '<<-POLICY 뒤의 열린 포트', ask()),
      W('infra/db.tf.json', TF_JSON('        "deletion_protection": false'), '.tf.json 의 "deletion_protection": false', ask()),
      W('infra/db.tf.json', TF_JSON('        "skip_final_snapshot": true'), '.tf.json 의 skip_final_snapshot', ask()),
      W('infra/sg.tf.json', JSON_SG(22), '.tf.json 의 ingress 22 열림', ask()),
      W('infra/db.tofu', RDS('  deletion_protection = false\n'), '.tofu', ask()),
      W('envs/dev/db.tf', RDS('  publicly_accessible = true\n'), '개발 자리라도 공개 DB 는 묻는다', ask()),
      W('envs/sandbox/sg.tf', SG(5432), '개발 자리라도 열린 포트는 묻는다', ask()),
      W('envs/prod/dev-db.tf', RDS('  skip_final_snapshot = true\n'), 'prod 와 dev 가 함께면 prod 로 본다', ask()),
      W('apps/api-prod.yaml', app('argoproj.io/v1alpha1'), '파일 이름의 -prod 도 운영으로 센다', ask()),
    ],
    pass: [
      W('infra/iam.tf', HEREDOC('skip_final_snapshot = true\ndeletion_protection = false'), 'heredoc 속 글은 설정이 아니다'),
      W('infra/iam.tf', HEREDOC('{ "Condition": { "IpAddress": { "aws:SourceIp": "0.0.0.0/0" } } }', 'POLICY', '-'), '<<-POLICY 속 0.0.0.0/0'),
      W('test/db.tf', RDS('  deletion_protection = false\n'), 'test/ 밑'),
      W('modules/db/tests/main.tf', RDS('  skip_final_snapshot = true\n'), 'tests/ 밑'),
      W('examples/complete/main.tf', RDS('  publicly_accessible = true\n'), 'examples/ 밑'),
      W('fixtures/sg.tf', SG(22), 'fixtures/ 밑'),
      W('infra/testdata/sg.tf', SG(22), 'testdata/ 밑'),
      W('infra/db.tftest.hcl', RDS('  deletion_protection = false\n'), '*.tftest.hcl 파일(파일 이름 속 _test 는 v041-review2 에서 묻는다)'),
      W('envs/dev/db.tf', RDS('  skip_final_snapshot = true\n  deletion_protection = false\n'), 'dev 자리의 스냅숏·삭제 보호'),
      W('envs/sandbox/terraform.tfvars', 'skip_final_snapshot = true\n', 'sandbox 폴더의 값 파일(파일 이름 sandbox.tfvars 는 v041-review2 에서 묻는다)'),
      W('playground/main.tofu', RDS('  deletion_protection = false\n'), 'playground'),
      W('deploy/prod/app.yaml', `# argoproj.io 처럼 보이는 주석\n${app('app.k8s.io/v1beta1')}`, '주석 속 argoproj.io, apiVersion 은 app.k8s.io'),
      W('infra/db.tf.json', TF_JSON('        "deletion_protection": true'), '.tf.json 의 안전한 값'),
    ],
  },
  'protected-files': {
    block: [
      R('certs/server.pem', 'Read: 개인 키가 든 .pem', { ...fs_, ...ask() }),
      R('certs/mixed.pem', 'Read: 인증서 뒤에 개인 키', { ...fs_, ...ask() }),
      R('certs/missing.pem', 'Read: 못 읽는 .pem 은 묻는다', { ...fs_, ...ask() }),
      R('kubeconfig-prod', 'Read: 확장자 없는 kubeconfig', { ...fs_, ...ask() }),
      R('kubeconfig.yaml', 'Read: kubeconfig.yaml', { ...fs_, ...ask() }),
      B('cat <certs/server.pem', '셸: 붙여 쓴 <', { ...fs_, ...ask() }),
      B('cat < kubeconfig-prod', '셸: 따로 쓴 <', { ...fs_, ...ask() }),
      B('type ./kubeconfig-prod', 'bash: 경로를 준 type', { ...fs_, ...ask() }),
      P('type kubeconfig-prod', 'PowerShell: type 은 Get-Content', { ...fs_, ...ask() }),
      B('cat kubeconfig-prod 2>/dev/null', '넘겨쓰기 앞의 진짜 읽기', { ...fs_, ...ask() }),
    ],
    pass: [
      R('certs/chain.pem', 'Read: 공개 인증서 .pem', fs_),
      R('pkg/kubeconfig.go', 'Read: kubeconfig 이름의 코드', fs_),
      R('docs/kubeconfig.md', 'Read: kubeconfig 이름의 문서', fs_),
      R('deploy/kubeconfig.tmpl', 'Read: .tmpl 틀'),
      R('deploy/kubeconfig.tpl', 'Read: .tpl 틀'),
      R('kubeconfig.sample', 'Read: .sample'),
      R('charts/app/templates/kubeconfig.yaml', 'Read: helm templates/ 밑', fs_),
      R('node_modules/ssh2/test/fixtures/id_rsa', 'Read: node_modules 의 시험 키', fs_),
      R('testdata/server.key', 'Read: testdata 의 키', fs_),
      R('spec/test/fixtures/client.key', 'Read: test/fixtures 의 키'),
      B('cat README.md > kubeconfig-prod', '셸: > 대상은 쓰는 파일', fs_),
      B('cat README.md >kubeconfig.yaml', '셸: 붙여 쓴 > 대상', fs_),
      B('cat README.md 2> kubeconfig.yaml', '셸: 2> 대상', fs_),
      B('cat README.md 2>kubeconfig.yaml', '셸: 붙여 쓴 2> 대상', fs_),
      B('cat README.md >> kubeconfig-prod', '셸: >> 대상', fs_),
      B('type kubeconfig', 'bash: type 은 명령 이름을 알려 주는 내장 명령', fs_),
      B('cat <<EOF\nkubeconfig-prod\nEOF', '셸: heredoc', fs_),
      S('cat certs/chain.pem', '셸: 공개 인증서', fs_),
    ],
  },
};
