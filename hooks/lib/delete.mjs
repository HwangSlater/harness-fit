// 통째로 지우는 명령 찾기: GNU rm, PowerShell Remove-Item 과 별칭(rm·del·erase·ri·rd·rmdir), cmd 의 del·rd /s.
//
// 막는 대상(rm·Remove-Item 모두 같은 정책):
//   - 루트: / · /* · C: · C:\ · C:\* · \ · *
//   - 홈: ~ · $HOME · ${HOME} · $env:USERPROFILE · %USERPROFILE% (와 그 아래 *)
//   - 지금·위 폴더: . · .. · ./ · ./* · .\* · ../*
// ./build·node_modules·C:\work\tmp 처럼 이름 있는 하위 폴더는 둔다.
// GNU rm 은 재귀(-r)와 강제(-f)가 둘 다 있을 때, PowerShell·cmd 는 재귀(-Recurse, /s)만 있어도 본다
// (PowerShell 은 -Recurse 를 주면 하위 항목을 묻지 않고 지운다). -WhatIf 는 실제로 지우지 않으므로 둔다.
import { GIT } from './cmdline.mjs';

const ROOT_TARGET = /^(?:[A-Za-z]:)?[\\/]?\*?$/;
const HOME_TARGET = /^(?:~|\$\{?HOME\}?|\$env:USERPROFILE|%USERPROFILE%)(?:[\\/]\*?)?$/i;
const HERE_TARGET = /^\.{1,2}(?:[\\/]\*?)?$/;
export const isWipeTarget = (x) => x !== '' && (ROOT_TARGET.test(x) || HOME_TARGET.test(x) || HERE_TARGET.test(x));

// 위험 검사용 느슨한 낱말 나누기: 공백으로 자르고 앞뒤 따옴표·괄호를 뗀다(`bash -c "rm -rf /"` 의 `/"` 도 `/` 로).
const looseWords = (args) => args.split(/\s+/).map((w) => w.replace(/^["'(]+|["');]+$/g, '')).filter(Boolean);

const BASH_ESCAPE = '\\';
const gnuRm = (words) => {
  let recursive = false;
  let force = false;
  let endOfOpts = false;
  const targets = [];
  for (const w of words) {
    if (!endOfOpts && w === '--') endOfOpts = true;
    else if (!endOfOpts && w.startsWith('--')) {
      if (w === '--recursive') recursive = true;
      if (w === '--force') force = true;
    } else if (!endOfOpts && /^-[A-Za-z]+$/.test(w)) {
      if (/[rR]/.test(w)) recursive = true;
      if (w.includes('f')) force = true;
    } else targets.push(w);
  }
  // 홀로 선 `\` 는 bash 에서 `find … -exec rm -rf {} \;` 의 이스케이프다(드라이브 루트가 아니다).
  return recursive && force && targets.some((x) => x !== BASH_ESCAPE && isWipeTarget(x));
};

// Remove-Item 매개변수. PowerShell 처럼 대소문자를 가리지 않고, 하나로 정해지는 앞부분 줄임(-r, -rec, -Fo)도 받는다.
const PS_PARAMS = {
  path: 'path', literalpath: 'path', filter: 'value', include: 'value', exclude: 'value', recurse: 'recurse',
  force: 'switch', credential: 'value', whatif: 'whatif', confirm: 'switch', stream: 'value',
};
const PS_ALIASES = { pspath: 'path', lp: 'path', wi: 'whatif', cf: 'switch' };
const PS_NAMES = Object.keys(PS_PARAMS);
const psParam = (name) => {
  const n = name.toLowerCase();
  if (PS_PARAMS[n] || PS_ALIASES[n]) return PS_PARAMS[n] || PS_ALIASES[n];
  const hits = PS_NAMES.filter((p) => p.startsWith(n));
  return hits.length === 1 ? PS_PARAMS[hits[0]] : null;
};
const PS_OPTION = /^-([A-Za-z]+)(?::(.*))?$/;
const PS_FALSE = /^\$false$/i;
// cmd.exe 스위치(/s /q /f …). /s 가 하위 폴더까지 지우기.
const CMD_SWITCH = /^\/[A-Za-z](?::\S*)?$/;
const CMD_RECURSE = /^\/s$/i;

const psRemove = (words, cmdStyle) => {
  let recursive = false;
  const targets = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cmdStyle && CMD_SWITCH.test(w)) {
      if (CMD_RECURSE.test(w)) recursive = true;
      continue;
    }
    const m = w.match(PS_OPTION);
    if (!m) {
      targets.push(...w.split(','));
      continue;
    }
    const kind = psParam(m[1]);
    const off = m[2] !== undefined && PS_FALSE.test(m[2]);
    if (kind === 'whatif' && !off) return false;
    if (kind === 'recurse') recursive = !off;
    else if (kind === 'path') targets.push(...(m[2] ?? words[++i] ?? '').split(','));
    else if (kind === 'value' && m[2] === undefined) i++;
  }
  return recursive && targets.map((x) => x.trim()).some(isWipeTarget);
};

// 명령 이름 → 검사. rm 은 bash 에서는 GNU rm, PowerShell 에서는 Remove-Item 이라 둘 다 본다.
const CHECKS = {
  rm: (w) => gnuRm(w) || psRemove(w, false),
  'remove-item': (w) => psRemove(w, false),
  ri: (w) => psRemove(w, false),
  del: (w) => psRemove(w, true),
  erase: (w) => psRemove(w, true),
  rd: (w) => psRemove(w, true),
  rmdir: (w) => psRemove(w, true),
};
// 앞이 글자·점·- 이면 다른 낱말의 일부다. `git rm`(저장소에서 빼기)은 셸 rm 이 아니다.
const DELETE_CMD = new RegExp(String.raw`(?<![\w.\-$])(?<!${GIT})(rm|del|erase|ri|rd|rmdir|Remove-Item)(?=\s)([^;&|\n]*)`, 'gi');

export const wipesEverything = (cmd) =>
  [...cmd.matchAll(DELETE_CMD)].some((m) => CHECKS[m[1].toLowerCase()](looseWords(m[2])));
