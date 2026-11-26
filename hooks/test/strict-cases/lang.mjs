// 언어별 훅(swift-unsafe · python-unsafe) 엄격 사례. 위험한 글은 이어 붙여 만든다.
import { S, B, P, W, E, stage, keyed } from './helpers.mjs';

const EV = 'ev' + 'al';
const EX = 'ex' + 'ec';
const TRY = 'try' + '!';
const PR = 'pri' + 'nt';
const SH = 'shell' + '=True';
const MS = 'mark_' + 'safe';
const CE = 'csrf_' + 'exempt';

// 원격(origin/main)에 지금 커밋을 둔 뒤 branch 를 만들어 커밋 n 개
const unpushed = (n, branch = 'feature/x') =>
  keyed(`unpushed\0${n}\0${branch}`, (r) => {
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    r.git('switch', '-q', '-c', branch);
    for (let k = 0; k < n; k++) r.commit(`src/s${k}.js`, `export const s = ${k};\n`, `feat: 단계 ${k}`);
  });

export default {
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
      // Django — 역할극 9 회차
      W('shop/views.py', `return ${MS}(item.body)\n`, 'mark_safe(값)'),
      W('shop/views.py', `return ${MS}(f"<b>{name}</b>")\n`, 'mark_safe(f-글자)'),
      W('shop/views.py', `return ${MS}("<b>%s</b>" % name)\n`, 'mark_safe(글자 % 값)'),
      W('shop/utils.py', `from django.utils import safestring\nhtml = safestring.${MS}(text)\n`, 'safestring.mark_safe('),
      W('shop/views.py', `@${CE}\ndef hook(request):\n    return HttpResponse()\n`, '@csrf_exempt'),
      W('shop/urls.py', `urlpatterns = [path("hook/", ${CE}(views.hook))]\n`, 'csrf_exempt(view)'),
      W('shop/views.py', `@method_decorator(${CE}, name="dispatch")\nclass Hook(View):\n    pass\n`, 'method_decorator(csrf_exempt'),
      S('git commit -m "feat: x"', '커밋: 셸로 쓴 Django 뷰', { setup: stage('shop/v.py', `@${CE}\ndef hook(request):\n    pass\n`) }),
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
      // Django 의 비슷한 꼴
      W('shop/views.py', `br = ${MS}("<br>")\nnote = ${MS}(_("<b>안내</b>"))\n`, 'mark_safe(고정 글자)·_("…")'),
      W('shop/views.py', `html = ${MS}(\n    "<br>"\n)\n`, '여러 줄 고정 글자'),
      W('shop/views.py', 'html = format_html("<b>{}</b>", name)\n', 'format_html'),
      W('shop/views.py', `from django.views.decorators.csrf import ${CE}\nfrom django.utils.safestring import ${MS}\n`, '가져오기만'),
      W('shop/views.py', `from django.views.decorators.csrf import (\n    ${CE},\n)\n`, '여러 줄 가져오기'),
      W('shop/views.py', `# @${CE} 는 쓰지 않는다\ns = "${MS}(x)"\n`, '주석·글자 속'),
      W('shop/views.py', `@${CE}  # lint:allow python-unsafe 결제 웹훅은 서명으로 확인\ndef hook(request):\n    pass\n`, 'csrf_exempt 허용 주석'),
      W('shop/tests/test_views.py', `@${CE}\ndef hook(request):\n    pass\n`, '시험 코드의 csrf_exempt'),
    ],
  },
};
