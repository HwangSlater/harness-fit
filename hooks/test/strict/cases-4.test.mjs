// 엄격 시험 4/4 — 훅마다 사례를 네 몫으로 나눈 것 가운데 하나(본문은 hooks/test/strict-run.mjs).
globalThis.HF_STRICT = { shard: 3, of: 4 };
await import('../strict-run.mjs');
