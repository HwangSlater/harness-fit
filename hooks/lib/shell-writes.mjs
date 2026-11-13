// 셸 명령이 쓰거나 지우는 파일(보호 파일 훅이 셸에서도 막으려고 — 역할극 2·3·4 회차: sed -i·>·rm 으로 관절 한계·data/ 를 바꿔도 통과했다, 2026-11-11).
// 적어 둔 꼴만 본다: 넘겨쓰기(> >> &> 2>), tee, sed·perl -i, cp·mv·install(받는 쪽, mv 는 보내는 쪽도), rm·unlink·shred·truncate,
// dd of=, plist 도구(PlistBuddy -c·plutil·defaults write), python -c·ruby -e 의 쓰기 open, PowerShell Set-Content·Add-Content·Out-File·Clear-Content·Remove-Item·Move-Item·Copy-Item·New-Item.
// 변수·명령 치환으로 정한 경로($F, $(…))는 알 수 없어 넘긴다. heredoc 본문은 글이라 보지 않는다(실행기로 넘긴 본문도 — 놓치는 쪽).
// → [{ file, op: 'write'|'delete'|'copy', from?: [보내는 파일], noClobber?, recursive?(폴더째 지우거나 옮김) }]
import { BASH, commandSegments, stripQuoted, splitWords, fillRanges, heredocs, dataMasked } from './cmdline.mjs';
import { runWords } from './run-prefix.mjs';
import { hiddenRuns, execForms } from './hidden-runs.mjs';

const isOpt = (w) => /^-/.test(w);
const unknown = (p) => !p || /[$`]/.test(p) || p === '-' || /^\/dev\//.test(p) || /^&\d$/.test(p) || /^NUL$/i.test(p);

// 넘겨쓰기 대상: 따옴표 밖의 > >> &> 2> 뒤 낱말(따옴표 친 대상도 — 낱말은 원래 글에서 자른다)
const REDIRECT = /(?:^|[^<>&\d])(?:\d|&)?>>?\|?\s*/g;
const redirectTargets = (raw, shell) => {
  const out = [];
  const bare = stripQuoted(raw, shell);
  for (const m of bare.matchAll(REDIRECT)) {
    const at = m.index + m[0].length;
    if (bare[at] === '&') continue; // 2>&1
    const word = splitWords(raw.slice(at), shell)[0];
    if (word) out.push(word);
  }
  return out;
};

// 명령 이름 뒤 낱말. 앞붙이(sudo·env·VAR=값·then·{·exec·eval·if·try {·cmd /c·xargs …)는 막기·묻기와 같은 runWords 로 벗긴다 —
// 따로 둔 목록이 then rm .env·{ rm .env; }·try { Remove-Item .env } 를 놓쳤다(다시 검토 2026-11-13). 컨테이너 안 명령은 벗기지 않는다.
// 넘겨쓰기 기호와 그 대상은 인자에서 뺀다. PowerShell 블록을 닫는 } 뒤는 다른 명령이다(} catch {})
const commandWords = (words) => {
  const line = runWords(words, { hostOnly: true });
  const args = [];
  const rest = line.slice(1);
  for (let k = 0; k < rest.length; k++) {
    if (rest[k] === '}') break;
    if (/^\d?[<>]{1,2}&?$/.test(rest[k])) k++; // `< 파일`, `> 파일` — 대상은 넘겨쓰기에서 따로 본다
    else if (!/^\d?[<>]/.test(rest[k])) args.push(rest[k]);
  }
  return [line[0], args];
};

// PowerShell: 값을 받는 매개변수만 다음 낱말을 먹는다(-Force·-Recurse·-Append 같은 스위치는 값이 없다 — 검토 2026-11-11)
// 공통 매개변수(-ErrorAction Stop 등)와 그 별칭도 값을 받는다 — 빠지면 그 값이 첫 위치 인자로 읽혔다(검토 2026-11-11)
const PS_VALUE = /^(?:Path|LiteralPath|FilePath|Destination|Value|Encoding|Filter|Include|Exclude|Name|ItemType|Width|Stream|Credential|InputObject|Delimiter|Target|ErrorAction|ea|WarningAction|wa|InformationAction|infa|ErrorVariable|ev|WarningVariable|wv|InformationVariable|iv|OutVariable|ov|OutBuffer|ob|PipelineVariable|pv)$/i;
const psArgs = (args) => {
  const named = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^-(\w+)(?::(.+))?$/);
    if (!m) positional.push(args[i]);
    else if (m[2] !== undefined) named[m[1].toLowerCase()] = m[2];
    else if (PS_VALUE.test(m[1]) && args[i + 1] !== undefined) named[m[1].toLowerCase()] = args[++i];
  }
  const path = named.path ?? named.literalpath ?? named.filepath ?? positional[0];
  return { named, positional, path };
};
const ps = (op, pick) => (a) => {
  const p = psArgs(a);
  return pick(p).filter(Boolean).map((file) => ({ file, op }));
};

const plain = (a) => a.filter((w) => !isOpt(w));
const each = (op) => (a) => plain(a).map((file) => ({ file, op }));
const NO_CLOBBER = /^(?:-[a-zA-Z]*n[a-zA-Z]*|--no-clobber|--update=none)$/;
const copyTo = (a) => {
  const noClobber = a.some((w) => NO_CLOBBER.test(w));
  // cp -t 폴더 파일… · --target-directory=폴더: 받는 쪽은 폴더/파일 이름
  const t = a.findIndex((w) => w === '-t' || w === '--target-directory');
  const tEq = a.find((w) => w.startsWith('--target-directory='));
  const dir = tEq ? tEq.split('=')[1] : t >= 0 ? a[t + 1] : null;
  if (dir) {
    // -t 값 자리만 뺀다(--target-directory= 꼴이면 t 가 -1 — 0번 인자를 지우던 일). 끝 / 는 정규식 대신 한 글자씩(긴 글에서 제곱 시간)
    const files = plain(t >= 0 ? a.filter((_, i) => i !== t + 1) : a);
    let end = dir.length;
    while (end > 0 && (dir[end - 1] === '/' || dir[end - 1] === '\\')) end--;
    return files.map((f) => ({ file: `${dir.slice(0, end)}/${f.slice(Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\')) + 1)}`, op: 'copy', from: [f], noClobber }));
  }
  const files = plain(a);
  if (files.length < 2) return [];
  return [{ file: files.at(-1), op: 'copy', from: files.slice(0, -1), noClobber }];
};

const TARGETS = {
  tee: each('write'),
  sed: (a) => {
    if (!a.some((w) => /^(?:-[a-zA-Z]*i|--in-place)/.test(w))) return [];
    const scripted = a.some((w) => /^(?:-[a-zA-Z]*[ef]|--expression|--file)/.test(w));
    const files = a.filter((w, i) => !isOpt(w) && !/^-[a-zA-Z]*[ef]$/.test(a[i - 1] || ''));
    return (scripted ? files : files.slice(1)).map((file) => ({ file, op: 'write' }));
  },
  perl: (a) => (a.some((w) => /^-[a-zA-Z]*i/.test(w)) ? a.filter((w, i) => !isOpt(w) && !/^-[a-zA-Z]*e$/.test(a[i - 1] || '')).map((file) => ({ file, op: 'write' })) : []),
  cp: copyTo,
  // install 은 cp 처럼(받는 쪽이 폴더면 그 안에 같은 이름으로 — install x.py shop/migrations/). -m 모드·-o·-g·-S 값은 뺀다, -d 는 폴더 만들기.
  install: (a) => {
    if (a.some((w) => w === '-d' || w === '--directory' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(w) && !w.startsWith('--'))) return [];
    const valued = (w) => /^-[a-zA-Z]*[mogS]$|^--(?:mode|owner|group|suffix)$/.test(w || '');
    const kept = a.filter((w, i) => !valued(a[i - 1]) || isOpt(w));
    return copyTo(kept);
  },
  // 옮기기: 보내는 쪽은 폴더째 사라진다(recursive), 받는 쪽은 보낸 파일 이름으로 폴더 안에 생길 수 있다(from)
  mv: (a) => {
    const files = plain(a);
    const from = files.slice(0, -1);
    return [...from.map((file) => ({ file, op: 'delete', recursive: true })), ...files.slice(-1).map((file) => ({ file, op: 'write', from }))];
  },
  rm: (a) => {
    // rm -r·-rf·-Rf, --recursive, PowerShell 별칭(rm·del = Remove-Item)의 -Recurse. -Force 의 r 은 아니다.
    const recursive = a.some((w) => /^-[fivdr]*r[fivdr]*$|^--recursive$|^-recurse$/i.test(w));
    return plain(a).map((file) => ({ file, op: 'delete', recursive }));
  },
  unlink: each('delete'),
  shred: each('delete'),
  truncate: (a) => a.filter((w, i) => !isOpt(w) && !/^-[a-zA-Z]*s$|^--size$/.test(a[i - 1] || '')).map((file) => ({ file, op: 'write' })),
  dd: (a) => a.filter((w) => /^of=/.test(w)).map((w) => ({ file: w.slice(3), op: 'write' })),
  'set-content': ps('write', (p) => [p.path]),
  'add-content': ps('write', (p) => [p.path]),
  'clear-content': ps('write', (p) => [p.path]),
  'out-file': ps('write', (p) => [p.path]),
  'remove-item': (a) => {
    const recursive = a.some((w) => /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i.test(w));
    return ps('delete', (p) => [p.path, ...p.positional.slice(1)])(a).map((x) => ({ ...x, recursive }));
  },
  'move-item': (a) => {
    const p = psArgs(a);
    return [{ file: p.path, op: 'delete', recursive: true }, { file: p.named.destination ?? p.positional[p.named.path ? 0 : 1], op: 'write', from: [p.path].filter(Boolean) }].filter((x) => x.file);
  },
  'copy-item': (a) => {
    const p = psArgs(a);
    const to = p.named.destination ?? p.positional[p.named.path ? 0 : 1];
    return to ? [{ file: to, op: 'copy', from: [p.path].filter(Boolean), noClobber: false }] : [];
  },
  // 값 없이 만드는 빈 파일(-Value 없음)은 empty — 보호 파일 훅이 예시 파일로 처음 만들기와 같이 본다(rules/protected-shell.mjs)
  'new-item': (a) => {
    const p = psArgs(a);
    const file = p.path ?? p.named.name;
    return file ? [{ file, op: 'write', empty: p.named.value === undefined && p.positional.length <= 1 }] : [];
  },
  // 클라우드에서 내려받기: 받는 쪽이 이 PC 의 경로면 그 경로에 쓰기, --delete·rsync -d·rclone sync 는 받는 쪽에서 지우기도
  // (aws s3 sync s3://… data/raw/ --delete 가 보호 폴더를 지워도 지나가던 회귀 — 역할극 7 회차 다시, 2026-11-11)
  // 하위 명령 앞의 전역 옵션(aws --region x s3 sync …)은 건너뛴다. 시험 실행(--dryrun·--dry-run·gsutil -n)은 쓰지 않는다(검토 2026-11-11)
  aws: (a) => {
    const i = a.indexOf('s3');
    return i >= 0 && /^(?:cp|sync|mv)$/.test(a[i + 1] || '') && !a.includes('--dryrun') ? cloudDown(a.slice(i + 2), a.includes('--delete')) : [];
  },
  gsutil: (a) => {
    const i = a.findIndex((w) => /^(?:cp|rsync|mv)$/.test(w));
    if (i < 0) return [];
    const rest = a.slice(i + 1);
    // rsync -n · -dn 은 시험 실행. cp -n 은 덮어쓰지 않기(no-clobber)라 쓰기는 그대로다
    if (a[i] === 'rsync' && rest.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w))) return [];
    return cloudDown(rest, a[i] === 'rsync' && rest.some((w) => /^-[a-zA-Z]*d[a-zA-Z]*$/.test(w)));
  },
  // 하위 명령 앞 전역 옵션(rclone --config x.conf sync …)은 건너뛰고, -n 은 --dry-run 의 짧은 꼴(검토 2026-11-11)
  rclone: (a) => {
    const i = a.findIndex((w) => /^(?:copy|sync|move|copyto|moveto)$/.test(w));
    if (i < 0 || a.includes('--dry-run') || a.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w))) return []; // -vn 처럼 묶은 짧은 옵션도
    return cloudDown(a.slice(i + 1), a[i] === 'sync');
  },
};
// plist 도구(역할극 16 회차: PlistBuddy·plutil·defaults write 로 잠근 Info.plist·entitlements 를 고쳐도 지나갔다, 2026-11-13).
// PlistBuddy -c "Add|Set|Delete|Merge|Import|Clear …" <파일> — 마지막 위치 인자가 파일(-c 의 값은 뺀다). -c 없이 여는 대화형은 이 셸에서 쓸 수 없어 보지 않는다
TARGETS.plistbuddy = (a) => {
  const cmds = a.filter((_, i) => a[i - 1] === '-c');
  if (!cmds.some((c) => /^\s*(?:add|set|delete|merge|import|clear|copy)\b/i.test(c))) return [];
  const file = a.filter((w, i) => !isOpt(w) && a[i - 1] !== '-c').at(-1);
  return file ? [{ file, op: 'write' }] : [];
};
// plutil -replace·-insert·-remove <키> … <파일>, -convert <형식> <파일…>. -o <파일> 이 있으면 그 파일에 쓴다(- 는 화면). -lint·-p 는 보기
// -create <형식> <파일> 은 새로 쓴다. -extract 는 -o <파일> 이 있을 때만 그 파일에 쓴다. 파일 뒤에 옵션이 와도(… Info.plist -s) 옵션이 아닌 마지막 낱말이 파일(검토 2026-11-13)
const PLUTIL_EDIT = /^-(?:replace|insert|remove)$/;
TARGETS.plutil = (a) => {
  const conv = a.indexOf('-convert');
  const create = a.indexOf('-create');
  const o = a.indexOf('-o');
  if (a.includes('-extract')) return o >= 0 && a[o + 1] && a[o + 1] !== '-' ? [{ file: a[o + 1], op: 'write' }] : [];
  if (conv < 0 && create < 0 && !a.some((w) => PLUTIL_EDIT.test(w))) return [];
  if (o >= 0) return a[o + 1] && a[o + 1] !== '-' ? [{ file: a[o + 1], op: 'write' }] : [];
  const from = conv >= 0 ? conv : create;
  if (from >= 0) return a.slice(from + 2).filter((w) => !isOpt(w) && w !== '--').map((file) => ({ file, op: 'write' }));
  const last = a.filter((w) => !isOpt(w) && w !== '--').at(-1);
  return last ? [{ file: last, op: 'write' }] : [];
};
// defaults write|delete|import|rename <경로> — 도메인 자리가 경로(/ 가 들거나 .plist)일 때만. .plist 가 없으면 defaults 가 붙인다
TARGETS.defaults = (a) => {
  const pos = a.filter((w) => !isOpt(w));
  if (!/^(?:write|delete|import|rename)$/.test(pos[0] || '') || !pos[1] || !/[\\/]|\.plist$/i.test(pos[1])) return [];
  return [{ file: /\.plist$/i.test(pos[1]) ? pos[1] : `${pos[1]}.plist`, op: 'write' }];
};
// python -c·ruby -e 한 줄 속 쓰기로 여는 파일: open('x', 'w'|'a'|'x'|'+')·Path('x').write_text(…)·File.write('x', …)·File.open('x', 'w')
// 글자 그대로 적은 경로만(변수는 모른다). 글은 4KB 까지만 본다
// open(file='x', mode='w') 이름 붙인 꼴, os.remove·shutil.rmtree·shutil.move 의 글자 경로, IO.write, ruby -i(제자리 고치기)도(검토 2026-11-13)
const OPEN_WRITE = /\bopen\(\s*(?:file\s*=\s*)?(["'])([^"'\n]{1,512})\1\s*,\s*(?:mode\s*=\s*)?(["'])[rbt]*[wax+][^"']{0,4}\3/g;
const PATH_WRITE = /\bPath\(\s*(["'])([^"'\n]{1,512})\1\s*\)\s*\.\s*write_(?:text|bytes)\s*\(/g;
const RUBY_WRITE = /\b(?:(?:File|IO)\.(?:write|binwrite)\(\s*(["'])([^"'\n]{1,512})\1\s*,|File\.open\(\s*(["'])([^"'\n]{1,512})\3\s*,\s*(["'])[rb]*[wa+][^"']{0,4}\5)/g;
const PY_DELETE = /\b(?:os\.(?:remove|unlink|rmdir|removedirs)|shutil\.rmtree)\(\s*(["'])([^"'\n]{1,512})\1/g;
// shutil.move(원본, 대상) · shutil.copy·copy2·copyfile·copytree(원본, 대상) — 둘 다 글자 경로일 때
const PY_MOVE = /\bshutil\.(move|copy|copy2|copyfile|copytree)\(\s*(["'])([^"'\n]{1,512})\2\s*,\s*(["'])([^"'\n]{1,512})\4/g;
const WRITE_OF = (m) => [{ file: m[2] ?? m[4], op: 'write' }];
const PY_RULES = [
  [OPEN_WRITE, WRITE_OF], [PATH_WRITE, WRITE_OF],
  [PY_DELETE, (m) => [{ file: m[2], op: 'delete', recursive: /rmtree|removedirs/.test(m[0]) }]],
  [PY_MOVE, (m) => [...(m[1] === 'move' ? [{ file: m[3], op: 'delete', recursive: true }] : []), { file: m[5], op: 'write', from: [m[3]] }]],
];
const oneLiner = (flag, rules) => (a) => {
  const code = a.filter((_, i) => a[i - 1] === flag).map((c) => c.slice(0, 4096)).join('\n');
  if (!code) return [];
  return rules.flatMap(([re, make]) => [...code.matchAll(re)].flatMap(make));
};
TARGETS.python = oneLiner('-c', PY_RULES);
TARGETS.python3 = TARGETS.python;
TARGETS.py = TARGETS.python; // Windows 의 py 실행기
// ruby -i[.bak] -pe '…' 파일… — 파일을 제자리에서 고친다(-I 는 불러올 폴더라 아니다)
const RUBY_INPLACE = /^-[a-hj-z]*i(?:\.[\w.~-]*)?$/;
const rubyLine = oneLiner('-e', [[RUBY_WRITE, WRITE_OF], [OPEN_WRITE, WRITE_OF]]);
TARGETS.ruby = (a) => {
  const out = rubyLine(a);
  if (!a.some((w) => RUBY_INPLACE.test(w))) return out;
  const hasE = a.some((w) => /^-[a-z]*e$/.test(w));
  const pos = a.filter((w, i) => !isOpt(w) && !/^-[a-z]*e$/.test(a[i - 1] || ''));
  return [...out, ...(hasE ? pos : pos.slice(1)).map((file) => ({ file, op: 'write' }))];
};
const CLOUD_VALUE =/^--(?:exclude|include|profile|region|storage-class|acl|sse|sse-kms-key-id|sse-c|content-type|cache-control|expires|metadata|metadata-directive|endpoint-url|config|filter|transfers|checkers|page-size|expected-size|grants|bwlimit|max-age|min-age|max-size|min-size|log-file|log-level|backup-dir|suffix|tpslimit|exclude-from|include-from|filter-from|files-from|output|query|compare-dest|copy-dest)$|^-[hpxo]$/;
// rclone 원격 이름(remote:경로)도 — C:\ 같은 드라이브(한 글자 x: 꼴)는 아님
const REMOTE_PATH = /^(?:s3|gs|az|https?):\/\/|^[\w-]{2,}:(?!\\|\/\/)/;
// 위치 인자(옵션과 그 값은 뺌)의 마지막이 받는 쪽. 옵션=값 꼴(--page-size=100)은 낱말 하나라 저절로 빠진다
// 받는 쪽 = 원격 주소(s3://·gs://·remote:) 바로 다음 위치 인자 — 값 옵션 목록이 모자라도 뒤의 옵션 값을 받는 쪽으로 읽지 않게(검토 2026-11-11)
const cloudDown = (args, deletes) => {
  const pos = args.filter((w, i) => !w.startsWith('-') && !CLOUD_VALUE.test(args[i - 1] || ''));
  // 원본을 여럿 줄 수 있다(gsutil cp gs://a gs://b data/raw/) — 마지막 원격 주소 다음 인자(검토 2026-11-11)
  const src = pos.findLastIndex((w) => REMOTE_PATH.test(w));
  const to = src >= 0 ? pos[src + 1] : null;
  if (!to || REMOTE_PATH.test(to) || /^[A-Za-z]:$/.test(to) || to === '-') return [];
  return [{ file: to, op: 'write' }, ...(deletes ? [{ file: to, op: 'delete', recursive: true }] : [])];
};
TARGETS.del = TARGETS.rm;
TARGETS.erase = TARGETS.rm;
TARGETS.ri = TARGETS['remove-item'];
TARGETS.sc = TARGETS['set-content'];
TARGETS.ac = TARGETS['add-content'];
TARGETS.move = TARGETS['move-item'];
TARGETS.copy = TARGETS['copy-item'];
TARGETS.cpi = TARGETS['copy-item'];
TARGETS.mi = TARGETS['move-item'];
TARGETS.ni = TARGETS['new-item'];

// 이 명령이 쓰거나 지우는 파일들. heredoc 본문만 가리고 읽는다(echo·커밋 메시지 속 글은 명령 이름 자리가 아니라 저절로 빠진다).
// 숨은 실행(백틱·$(…)·echo "X" | bash·find -exec·find -delete)도 본다(lib/hidden-runs.mjs — 막기·danger-cmd 와 같은 길)
const unHeredoc = (text) => fillRanges(text, heredocs(text).map((h) => [h.start, h.end]));
export const shellWrites = (cmd, shell = BASH) => {
  const out = [];
  const runs = [{ cmd: unHeredoc(cmd), shell }, ...hiddenRuns(cmd, shell, dataMasked(cmd, shell)).map((h) => ({ ...h, cmd: unHeredoc(h.cmd) }))];
  // at: 바깥 명령 조각의 시작 자리(있는지 확인 구간과 견주려고 — lib/exist-guard.mjs). subst: 백틱·$(…) 속에서 실행되는 것(막는 글에 그 까닭을 덧붙이려고)
  runs.forEach((run, k) => {
    for (const seg of commandSegments(run.cmd, run.shell)) {
      const where = k === 0 ? { at: seg.start } : run.subst ? { subst: true } : {};
      for (const file of redirectTargets(seg.raw, run.shell)) out.push({ file, op: 'write', ...where });
      for (const words of [seg.words, ...execForms(seg.words)]) {
        const [name, args] = commandWords(words);
        // python3.12 같은 판 붙은 이름도 python 으로
        const pick = TARGETS[name] || (/^python[\d.]+$/.test(name || '') ? TARGETS.python : null);
        if (pick) out.push(...pick(args).map((x) => ({ ...x, ...where })));
      }
    }
  });
  return out.filter((x) => !unknown(x.file));
};
