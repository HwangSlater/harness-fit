// v0.4.1 — 역할극 13·15·16 회차에서 미룬 훅 쪽 고칠 점(2026-11-16): 인프라 안전장치 끄기 묻기(iac-edit),
// 비밀 파일 읽기 묻기(protected-files askRead), "use client" 의 비공개 환경 변수 알림(unsafe-html), 키체인 비밀번호 찍기 묻기(ask-cmd).
// strict-run.mjs 가 같은 훅 사례에 이어 붙인다.
import { S, B, P, W, E, R, M, keyed, FAKE } from './helpers.mjs';

const ask = (extra = {}) => ({ decision: 'ask', ...extra });

const RDS = (body) => `resource "aws_db_instance" "main" {\n  engine = "postgres"\n${body}}\n`;
const SG = (port, cidr = '0.0.0.0/0', from = port) => `resource "aws_security_group" "db" {\n  ingress {\n    from_port   = ${from}\n    to_port     = ${port}\n    protocol    = "tcp"\n    cidr_blocks = ["${cidr}"]\n  }\n}\n`;
const LIFE = 'resource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n  lifecycle {\n    prevent_destroy = true\n  }\n}\n';
const app = (sync) => `apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: api\nspec:\n  project: default\n${sync}`;
const AUTO = (prune) => `  syncPolicy:\n    automated:\n      prune: ${prune}\n      selfHeal: true\n`;

// 이미 있는 .tf(고치기 사례가 실제 파일을 읽는다)
const TF = keyed('v041-tf', (r) => {
  r.put('infra/db.tf', RDS('  deletion_protection = true\n'));
  r.put('infra/logs.tf', LIFE);
  r.put('infra/old.tf', RDS('  skip_final_snapshot = true\n'));
  r.put('deploy/prod/api.yaml', app(AUTO('false')));
});
const SECRETS = keyed('v041-secrets', (r) => {
  r.put('terraform.tfvars', 'db_password = "x"\n');
  r.put('envs/prod.auto.tfvars', 'x = 1\n');
  r.put('terraform.tfvars.example', 'db_password = ""\n');
  r.put('kubeconfig-prod', 'apiVersion: v1\n');
  r.put('certs/server.pem', `${FAKE.privateKey}\nx\n`); // .pem 은 앞 4KB 에 PRIVATE KEY 가 있을 때만 묻는다
  r.put('.env', 'A=1\n');
  r.put('Config/Secrets.xcconfig', 'K = v\n');
  r.put('data/raw/a.csv', '1\n');
  r.put('README.md', 'hello\n');
});
const tf = { setup: TF };
const sec = { setup: SECRETS };
const LISTED = { paths: ['Config/Secrets.xcconfig', 'data/raw/', '*.tfstate*'] };

const CLIENT = (body) => `"use client";\n\nimport { useState } from 'react';\n\n${body}`;
const SERVER_FILE = keyed('v041-client', (r) => {
  r.put('app/Widget.tsx', CLIENT('export function Widget() {\n  return null;\n}\n'));
  r.put('app/page.tsx', 'export default function Page() {\n  return null;\n}\n');
});

export default {
  'iac-edit': {
    block: [
      W('infra/db.tf', RDS('  deletion_protection = false\n'), '새 파일에 삭제 보호 끔', ask()),
      W('infra/db.tf', RDS('  skip_final_snapshot = true\n'), '마지막 스냅숏 안 남김', ask()),
      W('infra/db.tf', RDS('  publicly_accessible = true\n'), 'DB 공개', ask()),
      W('infra/lb.tf', 'resource "aws_lb" "a" {\n  enable_deletion_protection = false\n}\n', 'ALB 삭제 보호 끔', ask()),
      E('infra/db.tf', '  deletion_protection = true', '  deletion_protection = false', '있던 보호를 끄는 고치기', { ...tf, ...ask() }),
      E('infra/logs.tf', '  lifecycle {\n    prevent_destroy = true\n  }\n', '', 'prevent_destroy 블록 지움', { ...tf, ...ask() }),
      E('infra/logs.tf', 'prevent_destroy = true', 'prevent_destroy = false', 'prevent_destroy 를 false 로', { ...tf, ...ask() }),
      E('infra/gone.tf', '    prevent_destroy = true\n', '', '파일을 못 읽어도 고치는 조각끼리 견준다', ask()),
      M('infra/db.tf', [['engine = "postgres"', 'engine = "mysql"'], ['deletion_protection = true', 'deletion_protection = false']], 'MultiEdit 도', { ...tf, ...ask() }),
      W('infra/sg.tf', SG(22), 'ssh 를 인터넷에', ask({ reason: /0\.0\.0\.0\/0/ })),
      W('infra/sg.tf', SG(5432, '::/0'), 'IPv6 전체에 DB 포트', ask()),
      W('infra/sg.tf', SG(443, '0.0.0.0/0', 80), '80~443 범위는 예외 아님', ask()),
      W('infra/rule.tf', 'resource "aws_security_group_rule" "a" {\n  type        = "ingress"\n  from_port   = 3306\n  to_port     = 3306\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"]\n}\n', 'aws_security_group_rule ingress', ask()),
      W('infra/rule.tf', 'resource "aws_vpc_security_group_ingress_rule" "a" {\n  cidr_ipv4   = "0.0.0.0/0"\n  from_port   = 6379\n  to_port     = 6379\n  ip_protocol = "tcp"\n}\n', 'vpc ingress rule', ask()),
      W('infra/fw.tf', 'resource "google_compute_firewall" "a" {\n  name    = "ssh"\n  network = "default"\n  allow {\n    protocol = "tcp"\n    ports    = ["22"]\n  }\n  source_ranges = ["0.0.0.0/0"]\n}\n', 'GCP 방화벽', ask()),
      W('infra/sg.tf', 'module "db_sg" {\n  source = "terraform-aws-modules/security-group/aws"\n  ingress_with_cidr_blocks = [\n    {\n      from_port   = 5432\n      to_port     = 5432\n      cidr_blocks = "0.0.0.0/0"\n    },\n  ]\n}\n', '모듈의 ingress_with_cidr_blocks', ask()),
      W('infra/sg.tf', 'resource "aws_security_group" "a" {\n  dynamic "ingress" {\n    for_each = [22]\n    content {\n      from_port   = ingress.value\n      to_port     = ingress.value\n      cidr_blocks = ["0.0.0.0/0"]\n    }\n  }\n}\n', 'dynamic "ingress"', ask()),
      W('envs/prod.tfvars', 'deletion_protection = false\n', '.tfvars 값', ask()),
      W('terragrunt.hcl', 'inputs = {\n  skip_final_snapshot = true\n}\n', '.hcl', ask()),
      W('deploy/prod/api.yaml', app(AUTO('true')), '운영 Argo CD 에 prune 켬', ask({ reason: /prune/ })),
      W('clusters/production/apps.yml', `apiVersion: argoproj.io/v1alpha1\nkind: ApplicationSet\nmetadata:\n  name: apps\nspec:\n  template:\n    spec:\n      syncPolicy:\n        automated: {prune: true, selfHeal: true}\n`, 'ApplicationSet 의 한 줄 꼴', ask()),
      E('deploy/prod/api.yaml', '      prune: false', '      prune: true', '있던 prune: false 를 true 로', { ...tf, ...ask() }),
    ],
    pass: [
      W('infra/db.tf', RDS('  deletion_protection = true\n'), '보호를 켬'),
      W('infra/db.tf', RDS('  # deletion_protection = false\n'), '주석 속'),
      W('infra/db.tf', RDS('  skip_final_snapshot = false\n  publicly_accessible = false\n'), '안전한 값'),
      E('infra/old.tf', 'engine = "postgres"', 'engine = "mysql"', '이미 있던 skip_final_snapshot = true 는 묻지 않는다', tf),
      E('infra/logs.tf', 'bucket = "logs"', 'bucket = "logs-2"', 'prevent_destroy 를 그대로 둔 고치기', tf),
      E('infra/logs.tf', '    prevent_destroy = true\n', '    prevent_destroy = true\n    ignore_changes  = [tags]\n', 'prevent_destroy 옆에 줄 더하기', tf),
      W('infra/alb.tf', SG(443), '443 만 여는 공개 로드 밸런서'),
      W('infra/alb.tf', SG(80, '::/0'), '80 만(IPv6)'),
      W('infra/fw.tf', 'resource "google_compute_firewall" "web" {\n  allow {\n    protocol = "tcp"\n    ports    = ["80", "443"]\n  }\n  source_ranges = ["0.0.0.0/0"]\n}\n', 'GCP 80·443'),
      W('infra/sg.tf', 'module "alb_sg" {\n  ingress_cidr_blocks = ["0.0.0.0/0"]\n  ingress_rules       = ["https-443-tcp", "http-80-tcp"]\n}\n', '모듈의 https·http 규칙만'),
      W('infra/sg.tf', 'resource "aws_security_group" "a" {\n  egress {\n    from_port   = 0\n    to_port     = 0\n    protocol    = "-1"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n', 'egress 는 묻지 않는다'),
      W('infra/sg.tf', SG(5432, '10.0.0.0/16'), '안쪽 대역'),
      W('infra/route.tf', 'resource "aws_route" "r" {\n  route_table_id         = aws_route_table.a.id\n  destination_cidr_block = "0.0.0.0/0"\n  gateway_id             = aws_internet_gateway.a.id\n}\n', '라우팅 표'),
      W('infra/vars.tf', 'variable "allowed" {\n  default = ["0.0.0.0/0"]\n}\n', '변수 기본값'),
      W('infra/db.tf.md', RDS('  deletion_protection = false\n'), '.tf 가 아닌 파일'),
      W('deploy/staging/api.yaml', app(AUTO('true')), '운영이 아닌 경로'),
      W('deploy/prod/api.yaml', app(AUTO('false')), 'prune: false'),
      W('deploy/prod/api.yaml', app('  syncPolicy:\n    syncOptions:\n      - prune: true\n'), 'automated 밑이 아님'),
      W('products/api.yaml', app(AUTO('true')), 'products 는 prod 낱말이 아님'),
      W('deploy/prod/cm.yaml', 'apiVersion: v1\nkind: ConfigMap\ndata:\n  prune: "true"\n', 'Application 이 아님'),
      E('deploy/prod/api.yaml', '  project: default', '  project: payments', '이미 켜 둔 것이 아닌 고치기(prune: false 그대로)', tf),
    ],
  },
  'protected-files': {
    block: [
      R('terraform.tfvars', 'Read: tfvars', { ...sec, ...ask() }),
      R('envs/prod.auto.tfvars', 'Read: auto.tfvars', { ...sec, ...ask() }),
      R('kubeconfig-prod', 'Read: kubeconfig*', { ...sec, ...ask() }),
      R('certs/server.pem', 'Read: .pem', { ...sec, ...ask() }),
      R('Config/Secrets.xcconfig', 'Read: 사용자가 그대로 적은 파일', { ...sec, opts: LISTED, ...ask() }),
      R('x/terraform.tfstate', 'Read: 비밀처럼 보이는 글롭(*.tfstate*)', { opts: LISTED, ...ask() }),
      R('.env', 'Read: 사용자가 .env 를 적었으면 묻는다', { ...sec, opts: { paths: ['.env'] }, ...ask() }),
      R('~/.kube/config', 'Read: 홈의 kubeconfig', { abs: false, ...ask() }),
      S('cat terraform.tfvars', '셸: cat tfvars', { ...sec, ...ask({ reason: /tfvars|conversation log/ }) }),
      B('head -n 20 envs/prod.auto.tfvars', '셸: head -n', { ...sec, ...ask() }),
      B('sudo less kubeconfig-prod', '셸: sudo less', { ...sec, ...ask() }),
      P('Get-Content -Path certs/server.pem', 'PowerShell: Get-Content -Path', { ...sec, ...ask() }),
      P('gc .\\terraform.tfvars', 'PowerShell: gc', { ...sec, ...ask() }),
      B('cat Config/Secrets.xcconfig | grep K', '셸: 적은 파일을 cat', { ...sec, opts: LISTED, ...ask() }),
      B('cat ~/.kube/config', '셸: 홈의 kubeconfig', ask()),
      S('cat infra/prod/terraform.tfstate.backup', '셸: 적은 *.tfstate* (상태 파일엔 비밀값이 평문으로)', { opts: { paths: ['*.tfstate*'] }, ...ask() }),
    ],
    pass: [
      R('README.md', 'Read: 보통 파일', sec),
      R('.env', 'Read: 적지 않은 .env 는 디버깅에 흔해 묻지 않는다', sec),
      R('terraform.tfvars.example', 'Read: 예시 파일', sec),
      R('data/raw/a.csv', 'Read: 비밀처럼 보이지 않는 보호 폴더', { ...sec, opts: LISTED }),
      R('terraform.tfvars', 'Read: askRead 를 끄면 묻지 않는다', { ...sec, opts: { askRead: false } }),
      R('variables.tf', 'Read: .tf 는 값 파일이 아님'),
      S('cat README.md', '셸: 보통 파일', sec),
      S('cat .env', '셸: 적지 않은 .env', sec),
      B('cat terraform.tfvars.example', '셸: 예시', sec),
      B('grep db_password terraform.tfvars', 'grep 은 보지 않는다', sec),
      B('echo cat terraform.tfvars', 'echo 의 인자', sec),
      B('cat data/raw/a.csv', '셸: 보통 보호 폴더', { ...sec, opts: LISTED }),
    ],
  },
  'unsafe-html': {
    block: [
      W('app/Login.tsx', CLIENT('export function Login() {\n  const key = process.env.STRIPE_SECRET_KEY;\n  return null;\n}\n'), '"use client" 에서 비공개 값', { reason: /undefined|server-only/ }),
      W('app/Map.jsx', `'use client'\nexport const k = process.env['MAPS_KEY'];\n`, "작은따옴표·[''] 꼴"),
      W('app/Note.ts', `// 위젯\n"use client";\nexport const u = process.env.API_URL;\n`, '맨 앞 주석 뒤의 지시문'),
      E('app/Widget.tsx', '  return null;', '  const t = process.env.DB_TOKEN;\n  return null;', '이미 "use client" 인 파일 고치기', { setup: SERVER_FILE }),
      E('app/page.tsx', 'export default function Page() {', '"use client";\nexport default function Page() {', '"use client" 를 새로 붙이면 파일 전체', { setup: keyed('v041-client-env', (r) => r.put('app/page.tsx', 'export default function Page() {\n  return process.env.SECRET_X;\n}\n')) }),
    ],
    pass: [
      W('app/Login.tsx', CLIENT('export const u = process.env.NEXT_PUBLIC_API_URL;\n'), 'NEXT_PUBLIC_'),
      W('app/Login.tsx', CLIENT('export const dev = process.env.NODE_ENV === "development";\n'), 'NODE_ENV'),
      W('app/route.ts', 'export async function GET() {\n  return Response.json({ k: process.env.STRIPE_SECRET_KEY ? 1 : 0 });\n}\n', '서버 코드'),
      W('app/Login.tsx', CLIENT('// process.env.SECRET 은 서버에서만\nexport const x = 1;\n'), '주석'),
      W('lib/a.ts', 'import x from "y";\n"use client";\nexport const s = process.env.S;\n', '지시문이 맨 앞이 아님'),
      E('app/Widget.tsx', '  return null;', '  return <div />;', '"use client" 파일이지만 env 없음', { setup: SERVER_FILE }),
    ],
  },
  'ask-cmd': {
    block: [
      S('security find-generic-password -s api -w', '키체인 비밀번호 찍기 -w', ask()),
      S('security find-internet-password -s example.com -a me -w', 'internet-password -w', ask()),
      B('security find-generic-password -ga me -s api', '붙여 쓴 -g', ask()),
    ],
    pass: [
      S('security find-generic-password -s api', '속성만'),
      S('security find-identity -v -p codesigning', '서명 인증서 목록'),
      B('TOKEN=$(security find-generic-password -s api -w)', '변수에 받기만(화면에 안 찍음)'),
      B('security find-generic-password -s -w', '-s 의 값이 -w'),
    ],
  },
};
