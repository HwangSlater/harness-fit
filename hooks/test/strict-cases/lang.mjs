// 언어별 훅(swift-unsafe · python-unsafe)과 push 전 커밋 묶기(squash-push) 엄격 사례. 위험한 글은 이어 붙여 만든다.
import { S, B, P, W, E, stage, keyed } from './helpers.mjs';

const EV = 'ev' + 'al';
const EX = 'ex' + 'ec';
const TRY = 'try' + '!';
const PR = 'pri' + 'nt';
const SH = 'shell' + '=True';

// 원격(origin/main)에 지금 커밋을 둔 뒤 branch 를 만들어 커밋 n 개
const unpushed = (n, branch = 'feature/x') =>
  keyed(`unpushed\0${n}\0${branch}`, (r) => {
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    r.git('switch', '-q', '-c', branch);
    for (let k = 0; k < n; k++) r.commit(`src/s${k}.js`, `export const s = ${k};\n`, `feat: 단계 ${k}`);
  });

export default {
  'squash-push': {
    block: [
      S('git push origin feature/x', '원격에 없는 커밋 2개', { setup: unpushed(2) }),
      S('git push', '인자 없는 push(지금 브랜치)', { setup: unpushed(2) }),
      S('git push -u origin HEAD', 'HEAD 를 올림', { setup: unpushed(3) }),
      S('git push origin +feature/x:feature/x', '+ 붙은 refspec', { setup: unpushed(2) }),
      S('git push origin feature/x:refs/heads/other', '다른 이름으로 올림', { setup: unpushed(2) }),
      S('git commit -m "feat: 둘째" ; git push', '같은 명령의 커밋까지 2개', { setup: unpushed(1) }),
      B('git add src && git commit -m "feat: 둘째" && git push origin feature/x', 'bash && 로 이은 커밋 뒤 push', { setup: unpushed(1) }),
      S('git push --all origin', '--all: 다른 브랜치에 커밋 2개', {
        setup: (r) => {
          unpushed(2, 'feature/y')(r);
          r.git('switch', '-q', 'main');
        },
      }),
      S('git -c push.default=current push', 'git -c 앞붙임', { setup: unpushed(2) }),
      P('git push origin (git branch --show-current)', 'PowerShell 명령으로 구한 브랜치', { setup: unpushed(2) }),
    ],
    pass: [
      S('git push origin feature/x', '원격에 없는 커밋 1개', { setup: unpushed(1) }),
      S('git push -u origin main', '원격 기록이 하나도 없는 저장소(처음 올리기)', { setup: (r) => r.commit('src/a.js', 'export const a = 1;\n', 'feat: 둘') }),
      S('git push --tags', '태그만', { setup: unpushed(2) }),
      S('git push origin v1.0', '태그 하나', { setup: (r) => (unpushed(2)(r), r.git('tag', 'v1.0')) }),
      S('git push origin --delete old', '원격 브랜치 지우기', { setup: unpushed(2) }),
      S('git push origin :old', '빈 보내는 쪽(지우기)', { setup: unpushed(2) }),
      S('git push --dry-run', '미리 보기', { setup: unpushed(2) }),
      S('git commit --amend --no-edit ; git push', 'amend 는 커밋 수를 늘리지 않는다', { setup: unpushed(1) }),
      S('git push', '이미 원격에 있는 커밋', {
        setup: (r) => {
          unpushed(2)(r);
          r.git('update-ref', 'refs/remotes/origin/feature/x', 'HEAD');
        },
      }),
      S('git status && git log -1', 'push 없음', { setup: unpushed(3) }),
      S('git commit -m "feat: push 를 막는다"', '커밋 메시지 속 push', { setup: unpushed(2) }),
    ],
  },
  'swift-unsafe': {
    block: [
      W('Sources/App/Load.swift', `let d = ${TRY} load()\n`, 'try!'),
      W('Sources/App/Load.swift', `func f() {\n    ${PR}("x")\n}\n`, 'print('),
      W('Sources/App/Load.swift', `debugP${PR.slice(1)}(value)\n`, 'debugPrint('),
      W('Sources/App/Load.swift', `Swift.${PR}("x")\n`, 'Swift.print('),
      W('Sources/App/Load.swift', `${PR} ("x")\n`, 'print 와 ( 사이 띄어쓰기'),
      W('Sources/App/Load.swift', `let s = "a \\(${TRY} f()) b"\n`, '글자 속 \\( ) 안의 try!'),
      W('Sources/App/Load.swift', `let u = "a//b"; let d = ${TRY} f()\n`, '글자 속 // 를 주석으로 보지 않기'),
      W('Sources/App/Load.swift', `let m = """\n  text\n  """\nlet d = ${TRY} f()\n`, '여러 줄 글자 뒤의 코드'),
      W('Sources/App/Load.swift', `/* a /* b */ c */ let d = ${TRY} f()\n`, '겹친 주석 뒤의 코드'),
      E('Sources/App/Load.swift', 'let a = 1', `let a = 1\nlet d = ${TRY} f()`, 'Edit 로 더함', { setup: (r) => r.put('Sources/App/Load.swift', 'let a = 1\n') }),
      S('git commit -m "feat: x"', '커밋: 셸로 쓴 파일', { setup: stage('Sources/App/B.swift', `let d = ${TRY} f()\n`) }),
    ],
    pass: [
      W('Sources/App/Load.swift', 'let d = try? load()\n', 'try?'),
      W('Sources/App/Load.swift', 'do { let d = try load() } catch { log(error) }\n', 'try + catch'),
      W('Sources/App/Load.swift', `// ${TRY} 는 쓰지 않는다, ${PR}( 도\n`, '주석'),
      W('Sources/App/Load.swift', `let s = "${PR}(x) ${TRY}"\n`, '글자 속'),
      W('Sources/App/Load.swift', `let s = """\n${PR}(x)\n${TRY} y\n"""\n`, '여러 줄 글자 속'),
      W('Sources/App/Load.swift', `let r = #"${PR}("x")"#\n`, '날 글자 속'),
      W('Sources/App/Load.swift', `logger.${PR}(1)\nfunc ${PR}(_ s: String) {}\n`, '다른 것의 메서드·같은 이름 새로 만들기'),
      W('Tests/AppTests/LoadTests.swift', `let d = ${TRY} load()\n`, '시험 코드'),
      W('Sources/App/LoadTests.swift', `${PR}("x")\n`, '…Tests.swift'),
      W('Pods/Lib/A.swift', `let d = ${TRY} f()\n`, '받아 온 코드(Pods)'),
      W('src/a.js', `const s = '${TRY}'; ${PR}(1);\n`, 'Swift 파일이 아님'),
      W('Sources/App/Load.swift', `// lint:allow swift-unsafe 명령줄 도구의 출력\n${PR}("done")\n`, '허용 주석'),
      E('Sources/App/Load.swift', `let d = ${TRY} f()`, `let d = ${TRY} f()\nlet e = 2`, '이미 있던 줄', { setup: (r) => r.put('Sources/App/Load.swift', `let d = ${TRY} f()\n`) }),
    ],
  },
  'python-unsafe': {
    block: [
      W('app/run.py', `subprocess.run(cmd, ${SH})\n`, 'shell=True'),
      W('app/run.py', 'subprocess.run(cmd, shell = True)\n', '띄어쓰기'),
      W('app/run.py', 'subprocess.run(\n    cmd,\n    shell=True,\n)\n', '여러 줄 호출'),
      W('app/run.py', 'subprocess.run(cmd, shell=\\\n    True)\n', '줄 잇기'),
      W('app/run.py', `x = ${EV}(text)\n`, 'eval('),
      W('app/run.py', `${EX}(code)\n`, 'exec('),
      W('app/run.py', `builtins.${EV}(text)\n`, 'builtins.eval('),
      W('app/run.py', `msg = f"{${EV}(x)}"\n`, 'f-글자 { } 안'),
      W('app/run.py', `s = "a#b"; ${EV}(x)\n`, '글자 속 # 를 주석으로 보지 않기'),
      W('app/run.py', `doc = """\ntext\n"""\n${EV}(x)\n`, '세 따옴표 뒤의 코드'),
      W('app/run.pyw', `${EV}(x)\n`, '.pyw'),
      S('git commit -m "feat: x"', '커밋: 셸로 쓴 파일', { setup: stage('app/b.py', `${EV}(x)\n`) }),
    ],
    pass: [
      W('app/run.py', 'subprocess.run(["git", "log", name])\n', '인자 목록'),
      W('app/run.py', 'subprocess.run(cmd, shell=False)\n', 'shell=False'),
      W('app/run.py', 'if shell == True:\n    pass\n', '비교'),
      W('app/run.py', `# ${SH} 는 쓰지 않는다, ${EV}( 도\n`, '주석'),
      W('app/run.py', `s = "${SH} ${EV}(x)"\n`, '글자 속'),
      W('app/run.py', `doc = """\n${EV}(x) ${SH}\n"""\n`, '세 따옴표 글자 속'),
      W('app/run.py', `msg = f"{{${EV}(x)}}"\n`, 'f-글자의 {{ }} 는 글자'),
      W('app/run.py', `v = ast.literal_${EV}(text)\ndf.${EV}("a > 1")\n`, '다른 것의 eval'),
      W('app/run.py', `def ${EV}(self, x):\n    return x\n`, '같은 이름 새로 만들기'),
      W('tests/test_run.py', `${EV}(x)\n`, '시험 코드'),
      W('app/conftest.py', `${EV}(x)\n`, 'conftest.py'),
      W('.venv/lib/x.py', `${EV}(x)\n`, '가상 환경'),
      W('app/notes.txt', `${EV}(x)\n`, 'Python 파일이 아님'),
      W('app/run.py', `x = ${EV}(text)  # lint:allow python-unsafe 고정된 식만 받음\n`, '허용 주석'),
    ],
  },
};
