// Claude Code 설정 폴더(~/.claude)와 설치된 플러그인 목록. 훅과 scripts 가 함께 쓰므로 node: 내장 모듈만 쓴다(훅이 무거워지지 않게).
// 설정 폴더는 CLAUDE_CONFIG_DIR 로 옮길 수 있다(code.claude.com/docs/en/settings 「Environment variables」).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// home 을 주면(시험이 임시 홈을 넘길 때) 그 아래 .claude, 안 주면 CLAUDE_CONFIG_DIR → ~/.claude
export const claudeHome = (home, env = process.env) => (home ? path.join(home, '.claude') : env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

// installed_plugins.json 의 plugins({ 「이름@마켓」: [{ scope, installPath, projectPath }] }). 없거나 깨졌으면 빈 객체.
export const readInstalledPlugins = (home) => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(claudeHome(home), 'plugins', 'installed_plugins.json'), 'utf8').replace(/^﻿/, ''));
    return j?.plugins && typeof j.plugins === 'object' ? j.plugins : {};
  } catch {
    return {};
  }
};
