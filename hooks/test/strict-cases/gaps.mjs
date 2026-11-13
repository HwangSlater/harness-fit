// 정답지 다시 매기기에서 남은 빈틈(2026-11-13): fastlane run <동작>·xcrun 앞붙이(16 회차), cargo 긴 시험(11), vercel env pull(13), spark-submit 운영(10).
// 묻는 명령 목록은 catalog/combos.json 의 스택 기본값 그대로 쓴다(목록을 바꾸면 이 사례도 따라간다).
import fs from 'node:fs';
import { S } from './helpers.mjs';

const combos = JSON.parse(fs.readFileSync(new URL('../../../catalog/combos.json', import.meta.url), 'utf8'));
const stack = (name) => ({ ...combos.stackAddons.find((a) => a.when.includes(name) && a.hookOpts?.['ask-cmd']).hookOpts['ask-cmd'] });
const IOS = stack('iOS');
const VERCEL = stack('Vercel');
// suggest.mjs 가 #[ignore] 저장소에 넣는 꼴, 이은 줄에서 찾은 운영 명령
const IGNORED = { commands: ['cargo test -- --ignored', 'cargo test -- --include-ignored'] };
const SPARK = { commands: ['spark-submit --env prod'] };
// 도구 없이 xcrun 만 적은 묻는 명령(독립 검토 2026-11-13: xcrun 을 벗긴 뒤로 맞지 않던 회귀)
const XCRUN = { commands: ['xcrun'] };
const XCRUN_SDK = { commands: ['xcrun --sdk iphoneos'] };

export default {
  'ask-cmd': {
    block: [
      S('fastlane run upload_to_testflight', 'run 꼴의 TestFlight 올리기(pilot upload 와 같은 동작)', { opts: IOS }),
      S('bundle exec fastlane run upload_to_app_store skip_screenshots:true', 'bundle exec + run 꼴 App Store 올리기(deliver)', { opts: IOS }),
      S('fastlane ios run get_certificates', '플랫폼 낱말 + run 꼴 인증서 만들기(cert)', { opts: IOS }),
      S('fastlane run match_nuke type:development', 'run 꼴 인증서 지우기', { opts: IOS }),
      S('xcrun agvtool new-marketing-version 2.1', 'xcrun 앞붙이 버전 올리기', { opts: IOS }),
      S('xcrun --sdk iphoneos agvtool new-version -all', 'xcrun --sdk 값 뒤의 도구', { opts: IOS }),
      S('xcrun notarytool submit app.zip --wait', 'xcrun 을 벗겨도 적은 xcrun 명령은 그대로 맞는다', { opts: IOS }),
      S('cargo test -p kv-raft --test sim_linearizable -- --ignored', '#[ignore] 긴 시험 돌리기', { opts: IGNORED }),
      S('cargo test --workspace -- --include-ignored', '긴 시험까지 함께', { opts: IGNORED }),
      S('vercel env pull .env.local', '비밀값을 로컬 파일로 받기', { opts: VERCEL }),
      S('vercel env pull --environment=production', '운영 비밀값 받기', { opts: VERCEL }),
      // 역할극 13 회차 4차(2026-11-13): --prod 말고 --target production 꼴·redeploy 가 묻지 않고 지나갔다
      S('vercel deploy --target production', '--target production 운영 배포', { opts: VERCEL }),
      S('vercel deploy --target=production', '--target=production 꼴', { opts: VERCEL }),
      S('vercel --target production', 'deploy 없이', { opts: VERCEL }),
      S('vercel redeploy https://app-abc.vercel.app', '배포 다시 올리기', { opts: VERCEL }),
      S('spark-submit --master yarn jobs/a.py --env prod', '운영 spark-submit', { opts: SPARK }),
      S('xcrun notarytool submit a', '「xcrun」 만 적은 묻는 명령', { opts: XCRUN }),
      S('sudo xcrun simctl erase all', '앞붙이 뒤 xcrun 도', { opts: XCRUN }),
      S('xcrun --sdk iphoneos agvtool new-version -all', '「xcrun --sdk iphoneos」 만 적은 묻는 명령', { opts: XCRUN_SDK }),
      S('fastlane --verbose run upload_to_testflight', 'run 앞 전역 옵션', { opts: IOS }),
      S('fastlane --env beta ios run upload_to_app_store', '값 받는 전역 옵션 + 플랫폼 낱말', { opts: IOS }),
    ],
    pass: [
      S('fastlane run get_version_number', '버전 읽기 동작', { opts: IOS }),
      S('fastlane run increment_build_number_in_plist', '목록에 없는 동작', { opts: IOS }),
      S('fastlane run match type:development readonly:true', '읽기 전용 match', { opts: IOS }),
      S('xcrun simctl list', '시뮬레이터 목록', { opts: IOS }),
      S('xcrun agvtool what-marketing-version', '버전 보기', { opts: IOS }),
      S('xcrun -f agvtool', '도구 경로 찾기만', { opts: IOS }),
      S('xcrun --show-sdk-path', 'SDK 경로 보기', { opts: IOS }),
      S('xcrun notarytool history', '공증 기록 보기', { opts: IOS }),
      S('cargo test --workspace', '평소 시험', { opts: IGNORED }),
      S('cargo test -- --nocapture', '다른 시험 옵션', { opts: IGNORED }),
      S('cargo test -p kv-raft --test sim_linearizable', '긴 시험 없이 한 파일', { opts: IGNORED }),
      S('vercel env ls', '환경 변수 이름 보기', { opts: VERCEL }),
      S('vercel', '프리뷰 배포', { opts: VERCEL }),
      S('vercel deploy --target preview', '프리뷰 대상 배포', { opts: VERCEL }),
      S('vercel deploy --target=preview', '프리뷰 대상 = 꼴', { opts: VERCEL }),
      S('spark-submit --master local[2] jobs/a.py --env local', '로컬 spark-submit', { opts: SPARK }),
      S('grep xcrun notes.txt', '인자 속 xcrun', { opts: XCRUN }),
      S('xcrun --sdk macosx agvtool new-version', '다른 SDK', { opts: XCRUN_SDK }),
      S('fastlane --verbose run get_version_number', '전역 옵션 + 읽기 동작', { opts: IOS }),
      S('fastlane --env', '값 없는 전역 옵션(잘린 입력)', { opts: IOS }),
      S('fastlane run', '동작 없는 run', { opts: IOS }),
    ],
  },
};
