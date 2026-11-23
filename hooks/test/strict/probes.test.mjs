// 엄격 시험 — catalog/probes.json 의 때마다·자기 자리 입력을 실제 진입점으로(본문은 hooks/test/strict-run.mjs).
globalThis.HF_STRICT = { shard: -1, of: 4, probes: true };
await import('../strict-run.mjs');
