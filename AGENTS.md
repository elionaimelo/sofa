# Sofa — agent guide

Controller-first game launcher for Windows handhelds (ROG Ally) that also registers as the Xbox full screen experience home app. Tauri 2 (Rust) backend, React 19 + TypeScript frontend.

Each directory has its own `AGENTS.md` with the rules for that layer:

- `src/AGENTS.md` — React/TypeScript UI
- `src-tauri/AGENTS.md` — Rust and Tauri backend
- `tests/AGENTS.md` — frontend unit tests
- `docs/AGENTS.md` — product docs and business rules
- `widget/AGENTS.md` — Xbox Game Bar widget (C# UWP shell for the HUD)

## Commands

```sh
npm install
npm run tauri dev          # app with hot reload
npx tsc --noEmit           # typecheck
npm run lint               # Biome: lint, format and import order (npm run format fixes)
npm test                   # tests/*.test.ts (Node 22.6+)
npx vite build             # frontend build
cargo test --manifest-path src-tauri/Cargo.toml
```

Run all of them before you call a change done. The release CI (`.github/workflows/release.yml`) runs `npm test` and `cargo test` on `windows-latest`, so Windows-only code (`#[cfg(windows)]`) must compile there even if you develop on macOS. `cargo check --target x86_64-pc-windows-msvc` fails locally on `ring`'s C build; check Windows-only modules in a scratch crate that includes them with `#[path]` and skips `reqwest`.

Agent skills (TanStack Query, React composition, web interface guidelines) are pinned in `skills-lock.json`; restore them with `npx skills experimental_install`.

## Ground rules

- Smallest change that works. Reuse what exists (`services.ts`, `library.rs`, `network.rs`) before writing new helpers; no new dependency when an installed one or a few lines do the job.
- Delete dead code, styles and strings in the same change that makes them dead.
- Code, comments, commit messages and `AGENTS.md` files: English. Product docs in `docs/`: Português (Brasil). User-facing text: `src/i18n.ts` in English, Português (Brasil) and Español.
- Commits: Conventional Commits (`feat:`, `fix:`, `ci:`, `docs:`), imperative, one topic each.
- Security boundary: the webview sends ids, never paths, URLs or commands; Rust re-resolves them. Remote pages (e.g. the Steam login window) never get a capability.

## Releases (OTA)

1. Bump the version in `package.json`, `package-lock.json` (top two entries), `src-tauri/Cargo.toml`, the `sofa` entry in `src-tauri/Cargo.lock` and the user agent in `src-tauri/src/network.rs`.
2. Commit, push to `main`, push tag `vX.Y.Z`.
3. CI builds the signed NSIS installer and `latest.json` into a draft release. Publish the draft; installed apps pick it up from `releases/latest/download/latest.json`.

The updater only offers a higher version than the installed one; never re-release the same number.
