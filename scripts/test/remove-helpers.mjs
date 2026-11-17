// 지우기·다시 적용 시험이 같이 쓰는 것: 네트워크 없이 스킬을 「받는」 가짜(install-skill.mjs 와 같은 .harness-source.json 꼴), 저장소, 파일 읽기.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmpDir, gitInit } from './helpers.mjs';
import { loadAll } from '../lib/catalog.mjs';

export const all = loadAll();
// 직접 받는(copy) 스킬 둘 — 카탈로그 id 그대로 폴더 이름이 된다
export const [SKILL_A, SKILL_B] = all.catalog.skills.filter((s) => s.install === 'copy').slice(0, 2).map((s) => s.id);
export const baseSel = (over = {}) => ({ lang: 'ko', combo: 'team', skills: [SKILL_A, SKILL_B], hooks: ['secrets', 'protect-branch'], rules: ['collab'], flow: 'github-flow', explore: [], note: '', share: true, ...over });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// 받은 것처럼: SKILL.md 와 보조 파일 하나, 그리고 파일마다 지문을 적은 출처 표시
export const fakeInstall = async (_all, items) => {
  for (const c of items) {
    fs.mkdirSync(path.join(c.path, 'ref'), { recursive: true });
    const files = { 'SKILL.md': `---\nname: ${c.skill}\ndescription: 시험\n---\n본문\n`, 'ref/notes.md': '보조 파일\n' };
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(c.path, f), text);
    const hashes = Object.fromEntries(Object.entries(files).map(([f, text]) => [f, sha(Buffer.from(text))]));
    fs.writeFileSync(path.join(c.path, '.harness-source.json'), JSON.stringify({ id: c.skill, repo: 'x/y', path: '.', sha: 'abc', license: 'MIT', files: hashes }, null, 2));
  }
  return [];
};

export const env = () => {
  const saved = process.env.CLAUDE_PLUGIN_ROOT;
  const tmp = tmpDir('harness-remove-');
  process.env.CLAUDE_PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');
  process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '100000000';
  let seq = 0;
  return {
    tmp,
    // 빈 홈(설치된 플러그인 목록이 이 PC 의 것과 섞이지 않게)
    home: path.join(tmp, 'home'),
    repo: () => gitInit(path.join(tmp, `r${++seq}`), { branch: 'main' }),
    done: () => {
      delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET;
      if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
      else process.env.CLAUDE_PLUGIN_ROOT = saved;
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
};

export const textOf = (dir, rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf8') : null);
// .git 을 뺀 남은 항목(폴더는 끝에 /) — 지운 뒤 무엇이 남았나
export const leftOver = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (!rel && name === '.git') continue;
      const abs = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.lstatSync(abs).isDirectory()) { out.push(`${r}/`); walk(abs, r); } else out.push(r);
    }
  };
  walk(dir, '');
  return out;
};
