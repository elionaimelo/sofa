# Sofa

Controller-first game library for Windows handhelds and the couch. Tauri 2 (Rust) + React.

- Finds installed games from **Steam**, **Epic** and **GOG** and launches them through their launchers.
- Gamepad navigation (D-pad/stick, **A** play, **LB/RB** switch source, **Y** install update). Keyboard: arrows, Enter, Q/E, U.
- Languages: English, Português (Brasil), Español. Follows the OS language and can be changed in the header.
- OTA updates through GitHub Releases, signed with the Tauri updater key.

## Develop

```sh
npm install
npm run tauri dev
cargo test --manifest-path src-tauri/Cargo.toml
```

## Add a language

Add an entry to `dicts` in `src/i18n.ts` plus its name in `LANGS`. TypeScript fails the build if a key is missing.

## Release (OTA)

1. Bump `version` in `package.json` (the Tauri config reads it from there).
2. `git commit -am "release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. The `release` workflow builds the Windows installer and publishes the release plus `latest.json`. Installed apps show an update banner on their next start.

The private signing key lives outside the repo (`~/.tauri/sofa.key`) and in the `TAURI_SIGNING_PRIVATE_KEY*` repo secrets. If you lose it, already-installed apps can no longer receive updates.
