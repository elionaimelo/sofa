# Docs

Product and operations docs for the Sofa team, written in Português (Brasil).

- One topic per file, kebab-case name (`windows-validation.md`, `winhanced-business-rules.md`).
- Business rules state behaviour, not implementation: what the user sees, when it happens, and the limits. Each rule carries its source (URL or file path) and its status in Sofa today (`já tem` / `parcial` / `não tem`).
- Competitor research (Winhanced) documents behaviour and technical approach in our own words. Never paste decompiled code, proprietary strings, keys or assets.
- When a doc describes something the app does, check it against the code (`src/`, `src-tauri/src/`) and update it in the same change that alters that behaviour. Keep `README.md`'s feature list consistent with it.
- Commands, paths, registry keys and setting names stay in their original form inside backticks.
