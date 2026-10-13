//! Xbox mode (full screen experience) home app and "Enter Xbox mode on startup".
//! Windows keeps both in HKCU\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration:
//! `GamingHomeApp` (AUMID) and `StartupToGamingHome` (DWORD, 1 = boot into Xbox mode).
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct XboxMode {
    /// Sofa is the selected home app.
    home: bool,
    /// Windows enters Xbox mode at sign-in.
    startup: bool,
    /// Xbox mode is on now; None when this Windows build lacks the API.
    active: Option<bool>,
}

/// Reads the `home=` and `startup=` lines printed by the status script.
#[cfg(any(windows, test))]
fn parse(output: &str) -> Option<XboxMode> {
    let flag = |key: &str| {
        output
            .lines()
            .find_map(|line| line.trim().strip_prefix(key))
            .map(|value| value == "1")
    };
    Some(XboxMode {
        home: flag("home=")?,
        startup: flag("startup=")?,
        active: None,
    })
}

/// None when Sofa's identity package isn't registered (dev builds, other OSes).
#[tauri::command]
pub async fn xbox_mode_status() -> Option<XboxMode> {
    tauri::async_runtime::spawn_blocking(status).await.ok().flatten()
}

/// On: makes Sofa the home app and boots into Xbox mode. Off: boots to the desktop, home app unchanged.
#[tauri::command]
pub async fn set_xbox_mode_startup(on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_startup(on))
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}

/// Asks Windows to switch to Xbox mode now, then quits: Windows starts the home app (Sofa) itself.
#[tauri::command]
pub async fn enter_xbox_mode(app: tauri::AppHandle) -> Result<(), String> {
    enter()?;
    app.exit(0);
    Ok(())
}

/// Function from the documented `gamingexperience.h` API set. Loaded at runtime because
/// older builds don't ship it, and a static import would stop Sofa from starting there.
#[cfg(windows)]
fn gaming_api(name: &std::ffi::CStr) -> Option<unsafe extern "system" fn() -> isize> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    let dll: Vec<u16> = "api-ms-win-gaming-experience-l1-1-0.dll\0".encode_utf16().collect();
    // Null-terminated name; the module is never freed, so returned pointers stay valid.
    let module = unsafe { LoadLibraryW(dll.as_ptr()) };
    if module.is_null() {
        return None;
    }
    // Valid module handle and null-terminated procedure name.
    unsafe { GetProcAddress(module, name.as_ptr().cast()) }
}

#[cfg(windows)]
pub(crate) fn active() -> Option<bool> {
    let f = gaming_api(c"IsGamingFullScreenExperienceActive")?;
    // BOOL IsGamingFullScreenExperienceActive(void)
    let f: unsafe extern "system" fn() -> i32 = unsafe { std::mem::transmute(f) };
    Some(unsafe { f() } != 0)
}

#[cfg(windows)]
fn enter() -> Result<(), String> {
    let f = gaming_api(c"SetGamingFullScreenExperience").ok_or("settingUnavailable")?;
    // HRESULT SetGamingFullScreenExperience(BOOL enter)
    let f: unsafe extern "system" fn(i32) -> i32 = unsafe { std::mem::transmute(f) };
    match unsafe { f(1) } {
        0 => Ok(()),
        // HRESULT_FROM_WIN32(ERROR_FAIL_NOACTION_REBOOT): Windows wants a restart first.
        hr if hr == 0x8007_015E_u32 as i32 => Err("restartRequired".into()),
        _ => Err("settingUnavailable".into()),
    }
}

#[cfg(not(windows))]
pub(crate) fn active() -> Option<bool> {
    None
}

#[cfg(not(windows))]
fn enter() -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(windows)]
const SCRIPT_PREFIX: &str = "$ErrorActionPreference='Stop'; \
    $p=Get-AppxPackage -Name Sofa | Select-Object -First 1; if($null -eq $p){exit 1}; \
    $aumid=\"$($p.PackageFamilyName)!App\"; \
    $cfg='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GamingConfiguration'; ";

#[cfg(windows)]
fn status() -> Option<XboxMode> {
    let script = format!(
        "{SCRIPT_PREFIX}$c=Get-ItemProperty $cfg -ErrorAction SilentlyContinue; \
         \"home=$([int]($c.GamingHomeApp -eq $aumid))\"; \"startup=$([int]($c.StartupToGamingHome -eq 1))\""
    );
    let mut mode = parse(&crate::ally::powershell(&script).ok()?)?;
    mode.active = active();
    Some(mode)
}

#[cfg(windows)]
fn set_startup(on: bool) -> Result<(), String> {
    let apply = if on {
        "Set-ItemProperty $cfg -Name GamingHomeApp -Value $aumid; \
         Set-ItemProperty $cfg -Name StartupToGamingHome -Value 1 -Type DWord"
    } else {
        "Set-ItemProperty $cfg -Name StartupToGamingHome -Value 0 -Type DWord"
    };
    // Test-Path, not `New-Item -Force`: forcing an existing key replaces it with an empty one.
    let script = format!("{SCRIPT_PREFIX}if(-not (Test-Path $cfg)){{New-Item $cfg | Out-Null}}; {apply}; 'ok'");
    match crate::ally::powershell(&script) {
        Ok(out) if out.trim() == "ok" => Ok(()),
        _ => Err("settingUnavailable".into()),
    }
}

#[cfg(not(windows))]
fn status() -> Option<XboxMode> {
    None
}

#[cfg(not(windows))]
fn set_startup(_on: bool) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status_script_output() {
        let mode = |home, startup| Some(XboxMode { home, startup, active: None });
        assert_eq!(parse("home=1\r\nstartup=0\r\n"), mode(true, false));
        assert_eq!(parse("home=0\nstartup=1"), mode(false, true));
        assert_eq!(parse("home=1"), None);
        assert_eq!(parse(""), None);
    }
}
