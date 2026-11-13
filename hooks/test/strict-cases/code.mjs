// 코드 훅 엄격 사례: unsafe-html · pin-deps · gha-inject · prefer-gh. 위험한 글은 이어 붙여 만든다.
import { S, B, P, W, E, F, stage } from './helpers.mjs';

const IH = 'inner' + 'HTML';
const EV = 'ev' + 'al';
const SF = 'sa' + 'fe';
const pkg = (deps) => JSON.stringify({ name: 'app', ...deps }, null, 2) + '\n';
const wf = (steps, on = 'push') => `on: ${on}\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
const prt = (body) => `on:\n  pull_request_target:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;
const SHA = 'a'.repeat(40);
const WF = '.github/workflows/ci.yml';

export default {
  'unsafe-html': {
    block: [
      W('src/view.js', `el.${IH} = name;\n`, 'innerHTML 대입'),
      W('src/view.js', `el.outer${IH.slice(5)} = html;\n`, 'outerHTML 대입'),
      W('src/view.js', `el.${IH} += \`<li>\${item}</li>\`;\n`, 'innerHTML += 템플릿'),
      W('src/view.js', `el['${IH}'] = name;\n`, "el['innerHTML'] 대입"),
      W('src/view.js', "el.insertAdjacent" + "HTML('beforeend', row);\n", 'insertAdjacentHTML'),
      W('src/view.js', 'document.wri' + 'te(msg);\n', 'document.write'),
      W('src/Card.tsx', '<div dangerouslySet' + 'InnerHTML={{ __html: body }} />\n', 'dangerouslySetInnerHTML'),
      W('src/Card.vue', '<div v-ht' + 'ml="body"></div>\n', 'v-html'),
      W('src/Card.svelte', '<div>{@ht' + 'ml body}</div>\n', '{@html}'),
      W('src/Card.astro', '<Fragment set:ht' + 'ml={body} />\n', 'set:html'),
      W('src/app.component.html', `<div [${IH}]="body"></div>\n`, 'Angular [innerHTML]'),
      W('src/safe.ts', 'this.s.bypassSecurityTrust' + 'Html(x);\n', 'bypassSecurityTrustHtml'),
      W('src/frag.js', 'range.createContextual' + 'Fragment(html);\n', 'createContextualFragment'),
      W('src/run.ts', `const r = ${EV}(code);\n`, 'eval('),
      W('src/run.ts', `const r = window.${EV}(code);\n`, 'window.eval('),
      W('src/run.ts', `const r = (0, ${EV})(code);\n`, '(0, eval)('),
      W('src/run.ts', "const f = new Func" + "tion('a', body);\n", 'new Function('),
      W('src/run.ts', "const g = Func" + "tion('return this')();\n", 'Function( (new 없이)'),
      W('src/view.js', `const u = "a//b"; el.${IH} = name;\n`, '앞 글자 속 // 를 주석으로 잘못 보지 않기'),
      W('public/index.html', `<script>document.body.${IH} = location.hash;</script>\n`, 'HTML 파일 속 스크립트'),
      W('src/list.js', `el.${IH} = \`<h2>\${escapeHtml(item.title)}</h2>\${item.description}\`;\n`, '정화 함수를 거치지 않은 값이 하나 섞임'),
      W('src/list.js', `el.${IH} = '<b>' + sanitizeUrl(x.url) + '</b>' + x.bio;\n`, '+ 로 이은 값 하나가 그냥 값'),
      W('src/run.ts', `const s = "x"; ${EV}(code);\n`, '글자 뒤의 eval('),
      W('src/run.ts', `const s = \`\${${EV}(code)}\`;\n`, '템플릿 ${ } 안의 eval('),
      W('public/a.html', `<button onclick="${EV}(location.hash)">x</button>\n`, 'HTML 속성 값 속 eval('),
      // 서버 템플릿(Django·Jinja) — 역할극 9 회차
      W('shop/templates/shop/item.html', `<div>{{ item.body|${SF} }}</div>\n`, 'Django {{ x|safe }}'),
      W('shop/templates/shop/item.html', `<div>{{ item.body | ${SF} }}</div>\n`, '{{ x | safe }} 띄어쓰기'),
      W('shop/templates/shop/list.html', `{{ notes|${SF}seq|join:", " }}\n`, '|safeseq'),
      W('shop/templates/shop/item.html', `{% autoescape off %}\n{{ item.body }}\n{% endautoescape %}\n`, '{% autoescape off %}'),
      W('app/templates/mail.jinja2', `{%- autoescape false -%}{{ body }}{%- endautoescape -%}\n`, 'Jinja {% autoescape false %}'),
      W('views/page.njk', `<p>{{ text | ${SF} }}</p>\n`, 'Nunjucks .njk'),
      W('app/templates/a.j2', `{# 설명 #}<p>{{ text|${SF} }}</p>\n`, '주석 뒤의 |safe'),
      W('shop/templates/shop/item.html', `<!-- {{ item.body|${SF} }} -->\n`, 'HTML 주석 속도 서버가 그린다'),
      S('git commit -m "feat: x"', '커밋: 셸로 쓴 템플릿', { setup: stage('shop/templates/shop/a.html', `{{ item.body|${SF} }}\n`) }),
      E('src/view.js', 'const a = 1;', `el.${IH} = name;`, 'Edit 로 넣기', { setup: (r) => r.put('src/view.js', 'const a = 1;\n') }),
      S('git commit -m "feat: x"', '커밋: 셸로 쓴 파일', { setup: stage('src/r.js', `el.${IH} = name;\n`) }),
      S('git commit -am "feat: x"', '커밋: commit -a', {
        setup: (r) => {
          r.commit('src/r.js', 'const a = 1;\n', 'chore: 시작');
          r.put('src/r.js', `const a = 1;\nel.${IH} = name;\n`);
        },
      }),
      B("printf 'x' >> src/r.js && git commit -am 'feat: x'", '커밋: 같은 명령에서 쓰고 커밋'),
    ],
    pass: [
      W('src/view.js', 'el.textContent = name;\n', 'textContent'),
      W('src/view.js', `el.${IH} = '';\n`, '빈 글자'),
      W('src/view.js', `el.${IH} = "<br>";\n`, '고정 글자'),
      W('src/view.js', `const h = el.${IH};\n`, '읽기'),
      W('src/view.js', `if (el.${IH} === '') {}\n`, '비교'),
      W('src/view.js', `el.${IH} = DOMPurify.sanitize(html);\n`, 'DOMPurify'),
      W('src/view.js', `el.${IH} = escapeHtml(name);\n`, 'escapeHtml'),
      W('src/view.js', `el.${IH} = \`<h2>\${escapeHtml(a)}</h2>\${escapeHtml(b)}\`;\n`, '모든 값이 escapeHtml'),
      W('src/view.js', `el.${IH} = \`\n  <div class="empty">\n    <p>비어 있어요</p>\n  </div>\n\`;\n`, '여러 줄 고정 템플릿'),
      W('src/view.js', `await page.$${EV}('#a', (e) => e.value);\n`, 'page.$eval'),
      W('src/view.js', `redis.${EV}(script, 0);\n`, 'redis.eval'),
      W('src/view.js', 'const evaluate = (x) => x;\nconst isFunction = (f) => typeof f;\n', '이름만 비슷한 것'),
      W('src/view.js', `// el.${IH} = name 는 쓰지 않는다\n`, '주석'),
      W('src/msg.ts', `const tip = "don't call ${EV}(x) or set el.${IH} = y";\n`, '글자 속 낱말'),
      W('src/msg.ts', `const tip = \`use \${name} instead of ${EV}(x)\`;\n`, '템플릿 고정 부분 속 낱말'),
      W('src/view.js', `el.${IH} = trusted; // lint:allow unsafe-html 서버가 만든 고정 틀\n`, '허용 주석'),
      W('src/view.test.js', `document.body.${IH} = fixture;\n`, '테스트 파일'),
      W('README.md', `el.${IH} = name\n`, '문서'),
      W('src/a.py', `${EV}(x)\n`, '대상 아닌 언어'),
      E('src/view.js', `el.${IH} = name;\nconst a = 1;`, `el.${IH} = name;\nconst a = 2;`, '이미 있던 줄', { setup: (r) => r.put('src/view.js', `el.${IH} = name;\nconst a = 1;\n`) }),
      S('git commit -m "feat: x"', '커밋: 안전한 파일', { setup: stage('src/r.js', 'el.textContent = name;\n') }),
      // 템플릿의 비슷한 꼴
      W('shop/templates/shop/item.html', `{# {{ item.body|${SF} }} 는 쓰지 않는다 #}\n`, '{# #} 주석 속'),
      W('shop/templates/shop/item.html', `{% comment %}\n{{ item.body|${SF} }}\n{% endcomment %}\n`, '{% comment %} 블록 속'),
      W('shop/templates/shop/item.html', `<p>{{ item.body|${SF}guard }} {{ x|${SF}_join }}</p>\n`, '|safeguard 같은 다른 필터'),
      W('shop/templates/shop/item.html', '<p>{{ item.body|escape }} {{ item.body }}</p>\n', '|escape·그냥 값'),
      W('src/app.component.html', `<p>{{ a || ${SF} }}</p>\n`, 'Vue·Angular 의 || (또는)'),
      W('shop/templates/shop/item.html', '{% autoescape on %}{{ x }}{% endautoescape %}\n', 'autoescape on'),
      W('shop/templates/shop/item.html', `<p>${SF} 하게 쓰세요 | ${SF}</p>\n`, '{{ }} 밖의 글'),
      W('shop/templates/shop/item.html', `{{ item.body|${SF} }} {# lint:allow unsafe-html 관리자가 쓴 고정 안내문 #}\n`, '템플릿 허용 주석'),
      W('tests/templates/item.html', `{{ item.body|${SF} }}\n`, '시험 폴더의 템플릿'),
    ],
  },

  'pin-deps': {
    block: [
      W('package.json', pkg({ dependencies: { react: '^18.2.0' } }), '^ 범위'),
      W('package.json', pkg({ dependencies: { lodash: '~4.17.21' } }), '~ 범위'),
      W('package.json', pkg({ devDependencies: { vitest: 'latest' } }), 'latest'),
      W('package.json', pkg({ dependencies: { a: '*' } }), '*'),
      W('package.json', pkg({ dependencies: { a: '>=1.0.0' } }), '>='),
      W('package.json', pkg({ dependencies: { a: '1.x' } }), 'x 범위'),
      W('apps/web/package.json', pkg({ optionalDependencies: { fsevents: '^2.3.0' } }), '하위 폴더·optional'),
      W('package.json', pkg({ dependencies: { foo: 'npm:bar@^1.0.0' } }), 'npm: 별칭 범위'),
      E('package.json', '"react": "18.2.0"', '"react": "^18.3.1"', 'Edit 로 범위로 바꾸기', { setup: (r) => r.put('package.json', pkg({ dependencies: { react: '18.2.0' } })) }),
      S('git commit -m "chore: x"', '커밋: npm install 이 넣은 범위(셸로 바뀐 package.json)', {
        setup: (r) => {
          r.commit('package.json', pkg({ dependencies: { react: '18.2.0' } }), 'chore: 시작');
          r.put('package.json', pkg({ dependencies: { react: '18.2.0', 'left-pad': '^1.3.0' } }));
          r.git('add', 'package.json');
        },
      }),
      S('git commit -am "chore: x"', '커밋: commit -a', {
        setup: (r) => {
          r.commit('package.json', pkg({ dependencies: { react: '18.2.0' } }), 'chore: 시작');
          r.put('package.json', pkg({ dependencies: { react: '^18.2.0' } }));
        },
      }),
      B('npm install left-pad && git add package.json && git commit -m "chore: x"', '커밋: 설치하고 같은 명령에서 커밋(볼 수 없어 막음)'),
      P('npm install left-pad; git add package.json; git commit -m "chore: x"', '커밋: PowerShell 같은 꼴'),
    ],
    pass: [
      W('package.json', pkg({ dependencies: { react: '18.2.0', ui: 'workspace:*' } }), '고정·workspace'),
      W('package.json', pkg({ peerDependencies: { react: '^18.0.0' }, engines: { node: '>=18' } }), 'peer·engines'),
      W('package.json', pkg({ dependencies: { a: 'file:../a', b: 'github:o/b', c: 'git+https://x.io/c.git' } }), '로컬·git'),
      W('node_modules/x/package.json', pkg({ dependencies: { a: '^1.0.0' } }), 'node_modules'),
      E('package.json', '"name": "app"', '"name": "web"', '이미 있던 범위는 그대로', { setup: (r) => r.put('package.json', pkg({ dependencies: { lodash: '^4.0.0' } })) }),
      W('package.json', '{ not json', '깨진 JSON'),
      S('git commit -m "chore: x"', '커밋: 고정 버전 추가', {
        setup: (r) => {
          r.commit('package.json', pkg({ dependencies: { lodash: '^4.0.0' } }), 'chore: 시작');
          r.put('package.json', pkg({ dependencies: { lodash: '^4.0.0', react: '18.2.0' } }));
          r.git('add', 'package.json');
        },
      }),
    ],
  },

  'gha-inject': {
    block: [
      W(WF, wf('      - run: echo "${{ github.event.issue.title }}"\n', 'issues'), 'run 에 이슈 제목'),
      W(WF, wf('      - run: |\n          git checkout ${{ github.head_ref }}\n', 'pull_request'), '블록 run 에 head_ref'),
      W(WF, wf('      - run: echo\n          ${{ github.event.pull_request.body }}\n', 'pull_request'), '여러 줄로 이어 쓴 run'),
      W(WF, wf('      - run: echo "${{ github.event.commits[0].message }}"\n'), '커밋 메시지'),
      W(WF, wf('      - run: echo "${{ github.event.comment.body }}"\n', 'issue_comment'), '댓글 본문'),
      W(WF, prt('      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n'), 'pull_request_target + head.sha'),
      W(WF, prt('      - uses: actions/checkout@v4\n        with:\n          ref: refs/pull/${{ github.event.number }}/merge\n'), 'pull_request_target + refs/pull'),
      W(WF, prt('      - run: gh pr checkout ${{ github.event.number }}\n'), 'pull_request_target + gh pr checkout'),
      W(WF, prt('      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n'), 'pull_request_target + head.sha || …'),
      W(WF, wf('      - {name: x, run: "echo ${{ github.event.issue.title }}"}\n', 'issues'), '한 줄 꼴 { run: … }'),
      W(WF, wf('      - uses: tj-actions/changed-files@v45\n'), '남의 액션 태그'),
      W(WF, wf('      - uses: actions/github-script@v7\n        with:\n          script: |\n            console.log("${{ github.event.issue.title }}")\n', 'issues'), 'github-script 의 script: 에 이슈 제목'),
      W('.github/workflows/r.yaml', 'jobs:\n  call:\n    uses: other/repo/.github/workflows/x.yml@main\n', '재사용 워크플로 브랜치(.yaml)'),
      E(WF, '      - uses: actions/checkout@v4', '      - uses: some/action@main', 'Edit 로 넣기', { setup: (r) => r.put(WF, wf('      - uses: actions/checkout@v4\n')) }),
      S('git commit -m "ci: x"', '커밋: 셸로 쓴 워크플로', { setup: stage(WF, wf('      - uses: tj-actions/changed-files@v45\n')) }),
    ],
    pass: [
      W(WF, wf('      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: echo "$TITLE"\n', 'issues'), 'env 로 넘기기'),
      W(WF, wf('      - run: echo "${{ github.event.repository.name }} ${{ github.sha }} ${{ github.event.pull_request.base.ref }}"\n'), '저장소 쪽 값'),
      W(WF, wf(`      - uses: actions/checkout@v4\n      - uses: github/codeql-action/init@v3\n      - uses: ./.github/actions/local\n      - uses: docker://alpine:3.20\n      - uses: tj-actions/changed-files@${SHA} # v45\n`), 'actions/·github/·로컬·docker·해시'),
      W(WF, wf('      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n', 'pull_request'), 'pull_request(대상 아님) + head.sha'),
      W(WF, prt('      - uses: actions/checkout@v4\n      - run: echo hi\n'), 'pull_request_target 이지만 PR 코드는 안 받음'),
      W(WF, '# run: echo "${{ github.event.issue.title }}"\non: push\n', '주석'),
      W('docs/ci.yml', 'steps:\n  - uses: tj-actions/changed-files@v45\n', '워크플로 폴더 밖'),
      E(WF, 'on: push', 'on: [push, workflow_dispatch]', '이미 있던 줄', { setup: (r) => r.put(WF, wf('      - uses: tj-actions/changed-files@v45\n')) }),
      W(WF, wf('      - uses: acme/shared/.github/workflows/x.yml@main\n'), '같은 owner 의 재사용 워크플로', { setup: (r) => r.git('remote', 'add', 'origin', 'https://github.com/acme/app.git') }),
    ],
  },

  'prefer-gh': {
    block: [
      F('https://github.com/octocat/Hello-World/blob/master/README', 'blob 페이지'),
      F('http://github.com/a/b/issues/1', 'http 이슈'),
      F('https://www.github.com/a/b', 'www'),
      F('https://github.com', '주소만'),
      F('https://GitHub.com/a/b/pulls', '대문자'),
    ],
    pass: [
      F('https://docs.github.com/en/get-started', 'docs.github.com'),
      F('https://raw.githubusercontent.com/a/b/main/x', 'raw 주소(약속 밖)'),
      F('https://example.com/github.com/a', '다른 사이트 경로'),
      F('https://github.community/t/1', '다른 도메인'),
    ],
  },
};
