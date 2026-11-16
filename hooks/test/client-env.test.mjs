// "use client" 지시문 찾기(lib/client-env.mjs isClientFile): 맨 앞 주석·빈 줄 건너뛰기와, 주석이 줄줄이 있어도 빠른지(검토 2026-11-16 — 정규식이 3.6초 걸렸다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClientFile } from '../lib/client-env.mjs';

test('맨 앞 주석·빈 줄 뒤의 지시문만 센다', () => {
  for (const s of ['"use client";\nx', "'use client'\n", '﻿"use client"', '// a\n/* b\n c */\n\n  "use client";', '/** 문서 */ "use client"']) assert.ok(isClientFile(s), JSON.stringify(s));
  for (const s of ['import x from "y";\n"use client";', '"use server";', '// "use client"', '/* "use client" */', '/* 닫히지 않음 "use client"', '`use client`', '', null]) assert.ok(!isClientFile(s), JSON.stringify(s));
});

test('앞 주석이 줄줄이 있어도 빠르다', () => {
  for (const text of ['/* x */\n'.repeat(24) + 'export const a = 1;\n', ' /* */'.repeat(2000), '//\n'.repeat(4000), '/* x */\n'.repeat(500) + '"use client"']) {
    const t0 = performance.now();
    isClientFile(text);
    const ms = performance.now() - t0;
    assert.ok(ms < 50, `${ms.toFixed(0)}ms`);
  }
});
