## iOS 앱
- 새 권한(카메라·위치 등)을 쓰면 Info.plist 에 `NS…UsageDescription` 문구를 넣고, 있는 문구를 지우거나 바꿀 때는 묻는다. ATS 예외(`NSAllowsArbitraryLoads`)는 넣지 않는다. {{judge}}
- Core Data 는 배포한 모델 버전을 고치지 말고, 새 모델 버전을 더해 그 버전을 현재 버전으로 정한다. {{judge}}
- 서명 설정(`DEVELOPMENT_TEAM`·`CODE_SIGN_*`·프로비저닝 프로필·entitlements·fastlane Matchfile)은 바꾸기 전에 묻는다. {{judge}}
- 강제 언래핑(`!`)·`as!` 대신 `guard let`·`as?` 를 쓰고, 토큰은 UserDefaults 가 아니라 키체인에 둔다. {{judge}}
- 테스트는 시뮬레이터에서 `xcodebuild test`(또는 `fastlane scan`)로 돌린다. {{judge}}
