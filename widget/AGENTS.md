# Xbox Game Bar widget (C# UWP)

A thin UWP shell registered as a Game Bar widget (`microsoft.gameBarUIExtension`). It only hosts a WebView2 pointed at Sofa's local HUD server (`http://127.0.0.1:47811/?hud=1&widget=1`, see `src-tauri/src/hud_server.rs`); all HUD logic stays in the React frontend and the Rust commands.

- Builds only on Windows with MSBuild and the UWP workload; CI does it in `.github/workflows/release.yml` and drops the signed `.msix` plus `Dependencies/` into `src-tauri/packaging/widget/`, which the installer sideloads (`src-tauri/packaging/home-app.ps1`).
- Run `python3 widget/validate-package.py <artifact-directory>` to check that the bundled frameworks meet every package's manifest requirements. CI runs this before uploading, including on cache hits. Keep `Default.rd.xml` as `Content` so .NET Native reads the runtime directives.
- `Package.appxmanifest`: `Publisher` must stay `CN=Sofa` (the signing cert subject); the `proxyStub` block is required verbatim by the Game Bar SDK; `Version` is stamped in CI as `1.0.<commits touching widget/>.0`, so it only changes when the widget does. CI caches the signed package by the content of `widget/` and skips the build when nothing changed.
- Keep it dumb: no HUD features here. New HUD commands go in `hud_server::dispatch` and `src/features/Performance.tsx`.
- Loopback: UWP apps can't reach 127.0.0.1 without `CheckNetIsolation LoopbackExempt`; the installer grants it for this package family. If the widget shows "Sofa is not running" while Sofa is open, check that exemption first.
- Create the widget only on `IsLaunchActivation`; keep the `XboxGameBarWidget` reference alive for the window's lifetime.
