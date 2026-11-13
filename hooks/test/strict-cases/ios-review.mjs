// 역할극 16 회차(iOS) 판정(2026-11-13)의 훅 쪽 고칠 점: git add -f 로 올린 무시 파일·.cer·.provisionprofile 커밋 막기,
// plist 도구(PlistBuddy·plutil·defaults write)와 python -c·ruby -e 쓰기, 빌드·버전 번호 올리기 묻기, match --readonly false,
// 프로비저닝 프로필 폴더 지우기 묻기, NSLog(. strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import fs from 'node:fs';
import { S, B, P, W, keyed } from './helpers.mjs';

const combos = JSON.parse(fs.readFileSync(new URL('../../../catalog/combos.json', import.meta.url), 'utf8'));
const IOS = combos.stackAddons.find((a) => a.when.includes('iOS') && a.hookOpts?.['ask-cmd']).hookOpts['ask-cmd'];
const IOS_MATCH = { ...IOS, commands: [...IOS.commands, 'fastlane match'] };
const REMOTE = { commands: [] };
const PLIST = { paths: ['Ggumi/Info.plist', '*.entitlements'] };
const NONE = { paths: [] };

// .gitignore 에 든 비밀 설정 파일(아직 추적하지 않음)
const IGNORED = keyed('ios-ignored', (r) => {
  r.put('.gitignore', 'Config/Secrets.xcconfig\nbuild/\n');
  r.put('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo\n');
  r.put('build/notes.txt', 'x\n');
  r.put('Sources/App.swift', 'let x = 1\n');
});
// 사람이 미리 git add -f 해 둔 무시 파일
const PRESTAGED = keyed('ios-prestaged', (r) => {
  IGNORED(r);
  r.git('add', '-f', 'Config/Secrets.xcconfig');
});
// 무시 목록에 있지만 이미 추적 중인 파일(사람이 고친 값을 커밋하는 꼴)
const TRACKED = keyed('ios-tracked', (r) => {
  r.commit('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo\n', 'chore: 설정 틀');
  r.put('.gitignore', 'Config/Secrets.xcconfig\n');
  r.commit('.gitignore', 'Config/Secrets.xcconfig\n', 'chore: 무시');
  r.put('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo2\n');
});
// 키 파일 이름(.provisionprofile) — 무시 목록에 없어도. .cer 는 공개 인증서라 무시 목록에 있을 때만 막는다(검토 2026-11-13)
const CERTS = keyed('ios-certs', (r) => {
  r.put('signing/dist.cer', 'x\n');
  r.put('signing/Ggumi_AppStore.provisionprofile', 'x\n');
});
const IGNORED_CER = keyed('ios-ignored-cer', (r) => {
  r.put('.gitignore', '*.cer\n');
  r.put('signing/dist.cer', 'x\n');
});

export default {
  'ask-cmd': {
    block: [
      // C. 빌드·버전 번호 올리기(iOS 스택 기본값)
      S('agvtool next-version -all', 'agvtool next-version', { opts: IOS }),
      S('xcrun agvtool bump -all', 'xcrun 뒤 agvtool bump', { opts: IOS }),
      S('fastlane run increment_build_number build_number:42', 'run 꼴 빌드 번호', { opts: IOS }),
      S('bundle exec fastlane run increment_version_number bump_type:patch', 'bundle exec + 버전 번호', { opts: IOS }),
      // D. --readonly 뒤 false 는 읽기 전용이 아니다
      S('fastlane match appstore --readonly false', '--readonly false', { opts: IOS_MATCH }),
      S('bundle exec fastlane match appstore --readonly 0', '--readonly 0', { opts: IOS_MATCH }),
      S('fastlane match development --readonly=false', '--readonly=false', { opts: IOS_MATCH }),
      S('fastlane match appstore readonly:false', 'readonly:false', { opts: IOS_MATCH }),
      // E. 프로비저닝 프로필 폴더 지우기
      B('rm -rf ~/Library/MobileDevice/Provisioning\\ Profiles/*', '~ 경로와 역슬래시 띄어쓰기', { opts: REMOTE }),
      B('rm -rf "$HOME/Library/MobileDevice/Provisioning Profiles"', '$HOME 경로', { opts: REMOTE }),
      P('Remove-Item -Recurse -Force "$HOME/Library/MobileDevice/Provisioning Profiles/*"', 'PowerShell Remove-Item', { opts: REMOTE }),
      B('sudo rm -r "/Users/me/Library/MobileDevice/Provisioning Profiles/abc.mobileprovision"', 'sudo + 프로필 하나', { opts: REMOTE }),
    ],
    pass: [
      S('agvtool what-version', '버전 보기', { opts: IOS }),
      S('agvtool what-marketing-version', '마케팅 버전 보기', { opts: IOS }),
      S('fastlane run get_version_number', '버전 읽기 동작', { opts: IOS }),
      S('fastlane match appstore --readonly', '--readonly', { opts: IOS_MATCH }),
      S('fastlane match appstore --readonly true', '--readonly true', { opts: IOS_MATCH }),
      S('fastlane match appstore --readonly=true', '--readonly=true', { opts: IOS_MATCH }),
      B('ls ~/Library/MobileDevice/Provisioning\\ Profiles', '프로필 목록 보기', { opts: REMOTE }),
      B('rm -rf ~/Library/Developer/Xcode/DerivedData', 'DerivedData 지우기', { opts: REMOTE }),
      B('echo "rm -rf ~/Library/MobileDevice/Provisioning Profiles"', 'echo 속 글', { opts: REMOTE }),
      S('rm -rf ~/Library/MobileDevice/Provisioning', '이름이 다른 폴더', { opts: REMOTE }),
    ],
  },

  'protected-files': {
    block: [
      // B. plist 도구·한 줄 스크립트로 잠근 Info.plist·entitlements 고치기
      S('/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" Ggumi/Info.plist', 'PlistBuddy Add', { opts: PLIST }),
      S('/usr/libexec/PlistBuddy -c "Delete :NSCameraUsageDescription" Ggumi/Info.plist', 'PlistBuddy Delete', { opts: PLIST }),
      S('PlistBuddy -c "Set :CFBundleVersion 42" ./Ggumi/Info.plist', 'PlistBuddy Set, ./ 경로', { opts: PLIST }),
      S('plutil -replace aps-environment -string production Ggumi/Ggumi.entitlements', 'plutil -replace entitlements', { opts: PLIST }),
      B("plutil -insert NSAppTransportSecurity -json '{\"NSAllowsArbitraryLoads\":true}' Ggumi/Info.plist", 'plutil -insert', { opts: PLIST }),
      S('plutil -remove NSCameraUsageDescription Ggumi/Info.plist', 'plutil -remove', { opts: PLIST }),
      S('plutil -convert binary1 Ggumi/Info.plist', 'plutil -convert 제자리', { opts: PLIST }),
      S('plutil -convert xml1 -o Ggumi/Info.plist Other.plist', 'plutil -o 로 덮어쓰기', { opts: PLIST }),
      S('defaults write ./Ggumi/Info NSAllowsArbitraryLoads -bool YES', 'defaults write 경로(.plist 를 붙임)', { opts: PLIST }),
      S('defaults delete ./Ggumi/Info.plist NSCameraUsageDescription', 'defaults delete', { opts: PLIST }),
      S("python3 -c \"open('Ggumi/Info.plist','w').write('x')\"", 'python -c open w', { opts: PLIST }),
      S("python -c \"import pathlib; pathlib.Path('Ggumi/Info.plist').write_text('x')\"", 'Path.write_text', { opts: PLIST }),
      S("ruby -e \"File.write('Ggumi/Ggumi.entitlements', 'x')\"", 'ruby File.write', { opts: PLIST }),
      // A. Claude 가 만드는 커밋이 새로 넣는 무시 파일·키 파일
      B('git add -f Config/Secrets.xcconfig && git commit -m "chore: 설정"', 'git add -f 로 올린 무시 파일', { opts: NONE, setup: IGNORED, reason: /ignored by git \(\.gitignore/ }),
      B('git add -f build/notes.txt && git commit -m "chore: x"', '무시 폴더 속 파일', { opts: NONE, setup: IGNORED }),
      S('git commit -m "chore: 설정"', '미리 stage 된 무시 파일도 Claude 의 커밋이면', { opts: NONE, setup: PRESTAGED }),
      B('git add -f signing/dist.cer && git commit -m "chore: 인증서"', '무시 목록의 .cer 를 add -f', { opts: NONE, setup: IGNORED_CER }),
      B('git add signing/Ggumi_AppStore.provisionprofile && git commit -m "chore: 프로필"', '.provisionprofile', { opts: NONE, setup: CERTS }),
      W('signing/x.provisionprofile', 'x\n', '.provisionprofile 쓰기'),
    ],
    pass: [
      S('/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" Ggumi/Info.plist', 'PlistBuddy Print', { opts: PLIST }),
      S('plutil -lint Ggumi/Info.plist', 'plutil -lint', { opts: PLIST }),
      S('plutil -p Ggumi/Ggumi.entitlements', 'plutil -p', { opts: PLIST }),
      S('plutil -convert xml1 -o - Ggumi/Info.plist', 'plutil -o - 는 화면', { opts: PLIST }),
      S('plutil -replace CFBundleVersion -string 42 Other/Info.plist', '다른 plist', { opts: PLIST }),
      S('defaults read ./Ggumi/Info', 'defaults read', { opts: PLIST }),
      S('defaults write com.example.ggumi Debug -bool YES', '경로가 아닌 도메인', { opts: PLIST }),
      S("python3 -c \"print(open('Ggumi/Info.plist').read())\"", 'python 읽기', { opts: PLIST }),
      S("python3 -c \"open('Ggumi/Info.plist','rb')\"", 'rb 는 읽기', { opts: PLIST }),
      S("ruby -e \"puts File.read('Ggumi/Info.plist')\"", 'ruby 읽기', { opts: PLIST }),
      B('git add -f Config/Secrets.xcconfig && git commit -m "chore: 값 바꿈"', '이미 추적 중인 무시 파일 고친 커밋', { opts: NONE, setup: TRACKED }),
      B('git add Sources/App.swift && git commit -m "feat: x"', '보통 새 파일', { opts: NONE, setup: IGNORED }),
      S('git add -f Config/Secrets.xcconfig', 'add 만(커밋은 아직)', { opts: NONE, setup: IGNORED }),
      W('signing/README.md', '인증서는 match 로 받아요\n', '문서'),
      B('git add signing/dist.cer && git commit -m "feat: SSL 고정 인증서"', '무시 목록에 없는 공개 인증서 .cer', { opts: NONE, setup: CERTS }),
      W('Certs/api.example.com.cer', 'x\n', '.cer 쓰기(공개 인증서)'),
      W('signing/req.certSigningRequest', 'x\n', '.certSigningRequest 쓰기'),
    ],
  },

  'swift-unsafe': {
    block: [
      W('Sources/Auth.swift', 'NS' + 'Log("token %@", token)\n', 'NSLog('),
      W('Sources/Net.swift', 'if failed { NS' + 'Log ("fail") }\n', 'NSLog ( 띄어 씀'),
      W('Sources/View.swift', 'let v = 1\nNS' + 'Log("v")\n', '여러 줄 가운데'),
    ],
    pass: [
      W('Sources/Log.swift', 'func NS' + 'Log(_ s: String) {}\n', 'func NSLog( 정의'),
      W('Sources/Doc.swift', '// NS' + 'Log("x") 는 쓰지 않아요\n', '주석'),
      W('Sources/Wrap.swift', 'logger.NS' + 'Log("x")\n', '다른 것의 메서드'),
      W('Tests/AuthTests.swift', 'NS' + 'Log("x")\n', '시험 코드'),
    ],
  },
};
