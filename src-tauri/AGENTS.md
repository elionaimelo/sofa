# Backend (Rust + Tauri 2)

`src/lib.rs` registers plugins, managed state and every command. One module per area: `library` (game scan, Steam helpers), `accounts` (Steam login and owned games), `hud` (HUD window, controller chord, current game), `display`, `ally`, `power`, `categories`, `store`, `uninstall`/`epic_uninstall`, `publisher`, `network`.

## Commands

- Return `Result<T, String>` where the error string is an i18n key (`"steamSessionExpired"`). New keys go in `src/i18n.ts` (all three languages) and in the `serviceError` list in `src/services.ts`.
- Make a command `async` when it does IO, creates windows or reads cookies: on Windows those deadlock in synchronous commands. Move blocking work into `tauri::async_runtime::spawn_blocking`.
- Inputs from the webview are untrusted. Accept ids and re-resolve them (`library::scan`, `library::steam_app_id`); validate everything else against what the system reports (display modes must be in the enumerated list).
- Shared state goes through `app.manage(...)` behind a `Mutex`; bump a generation counter so late async results from a cancelled session are dropped (`accounts.rs`).

## Platform code

- Windows-only code sits behind `#[cfg(windows)]` with a non-Windows fallback, so the crate builds and tests on macOS.
- Win32 via `windows-sys` (enable features in `Cargo.toml`). Keep `unsafe` minimal, one call per block with a comment on why it's sound; prefer `Default` over `mem::zeroed`.
- Run system tools through `crate::system_exe` (System32 resolved by Windows, never `PATH`), with `CREATE_NO_WINDOW` and a timeout (`ally::powershell`). Scripts must not interpolate unvalidated input.
- Registry reads use `winreg`; Steam keys live under `HKCU\Software\Valve\Steam`.

## Network

- Use `network::client()` (HTTPS only, no redirects, timeout, versioned user agent) and `network::json` / `network::text`, which map HTTP statuses to error keys.
- Never log or return request URLs: Steam access tokens travel in the query string.

## Windows and capabilities

- Capabilities in `capabilities/*.json` are scoped by window label (`main`, `hud`). A window that loads remote content (`steam-login`) must not match any capability.
- Steam sessions live in the shared webview cookie store; read them with `cookies_for_url` and delete them on disconnect.

## Tests

- `#[cfg(test)] mod tests` at the bottom of each module for pure logic (parsers, validation, mappings). Hardware or OS integration tests are `#[ignore]`.
- `cargo test` must pass with zero warnings.
