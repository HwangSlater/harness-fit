// iOS·Fastlane 읽기(scripts/detect.mjs) — 역할극 16 회차: Podfile·Package.swift 없이 SPM 만 쓰는 xcodeproj 앱이
// 빈 저장소(thin)로 보여 빈 저장소 질문을 하던 일(2026-11-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect } from '../detect.mjs';
import { tmpDir, writeFiles, gitInit } from './helpers.mjs';

const made = [];
const mk = (files) => {
  const d = gitInit(tmpDir('harness-ios-'), { branch: 'main' });
  made.push(d);
  return detect(writeFiles(d, files));
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('Xcode 프로젝트 폴더·.xcode-version·Swift 소스로 iOS, fastlane/Fastfile 로 Fastlane', () => {
  const app = mk({ 'Ggumi.xcodeproj/project.pbxproj': '// !$*UTF8*$!\n', 'Ggumi/App.swift': 'import SwiftUI\n', 'fastlane/Fastfile': 'lane :beta do\nend\n' });
  assert.ok(app.stack.includes('iOS') && app.stack.includes('Fastlane'), app.stack.join(','));
  assert.equal(app.thin, false);
  assert.ok(app.kinds.includes('mobile'));
  assert.ok(mk({ 'App.xcworkspace/contents.xcworkspacedata': '<Workspace/>\n' }).stack.includes('iOS'), 'xcworkspace');
  assert.ok(mk({ '.xcode-version': '16.2\n' }).stack.includes('iOS'), '.xcode-version');
  assert.ok(mk({ 'Sources/A.swift': '', 'Sources/B.swift': '', 'Sources/C.swift': '', 'Info.plist': '<plist/>\n' }).stack.includes('iOS'), 'Swift 소스 셋 + Info.plist');
  assert.ok(mk({ 'apps/ios/App.xcodeproj/project.pbxproj': '' }).stack.includes('iOS'), '모노레포 apps/ 아래 네이티브 앱');
});

test('아님: RN·Flutter·Capacitor 의 ios/ 껍데기, Swift 한두 개, 받아 온 Pods, 웹 모노레포 하위 project.yml', () => {
  const rn = mk({ 'package.json': JSON.stringify({ dependencies: { react: '18.0.0', 'react-native': '0.74.0' } }), 'ios/App.xcodeproj/project.pbxproj': '', 'ios/AppDelegate.swift': '', 'ios/A.swift': '', 'ios/B.swift': '' });
  assert.ok(!rn.stack.includes('iOS'), rn.stack.join(','));
  const cap = mk({ 'package.json': JSON.stringify({ dependencies: { react: '18.0.0', '@capacitor/core': '6.0.0' } }), 'ios/App/A.swift': '', 'ios/App/B.swift': '', 'ios/App/C.swift': '' });
  assert.ok(!cap.stack.includes('iOS'), cap.stack.join(','));
  const fl = mk({ 'pubspec.yaml': 'name: x\n', 'ios/Runner/AppDelegate.swift': '', 'ios/Runner/A.swift': '', 'ios/Runner/B.swift': '' });
  assert.ok(!fl.stack.includes('iOS'), fl.stack.join(','));
  const py = mk({ 'requirements.txt': 'requests\n', 'tools/gen.swift': '', 'tools/fmt.swift': '' });
  assert.ok(!py.stack.includes('iOS'), py.stack.join(','));
  const pods = mk({ 'requirements.txt': 'requests\n', 'Pods/X/A.swift': '', 'Pods/X/B.swift': '', 'Pods/X/C.swift': '', 'vendor/Y/D.swift': '' });
  assert.ok(!pods.stack.includes('iOS'), pods.stack.join(','));
  const web = mk({ 'package.json': JSON.stringify({ dependencies: { react: '18.0.0' } }), 'apps/web/project.yml': 'name: x\n' });
  assert.ok(!web.stack.includes('iOS'), web.stack.join(','));
  // Fastfile 이 아닌 fastlane 폴더(문서만)는 Fastlane 이 아니다
  assert.ok(!mk({ 'fastlane/README.md': '# x\n' }).stack.includes('Fastlane'));
});

test('독립 검토 2026-11-13: 다른 주 언어 스택이 있으면 Swift 소스 수만으로는 iOS 가 아니다', () => {
  const react = { 'package.json': JSON.stringify({ dependencies: { react: '18.0.0' } }), 'src/App.tsx': '', 'src/a.ts': '' };
  const helper = { 'tools/mac-helper/main.swift': '', 'tools/mac-helper/A.swift': '', 'tools/mac-helper/B.swift': '', 'tools/mac-helper/C.swift': '' };
  const r = mk({ ...react, ...helper });
  assert.ok(!r.stack.includes('iOS'), `React + tools/mac-helper: ${r.stack}`);
  const go = mk({ 'go.mod': 'module x\n', 'cmd/a.go': '', 'clients/swift/Sources/C/A.swift': '', 'clients/swift/Sources/C/B.swift': '', 'clients/swift/Sources/C/C.swift': '', 'clients/swift/Sources/C/D.swift': '' });
  assert.ok(!go.stack.includes('iOS'), `Go + clients/swift: ${go.stack}`);
  // 스택은 없어도 Swift 가 주 언어가 아니면(파이썬 파일이 더 많음) 아니다
  const py = mk({ 'a.py': '', 'b.py': '', 'c.py': '', 'd.py': '', 'tools/A.swift': '', 'tools/B.swift': '', 'tools/C.swift': '' });
  assert.ok(!py.stack.includes('iOS'), `Python 이 더 많음: ${py.stack}`);
  // 다른 스택이 있어도 Info.plist 가 함께 있으면 앱이다(웹 + 네이티브 앱 모노레포)
  assert.ok(mk({ ...react, ...helper, 'tools/mac-helper/Info.plist': '<plist/>\n' }).stack.includes('iOS'), 'Info.plist 가 있으면');
  // Swift 가 주 언어여도 앱 단서가 없으면 iOS 가 아니라 Swift(검토 2026-11-13 — 아래)
  const main = mk({ 'App/A.swift': '', 'App/B.swift': '', 'App/C.swift': '', 'scripts/gen.py': '' });
  assert.ok(!main.stack.includes('iOS') && main.stack.includes('Swift'), `Swift 가 가장 많음: ${main.stack}`);
});

test('검토 2026-11-13: iOS 는 앱 단서가 있을 때만 — Vapor 서버·SPM 라이브러리·명령줄 도구는 Swift', () => {
  const vapor = mk({
    'Package.swift': '// swift-tools-version:5.9\nlet package = Package(name: "api", platforms: [.macOS(.v13)], dependencies: [.package(path: "../vapor")])\n',
    'Sources/App/configure.swift': '', 'Sources/App/routes.swift': '', 'Sources/Run/main.swift': '', Dockerfile: 'FROM swift:5.9\n',
  });
  assert.ok(!vapor.stack.includes('iOS') && vapor.stack.includes('Swift'), `Vapor: ${vapor.stack}`);
  assert.ok(!vapor.kinds.includes('mobile') && vapor.thin === false, `Vapor: ${vapor.kinds}`);
  const lib = mk({ 'Package.swift': 'let package = Package(name: "Parser", products: [.library(name: "Parser", targets: ["Parser"])])\n', 'Sources/Parser/Parser.swift': '', 'Tests/ParserTests/ParserTests.swift': '' });
  assert.ok(!lib.stack.includes('iOS') && lib.stack.includes('Swift'), `SPM 라이브러리: ${lib.stack}`);
  const cli = mk({ 'Sources/tool/main.swift': '', 'Sources/tool/Args.swift': '', 'Sources/tool/Run.swift': '', 'Makefile': 'build:\n\tswiftc -o tool Sources/tool/*.swift\n' });
  assert.ok(!cli.stack.includes('iOS') && cli.stack.includes('Swift'), `Package.swift 없는 명령줄 도구: ${cli.stack}`);
  // 받아 온 코드 속 Xcode 프로젝트(Pods/Pods.xcodeproj)는 앱 단서가 아니다
  const pods = mk({ 'Package.swift': 'let package = Package(name: "x")\n', 'Pods/Pods.xcodeproj/project.pbxproj': '', 'Sources/X/A.swift': '' });
  assert.ok(!pods.stack.includes('iOS'), `Pods: ${pods.stack}`);
  // 맞는 것: .iOS( 플랫폼을 적은 Package.swift(iOS 라이브러리), 하위 폴더 깊이 있는 Xcode 프로젝트
  assert.ok(mk({ 'Package.swift': 'let package = Package(name: "UIKitX", platforms: [.iOS(.v16), .macOS(.v13)])\n', 'Sources/UIKitX/A.swift': '' }).stack.includes('iOS'), '.iOS( 플랫폼');
  assert.ok(mk({ 'clients/apple/Demo/Demo.xcodeproj/project.pbxproj': '' }).stack.includes('iOS'), '깊은 Xcode 프로젝트');
  assert.ok(mk({ 'apps/mac/App.xcworkspace/contents.xcworkspacedata': '' }).stack.includes('iOS'), '깊은 xcworkspace');
});

test('검토 2026-11-13: Kotlin Multiplatform 의 iosApp/iosApp.xcodeproj 도 iOS, RN 의 ios/ 는 여전히 아님', () => {
  const kmp = mk({
    'settings.gradle.kts': 'include(":shared", ":androidApp")\n', 'build.gradle.kts': 'plugins { kotlin("multiplatform") apply false }\n',
    'shared/build.gradle.kts': 'kotlin { iosArm64() }\n', 'shared/src/commonMain/kotlin/Greeting.kt': '', 'androidApp/src/main/kotlin/MainActivity.kt': '',
    'iosApp/iosApp.xcodeproj/project.pbxproj': '// !$*UTF8*$!\n', 'iosApp/iosApp/iOSApp.swift': '', 'iosApp/iosApp/ContentView.swift': '', 'iosApp/iosApp/Info.plist': '<plist/>\n',
  });
  assert.ok(kmp.stack.includes('iOS') && kmp.stack.includes('Java/Kotlin'), `KMP: ${kmp.stack}`);
  assert.ok(kmp.kinds.includes('mobile'));
  const rn = mk({ 'package.json': JSON.stringify({ dependencies: { react: '18.0.0', 'react-native': '0.74.0' } }), 'ios/App.xcodeproj/project.pbxproj': '', 'ios/App/Info.plist': '<plist/>\n', 'ios/App/AppDelegate.swift': '', 'ios/A.swift': '', 'ios/B.swift': '' });
  assert.ok(!rn.stack.includes('iOS') && !rn.stack.includes('Swift'), `RN: ${rn.stack}`);
  const expo = mk({ 'package.json': JSON.stringify({ dependencies: { expo: '51.0.0' } }), 'ios/App.xcworkspace/contents.xcworkspacedata': '' });
  assert.ok(!expo.stack.includes('iOS'), `Expo: ${expo.stack}`);
  const flutter = mk({ 'pubspec.yaml': 'name: x\n', 'ios/Runner.xcodeproj/project.pbxproj': '', 'ios/Runner/Info.plist': '<plist/>\n', 'ios/Runner/AppDelegate.swift': '', 'ios/Runner/A.swift': '', 'ios/Runner/B.swift': '' });
  assert.ok(!flutter.stack.includes('iOS') && !flutter.stack.includes('Swift'), `Flutter: ${flutter.stack}`);
});

test('OpenTofu(.tofu)도 Terraform 으로 본다', () => {
  assert.ok(mk({ 'infra/envs/prod/main.tofu': 'resource "x" "y" {}\n' }).stack.includes('Terraform'));
});
