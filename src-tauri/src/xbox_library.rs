//! Installed Microsoft Store games with a GDK game manifest. The package identity stays in
//! Rust; the webview receives only an opaque family ID and never a launch path.
use crate::library::Game;

#[cfg(windows)]
use std::{path::PathBuf, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

#[cfg(windows)]
#[derive(Clone, serde::Deserialize)]
struct Package {
    family: String,
    aumid: String,
    title: String,
    folder: PathBuf,
}

#[cfg(windows)]
type PackageCache = Mutex<Option<(Instant, Vec<Package>)>>;

#[cfg(windows)]
fn packages() -> Vec<Package> {
    static CACHE: OnceLock<PackageCache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock()
        && let Some((at, packages)) = guard.as_ref()
        && at.elapsed() < Duration::from_secs(60) {
            return packages.clone();
        }
    // Get-AppxPackage enumerates the current user's registered main packages. A GDK game
    // carries MicrosoftGame.config; ordinary Store applications and DLC do not.
    const SCRIPT: &str = include_str!("../packaging/xbox-games.ps1");
    let found = crate::ally::powershell_with_timeout(SCRIPT, Duration::from_secs(30))
        .ok()
        .and_then(|output| serde_json::from_str::<Vec<Package>>(&output).ok())
        .unwrap_or_default();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((Instant::now(), found.clone()));
    }
    found
}

#[cfg(windows)]
fn package(id: &str) -> Option<Package> {
    let family = id.strip_prefix("xbox:")?;
    packages().into_iter().find(|p| p.family == family)
}

pub fn games() -> Vec<Game> {
    #[cfg(windows)]
    { packages().into_iter().filter(|p| !p.family.is_empty() && !p.aumid.is_empty()).map(|p| Game {
        id: format!("xbox:{}", p.family),
        title: p.title,
        source: "xbox",
        launch: String::new(),
        installed: true,
        ..Game::default()
    }).collect() }
    #[cfg(not(windows))]
    { Vec::new() }
}

pub fn install_folder(id: &str) -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    { package(id).map(|p| p.folder) }
    #[cfg(not(windows))]
    { let _ = id; None }
}

pub fn launch(id: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let package = package(id).ok_or("openFailed")?;
        let target: Vec<u16> = format!(r"shell:AppsFolder\{}", package.aumid).encode_utf16().chain([0]).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain([0]).collect();
        // ShellExecuteW reads the two NUL-terminated buffers for the duration of this call.
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if (result as isize) <= 32 { Err("openFailed".into()) } else { Ok(()) }
    }
    #[cfg(not(windows))]
    { let _ = id; Err("desktopRequired".into()) }
}
