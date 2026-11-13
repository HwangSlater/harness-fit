## iOS apps
- When using a new permission (camera, location …), add its `NS…UsageDescription` text to Info.plist, and ask before removing or changing existing ones. Never add ATS exceptions (`NSAllowsArbitraryLoads`). {{judge}}
- In Core Data, never edit a shipped model version; add a new model version and make it current. {{judge}}
- Never change signing settings (`DEVELOPMENT_TEAM`, `CODE_SIGN_*`, provisioning profiles, entitlements, fastlane Matchfile) without asking. {{judge}}
- Use `guard let` and `as?` instead of force unwrapping (`!`) and `as!`, and keep tokens in the Keychain, not UserDefaults. {{judge}}
- Run tests on a simulator with `xcodebuild test` (or `fastlane scan`). {{judge}}
