## Rust
- Ask before adding new `unsafe`, and give each block a `// SAFETY:` comment stating the conditions it relies on (check with `cargo miri test` if the repo uses miri). {{judge}}
- Before finishing, run `cargo clippy` and `cargo test` with the same options as CI (as listed under "Commands in this repo", if there). {{judge}}
- In library code, return errors with `?` instead of `unwrap()` or `expect()` (tests and examples are fine). {{judge}}
