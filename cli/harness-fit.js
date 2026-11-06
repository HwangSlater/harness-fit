#!/usr/bin/env node
// 터미널에서 바로: npx github:HwangSlater/harness-fit [--lang ko|en] [--undo] [--auto]
//   (기본)   지금 폴더의 저장소를 읽고 고르기 화면을 브라우저에 연다
//   --auto   화면 없이 추천을 보여 준다(적용은 Claude 안에서 /harness-fit:setup auto)
//   --undo   마지막 적용을 되돌린다
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const script = args.includes('--undo') ? 'apply.mjs' : args.includes('--auto') ? 'recommend.mjs' : 'picker.mjs';
const rest = args.filter((a) => a !== '--auto');
spawn(process.execPath, [path.join(root, 'scripts', script), process.cwd(), ...rest], { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
