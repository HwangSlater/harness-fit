// SKILL.md(또는 명령 .md) 머리말 읽기: name · description · when_to_use · disable-model-invocation.
// YAML 전체를 읽지 않고, 스킬 머리말에 실제로 쓰이는 꼴만 본다 — 한 줄 값, 따옴표 값(여러 줄 포함), 블록 값(> >- | |-), 들여 쓴 이어지는 줄.
// 머리말에 description 이 없으면 Claude Code 는 본문 첫 문단을 설명으로 쓴다(code.claude.com/docs/en/skills 「Frontmatter reference」).

const unquote = (v) => {
  const s = v.trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') return s.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n');
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
};

// 머리말 글 → { 키: 글 }. 값 모양이 틀려도 오류를 내지 않고 읽을 수 있는 만큼만 읽는다.
export const parseFrontmatter = (text) => {
  const m = String(text ?? '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fields: {}, body: String(text ?? '') };
  const lines = m[1].split(/\r?\n/);
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):[ \t]*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    const more = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && /^[ \t]+\S/.test(lines[i + 2] || '')))) more.push(lines[++i]);
    const block = rest.trim().match(/^([>|])[-+]?$/);
    if (block) {
      const ls = more.map((l) => l.trim());
      fields[key] = block[1] === '|' ? ls.join('\n').trim() : ls.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      fields[key] = unquote([rest, ...more.map((l) => l.trim())].join(' ').trim());
    }
  }
  return { fields, body: String(text).slice(m.index + m[0].length) };
};

// 본문 첫 문단(머리 # 줄은 건너뜀) — description 이 없을 때 대신 쓰이는 글
const firstParagraph = (body) => {
  for (const para of body.split(/\r?\n\s*\r?\n/)) {
    const p = para.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join(' ').trim();
    if (p) return p;
  }
  return '';
};

// 스킬 하나의 목록 글: { name, description, whenToUse, hidden(설명이 목록에 안 들어감) }
export const skillMeta = (text, fallbackName = '') => {
  const { fields, body } = parseFrontmatter(text);
  return {
    name: fields.name || fallbackName,
    description: fields.description || firstParagraph(body),
    whenToUse: fields.when_to_use || '',
    hidden: /^true$/i.test(fields['disable-model-invocation'] || ''),
  };
};

// 「언제 쓰는지」를 밝히는지(부드러운 검사 — 보고만 한다). when_to_use 가 있거나 설명에 쓰는 때를 말하는 꼴이 있으면 참.
const SAYS_WHEN = /\b((use|load|apply|invoke) (this |it )?(skill )?(when|whenever|for|to|if|before|after|while|during|any ?time)|applies to (tasks|work)|when (the user|you|asked|working|writing|building|reviewing|a |an |users?)|trigger(s|ed)? (on|when)|invoke (when|for)|used (when|for|to)|apply when|helps? (you )?(when|with))\b|할 때|때 (사용|쓴|쓰)/i;
export const saysWhen = (meta) => !!meta.whenToUse || SAYS_WHEN.test(meta.description);

// 보고: 목록 예산을 가장 많이 쓰는 것, 잘리는 것, 쓰는 때를 밝히지 않는 것
export const descReport = (skills, top = 10, cap = 1536) => {
  const known = skills.filter((s) => Number.isFinite(s.descChars));
  return {
    total: skills.length,
    measured: known.length,
    truncated: known.filter((s) => s.descChars > cap).map((s) => `${s.id}(${s.descChars})`),
    noWhen: known.filter((s) => s.saysWhen === false).map((s) => s.id),
    longest: [...known].sort((a, b) => b.descChars - a.descChars).slice(0, top).map((s) => `${s.id}(${s.descChars})`),
    median: known.length ? [...known].map((s) => s.descChars).sort((a, b) => a - b)[Math.floor(known.length / 2)] : null,
  };
};
