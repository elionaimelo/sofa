# Sofa

Controller-first game library for Windows handhelds and the couch. Tauri 2 (Rust) + React.

- Finds installed games from **Steam**, **Epic** and **GOG** and launches them through their launchers. Connecting a Steam or Epic Games account in Settings adds owned, uninstalled games to the same library; those covers are dimmed and offer installation through the store's launcher. GOG ownership sync is not available yet, so it shows installed games only.
- Home with contextual game artwork, recently played games, and responsive icon navigation on handhelds. Library filters combine source, search, favorites, play history, cover availability, sorting and multiple categories.
- Categories are available for detected titles: Steam catalog genres/tags are cached for offline use, and custom categories can organize titles from any provider. Category acquisition depends on public Steam store markup; unavailable/age-gated listings are left unknown.
- Uninstall installed titles from their details with confirmation: Steam through its uninstall protocol and Epic by validating its local build manifest and removing only listed files. Epic requires the game/launcher to be closed; unlisted saves/mods stay on disk. Invalid/encrypted manifests, permissions or unavailable uninstallers produce errors rather than fabricated success. Library refresh verifies completion.
- Game details with launch, favorites, hide and restore. Preferences and successful launches are saved locally.
- Gamepad navigation: D-pad/stick move, **A** details/activate, **B** back, **X** favorite, **LB/RB** switch source (change a focused setting in dialogs), **Y** install update (hide/restore in game details), **Start** settings, **View** main navigation, hold **View + Start** to toggle the HUD (works while a game has focus). Keyboard: arrows, Enter, Escape, X, Q/E, U, F2, F4 (power), Home, M (main navigation).
- Settings for language, cover size, sorting, fullscreen, library refresh and update checks. Updates are checked at start and every 6 hours; a dot on the settings button marks a pending one.
- Steam and Epic ownership sync sign in on the store's own login page (Steam Guard, QR and Epic two-factor work); Sofa never sees the password, only the session cookies. Sessions are kept in the app's webview cookie store, renewed in a hidden store page when they expire, and deleted on disconnect. Epic titles come from the launcher's public catalog with the Epic Games Launcher's own client id.
- Store: live deals and price comparison through CheapShark, with a local wishlist. Prices are USD; purchases open the provider redirect in the browser.
- Top bar: device battery and up to two controller battery indicators; additional controllers are grouped with a link to full details. Battery details: charge, design/full capacity, health and cycle count when supplied by the OS; approximate controller battery levels via Windows XInput.
- Windows power menu: shutdown, restart and supported hibernation, each requiring confirmation. Commands do not force-close apps.
- Publisher affiliate links: prepared for approved tracking links per game. Configuration is fixed in the distributed build; see [affiliate setup](docs/affiliate-setup.md). Your affiliate revenue remains inactive until your program is approved and configured.
- Xbox Game Bar widget ("Sofa" in the Game Bar home menu, Xbox button or Win+G): the same HUD inside the Game Bar overlay. It is a small UWP package installed with Sofa that loads the HUD from a local server (`127.0.0.1:47811`) Sofa runs while open, so it needs Sofa running.
- Floating HUD (View + Start, the battery icon or Settings → Performance): the Steam game running now with session and total play time, Silent/Balanced/Turbo firmware profiles and a custom 5–30 W power limit on the original ROG Ally (RC71L) with its ASUS system driver, resolution and refresh rate (until the next restart), brightness, CPU Boost, Windows Auto HDR and battery details. Tiles appear only when the piece that does the work is installed: framerate limit through RivaTuner Statistics Server (its global profile, via `RTSSHooks64.dll`), fan curve presets through the ASUS ACPI driver, stick lighting and desktop mouse mode through the Ally's HID interface, and "prefer external controller", which disables the built-in pad with `pnputil` (UAC). "Save for this game" stores the current profile, TDP, display mode and brightness; Sofa applies them before launching that game. It works over windowed and borderless games; it is not an Xbox Game Bar widget. The firmware decides the actual wattage of a profile.
- Languages: English, Português (Brasil), Español. Follows the OS language and can be changed in the header.
- OTA updates through GitHub Releases, signed with the Tauri updater key. Settings → Updates shows the installed version and opens `sofa.log` (app data dir) for diagnostics; it records Steam sign-in steps and launch-time settings, never tokens or cookie values.
- Registers as an **Xbox full screen experience home app** (Windows 11 24H2+): Settings → Gaming → Xbox mode (formerly Full screen experience) → pick Sofa. The installer also turns on **Enter Xbox mode on startup** (`StartupToGamingHome`) unless you already set it; Settings → Appearance toggles it and can switch to Xbox mode right away through the documented `SetGamingFullScreenExperience` API. On builds older than 26100.8328 / 26200.8328 the desktop can still win the startup race.

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
npm test # Node 22.6+ (TypeScript stripping)
cargo test --manifest-path src-tauri/Cargo.toml
```

## Add a language

Add an entry to `dicts` in `src/i18n.ts` plus its name in `LANGS`. TypeScript fails the build if a key is missing.

## Release (OTA)

1. Bump `version` in `package.json` and `src-tauri/Cargo.toml` (the Tauri config reads the npm version).
2. `git commit -am "release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. The `release` workflow builds the Windows installer and uploads it with `latest.json` to a draft release. Verify the successful workflow and assets, then publish the draft. Installed apps show an update banner on their next start.

The private signing key lives outside the repo (`~/.tauri/sofa.key`) and in the `TAURI_SIGNING_PRIVATE_KEY*` repo secrets. If you lose it, already-installed apps can no longer receive updates.

## Browser preview

`npm run dev` opens the interface without desktop APIs. Add `?demo=1` to the URL for a development-only demo library with its own preferences; demo games cannot launch. Production builds never include an active demo library.

## Remaining scope

Store pricing is currently USD only; region-aware pricing and the release calendar remain open. Native in-app messaging and Xbox/PSN/Discord friends remain open. The quick panel reads CPU/RAM and works over windowed/borderless games; FPS/GPU telemetry, Game Bar integration, custom TDP and fan controls are not implemented. ROG Ally firmware profile switching, Xbox FSE registration and OTA installation require a Windows end-to-end check.

## Design direction

The interface uses the [Taste Skill redesign workflow](https://github.com/Leonxlnx/taste-skill/tree/main/skills/redesign-skill): audit the existing app, improve it within its stack, and verify the result. Outfit is bundled locally, Phosphor icons share one family, touch targets are at least 44px, and reduced-motion/transparency preferences are respected.

## Optional integration checks

```sh
cargo test --manifest-path src-tauri/Cargo.toml cheapshark_live_contract -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml native_metrics_warmup_and_cache -- --ignored
```

These checks use the live provider and local OS, respectively; the ordinary test suite remains offline.
