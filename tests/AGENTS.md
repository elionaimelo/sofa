# Tests

- Runner: `node:test` with `--experimental-strip-types` (`npm test`). No Jest, no DOM, no Tauri.
- Only pure modules are testable here: `src/library.ts` and `src/services.ts`. Keep logic that deserves a test out of components so it can live there.
- Import sources with the `.ts` extension (`../src/services.ts`); type-only imports are stripped, so they're fine.
- Use `node:assert/strict`. Name each test as a sentence describing the behaviour (`"unknown network errors never surface URLs or credentials"`).
- When fixing a bug in pure logic, add the assertion that would have caught it to the closest existing test.
- Rust tests live next to the code in `src-tauri/src/*` (`cargo test`).
