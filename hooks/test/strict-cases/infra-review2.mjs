// 역할극 15 회차(인프라) 두 번째 독립 검토(2026-11-12) — 앞 고침(8d96415)이 연 놓침.
// 비밀값 명령: 「찍는 도구 목록」을 뒤집어 안 찍히는 곳(진짜 파일·값을 찍지 않는 도구·다시 안 쓰는 변수)만 둔다.
// kubectl 틀: 이름표 쪽(metadata·type·kind·apiVersion)만 꺼낼 때만 둔다. 도구 폴더: 흔한 이름(dist·build·target)은 git 이 무시할 때만 건너뛴다.
import { S, B, P, keyed } from './helpers.mjs';

const K = 'kubectl get secret app -o yaml';
const A = 'aws secretsmanager get-secret-value --secret-id x --query SecretString --output text';

const KEY = { paths: ['*.key'] };
const TF = { paths: ['*.tfstate*', 'kubeconfig*'] };
// 사람이 둔 진짜 파일이 흔한 이름 폴더 안에 있다(무시 목록 없음)
const realInCommon = keyed('review2-real-in-common', (r) => {
  r.put('dist/secret.key', 'x\n');
  r.put('build/prod.tfstate', '{}\n');
  r.put('infra/target/terraform.tfstate', '{}\n');
  r.put('node_modules/kubeconfig-x/index.js', 'x\n');
});
// 무시하는 dist 지만 그 안 키 파일은 git 이 추적한다(git add -f)
const trackedInIgnored = keyed('review2-tracked-in-ignored', (r) => {
  r.put('.gitignore', 'dist/\n');
  r.commit('dist/secret.key', 'x\n', 'test: 강제로 넣은 키');
});
// 무시하는 dist·build 안에 빌드 결과만
const ignoredBuild = keyed('review2-ignored-build', (r) => {
  r.put('.gitignore', 'dist/\nbuild/\n');
  r.put('dist/assets/kubeconfig-ABCD.js', 'x\n');
  r.put('build/cache/terraform.tfstate.json', '{}\n');
});

export default {
  'ask-cmd': {
    block: [
      // 모르는 도구로의 파이프는 찍힌다고 본다
      S(`${K} | xargs echo`, 'xargs echo'),
      S(`${K} | python -c "import sys;print(sys.stdin.read())"`, 'python -c print'),
      S(`${K} | python3 -m json.tool`, 'python3 -m json.tool'),
      S(`${K} | perl -pe 1`, 'perl'),
      S(`${K} | node -e "process.stdin.pipe(process.stdout)"`, 'node -e'),
      B(`${K} | sh -c cat`, 'sh -c cat'),
      B(`${K} | bash`, 'bash'),
      S(`${K} | busybox cat`, 'busybox cat'),
      B(`${K} | { cat; }`, '{ cat; }'),
      S(`${K} | gzip -d`, 'gzip -d'),
      S(`${K} | openssl base64 -d`, 'openssl base64 -d'),
      S(`${K} | rev`, 'rev'),
      S(`${K} | iconv -f utf-8`, 'iconv'),
      S(`${K} | kubectl neat`, 'kubectl neat 는 찍는다'),
      P(`${K} | Out-String`, 'Out-String'),
      // 화면인 넘겨쓰기
      B(`${K} > /dev/stdout`, '/dev/stdout'),
      B(`${K} > /dev/tty`, '/dev/tty'),
      B(`${K} > /dev/stderr`, '/dev/stderr'),
      P(`${K} > CON`, 'CON'),
      B(`${K} > out.yaml && cat out.yaml`, '받은 파일을 다시 찍음'),
      P(`${K} | Out-File x.yaml; Get-Content x.yaml`, 'Out-File 한 파일을 다시 찍음'),
      // 변수에 받고 다시 씀
      B(`X=$(${A}); echo $X`, 'echo $X'),
      B(`X=$(${A}) && echo "$X"`, '&& echo "$X"'),
      B(`X=$(${A}); printenv X`, 'printenv X'),
      B(`export X=$(${A}); env`, '맨 env'),
      B(`X="$(${A})"; echo "\${X}"`, '따옴표로 받고 ${X}'),
      P(`$s = ${K}; $s`, 'PowerShell $s 를 문장으로'),
      P(`$s = ${K}; Write-Output $s`, 'Write-Output $s'),
      P(`$s = ${K}; $s | Out-String`, '$s | Out-String'),
      P(`$env:DB = ${A}; $env:DB`, '$env:DB'),
      P(`$x = $(${A}); "$x"`, '"$x"'),
      // 변수에 받지 않는 치환
      B(`echo "$(${A})"`, 'echo "$( )"'),
      B(`printf '%s' "$(${A})"`, 'printf "$( )"'),
      B(`echo \`${A}\``, 'echo 백틱'),
      P(`"$(${A})"`, 'PowerShell "$( )" 는 그대로 찍힌다'),
      P(`Write-Host "$(${A})"`, 'Write-Host "$( )"'),
      // kubectl 틀: 이름표 밖을 꺼냄
      S(`kubectl get secret app -o jsonpath='{@}'`, 'jsonpath {@}'),
      S(`kubectl get secret app -o jsonpath='{$}'`, 'jsonpath {$}'),
      S(`kubectl get secret app -o go-template='{{.}}'`, 'go-template {{.}}'),
      S(`kubectl get secret app -o go-template='{{index . "data"}}'`, 'go-template index . "data"'),
      S('kubectl get secret app -o custom-columns=V:data', 'custom-columns 점 없는 data'),
      S(`kubectl get secret app -o jsonpath='{..data}'`, 'jsonpath 아래 어디든'),
    ],
    pass: [
      // 받자마자 그 명령의 환경으로만 가면 화면에 닿지 않는다(세 번째 검토의 기준, secret-sink.mjs). 전에는 .sh 를 모두 묻던 버그로 우연히 물었다(2026-11-13)
      B(`X=$(${A}) ./deploy.sh`, '받자마자 명령의 환경으로'),
      S(`${K} | kubeseal`, 'kubeseal'),
      S(`${K} | kubeseal > sealed.yaml`, 'kubeseal 을 파일로'),
      S(`${K} | kubectl neat > a.yaml`, '다듬어 파일로'),
      B(`${K} >/dev/null 2>&1`, '버림'),
      P(`${K} > $null`, 'PowerShell 버림'),
      P(`${K} | Out-Null`, 'Out-Null'),
      P(`${K} | Set-Clipboard`, 'Set-Clipboard'),
      P(`${K} | clip`, 'clip'),
      B(`${K} | pbcopy`, 'pbcopy'),
      B(`${K} | gpg -e -r ops -o secret.gpg`, 'gpg 로 암호화해 파일로'),
      P(`${K} | Set-Content x.yaml`, 'Set-Content'),
      B(`X=$(${A})`, '받기만'),
      B(`X="$(${A})"`, '따옴표로 받기만'),
      B(`export X=$(${A}); npm test`, '내보내고 이름을 다시 안 씀'),
      P(`$x = $(${A})`, 'PowerShell $( ) 받기만'),
      P(`$s = (${K})`, 'PowerShell ( ) 받기만'),
      P(`$env:DB = ${A}`, '$env: 에 받기만'),
      S(`kubectl get secret -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}'`, 'range 로 이름만'),
      S(`kubectl get secret -o go-template='{{range .items}}{{.metadata.name}} {{end}}'`, 'go-template range 이름만'),
      S(`kubectl get secret -o jsonpath='{.items[?(@.type=="Opaque")].metadata.name}'`, '거르기는 type, 꺼내기는 이름'),
      S('kubectl get secret app -o custom-columns=NAME:metadata.name,KIND:.kind', 'custom-columns 이름·종류'),
    ],
  },
  'protected-files': {
    block: [
      S('rm -rf dist', '무시 목록에 없는 dist 안 진짜 키', { opts: KEY, setup: realInCommon }),
      P('Remove-Item -Recurse -Force dist', 'PowerShell 로 같은 것', { opts: KEY, setup: realInCommon }),
      S('rm -rf build', 'build/prod.tfstate', { opts: TF, setup: realInCommon }),
      S('rm -rf infra', 'infra/target/terraform.tfstate', { opts: TF, setup: realInCommon }),
      S('rm -rf infra/target', 'target 을 바로 지우기', { opts: TF, setup: realInCommon }),
      S('rm -rf dist', '무시하는 dist 지만 키는 추적 중', { opts: KEY, setup: trackedInIgnored }),
    ],
    pass: [
      S('rm -rf node_modules', 'node_modules 는 늘 건너뜀', { opts: TF, setup: realInCommon }),
      S('rm -rf dist', '무시하는 dist 안 빌드 결과만', { opts: TF, setup: ignoredBuild }),
      S('rm -rf build', '무시하는 build 안 캐시만', { opts: TF, setup: ignoredBuild }),
      P('Remove-Item -Recurse -Force dist', 'PowerShell 로 무시하는 dist', { opts: TF, setup: ignoredBuild }),
    ],
  },
};
