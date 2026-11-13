## Rust
- 새 `unsafe` 는 쓰기 전에 묻고, 블록마다 지키는 조건을 적은 `// SAFETY:` 주석을 단다(miri 를 쓰는 저장소면 `cargo miri test` 로 확인). {{judge}}
- 끝내기 전에 `cargo clippy`·`cargo test` 를 CI 와 같은 옵션으로 돌린다(「이 저장소 명령」에 있으면 그대로). {{judge}}
- 라이브러리 코드에서는 `unwrap()`·`expect()` 대신 `?` 로 오류를 돌려준다(테스트·예제는 괜찮다). {{judge}}
