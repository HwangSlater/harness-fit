// 기존 훅 겹침 알아보기를 Stop · SessionStart · UserPromptSubmit 까지(2026-11-06): 가짜 「기존 훅」을 settings 에 두고,
// 시험 입력(catalog/probes.json)에서 같은 일을 하는 것만 겹친다고 보는지, 시험이 사용자 홈을 건드리지 않는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeExistingHooks, listHooks } from '../lib/existing-hooks.mjs';

// 가짜 훅들(CommonJS). 입력은 stdin JSON.
const READ = "const fs=require('fs');const os=require('os');const path=require('path');const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');";
const FAKES = {
  // 커밋 명령이 있었는데 마지막 답에 해시 같은 글이 없으면 막는다(사용자 전역 finish-check 와 같은 일)
  'hash-check.cjs': READ + "const recs=fs.readFileSync(input.transcript_path,'utf8').split('\\n').filter(Boolean).map(JSON.parse);" +
    "const blocks=recs.filter(r=>r.type==='assistant').flatMap(r=>r.message.content);" +
    "const committed=blocks.some(b=>b.type==='tool_use'&&/git commit/.test(b.input.command||''));" +
    "const last=blocks.filter(b=>b.type==='text').map(b=>b.text).pop()||'';" +
    "process.stdout.write(JSON.stringify(committed&&!/\\b[0-9a-f]{7,40}\\b/.test(last)?{decision:'block',reason:'hash'}:{}));",
  // 답을 끝낼 때마다 막는다(다른 이유로 다 막는 훅 — 겹침이 아니다)
  'stop-all.cjs': READ + "process.stdout.write(JSON.stringify({decision:'block',reason:'always'}));",
  // 세션 시작에 체크리스트 경로를 알려 주고(홈 아래), 메시지마다 남은 항목을 보여 준다
  'list-start.cjs': READ + "const f=path.join(os.homedir(),'.claude','fake-lists',input.session_id+'.md');fs.mkdirSync(path.dirname(f),{recursive:true});" +
    "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'checklist: '+f}}));",
  'list-remind.cjs': READ + "const f=path.join(os.homedir(),'.claude','fake-lists',input.session_id+'.md');let t='';try{t=fs.readFileSync(f,'utf8')}catch{}" +
    "const left=[...t.matchAll(/^- \\[ \\] (.+)$/gm)].map(m=>m[1]);" +
    "process.stdout.write(left.length?JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:left.join('\\n')}}):'{}');",
  // 쓴 뒤(PostToolUse)에 보는 훅은 셈하지 않는다
  'post.cjs': READ + "process.exit(2);",
};

test('기존 훅(Stop·SessionStart·UserPromptSubmit): 같은 일을 하면 겹침, 다 막는 훅·쓴 뒤 훅은 아님, 사용자 홈은 그대로', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-root-'));
  const realLists = path.join(os.homedir(), '.claude', 'fake-lists');
  const before = fs.existsSync(realLists);
  try {
    const cmd = {};
    for (const [name, body] of Object.entries(FAKES)) {
      const f = path.join(home, name);
      fs.writeFileSync(f, body);
      cmd[name] = `node "${f.split(path.sep).join('/')}"`;
    }
    const hook = (name) => ({ hooks: [{ type: 'command', command: cmd[name], timeout: 30 }] });
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [hook('hash-check.cjs'), hook('stop-all.cjs')],
        SessionStart: [hook('list-start.cjs')],
        UserPromptSubmit: [hook('list-remind.cjs')],
        PostToolUse: [{ matcher: 'Write|Edit', ...hook('post.cjs') }],
      },
    }));
    assert.deepEqual(listHooks(root, home).map((h) => h.event).sort(), ['SessionStart', 'Stop', 'Stop', 'UserPromptSubmit']);
    const got = await probeExistingHooks(root, { home, trustProject: false });
    assert.deepEqual(Object.keys(got).sort(), ['commit-hash', 'work-checklist'], JSON.stringify(got));
    assert.deepEqual(got['commit-hash'], { scope: 'user', by: ['hash-check.cjs'] });
    assert.deepEqual(got['work-checklist'], { scope: 'user', by: ['list-remind.cjs'] });
    assert.equal(fs.existsSync(realLists), before, '시험이 사용자 홈에 체크리스트를 만들었다');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
