# Sofa

Controller-first game library for Windows handhelds and the couch. Tauri 2 (Rust) + React.

- Finds installed games from **Steam**, **Epic** and **GOG** and launches them through their launchers.
- Gamepad navigation (D-pad/stick, **A** play, **LB/RB** switch source, **Y** install update). Keyboard: arrows, Enter, Q/E, U.
- Languages: English, Português (Brasil), Español. Follows the OS language and can be changed in the header.
- OTA updates through GitHub Releases, signed with the Tauri updater key.
- Registers as an **Xbox full screen experience home app** (Windows 11 24H2+): Settings → Gaming → Full Screen Experience → pick Sofa.

## What the installer changes on your machine

Being listed as a home app needs a package identity, which Windows only grants through a signed MSIX.
Sofa uses the same approach as Winhanced, so the installer (run as administrator) does this:

1. Turns on **developer mode** (`AppModelUnlock`), because the `gamingHome` capability is authorized with a developer-mode SCCD.
2. Installs the self-signed **`CN=Sofa` certificate** into `LocalMachine\TrustedPeople` so the identity package is trusted.
3. Registers `Sofa.Identity.msix` as a sparse package pointing at the install folder.
4. Sets Sofa as the home app **only if none is chosen yet**; your later choice in Settings is kept across updates.

Uninstalling removes the package, the home-app setting (if it is Sofa) and the certificate. Developer mode is left on.

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
