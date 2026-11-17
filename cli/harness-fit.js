#!/usr/bin/env node
// 터미널에서 바로: npx github:HwangSlater/harness-fit [--lang ko|en] [--undo] [--remove [--yes]] [--auto]
//   (기본)   지금 폴더의 저장소를 읽고 고르기 화면을 브라우저에 연다
//   --auto   화면 없이 추천을 보여 준다(적용은 Claude 안에서 /harness-fit:setup auto)
//   --undo   마지막 적용을 되돌린다
//   --remove 프로젝트를 끝낼 때 harness-fit 이 넣은 것을 모두 뺀다. 지우기 전에 확인하도록 --yes 가 없으면 뺄 목록만 보인다
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const script = args.includes('--undo') || args.includes('--remove') ? 'apply.mjs' : args.includes('--auto') ? 'recommend.mjs' : 'picker.mjs';
// --undo 와 함께면 「목록만」이라 말하지 않는다 — apply.mjs 가 두 방식을 함께 받지 않고 알린다(conflicting-modes)
const listOnly = args.includes('--remove') && !args.includes('--undo') && !args.includes('--yes') && !args.includes('--dry-run');
const rest = [...args.filter((a) => a !== '--auto' && a !== '--yes'), ...(listOnly ? ['--dry-run'] : [])];
if (listOnly) process.stderr.write('harness-fit: 뺄 목록만 보여요. 지우려면 --yes 를 붙여 다시 실행하세요. / List only — add --yes to remove.\n');
spawn(process.execPath, [path.join(root, 'scripts', script), process.cwd(), ...rest], { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
