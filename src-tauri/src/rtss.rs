//! Framerate limit through RivaTuner Statistics Server, when the user has it installed.
//! Sofa only edits RTSS's global profile with its own library; RTSS does the limiting.
use serde::Serialize;

#[derive(Serialize, Default)]
pub struct FramerateStatus {
    installed: bool,
    /// Global limit in frames per second; 0 means no limit.
    limit: Option<u32>,
}

pub const LIMITS: [u32; 8] = [0, 30, 40, 45, 60, 72, 90, 120];

#[cfg(windows)]
fn install_dir() -> Option<std::path::PathBuf> {
    use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
    let dir: String = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\WOW6432Node\Unwinder\RTSS")
        .and_then(|k| k.get_value("InstallDir"))
        .ok()?;
    let dir = std::path::PathBuf::from(dir);
    dir.join("RTSSHooks64.dll").is_file().then_some(dir)
}

/// The exported profile API of RTSSHooks64.dll (the same one Handheld Companion uses).
#[cfg(windows)]
struct Hooks {
    load: ByName,
    save: ByName,
    get: GetProperty,
    set: SetProperty,
    update: Update,
}
#[cfg(windows)]
type Export = unsafe extern "system" fn() -> isize;
#[cfg(windows)]
type ByName = unsafe extern "system" fn(*const u8);
#[cfg(windows)]
type GetProperty = unsafe extern "system" fn(*const u8, *mut u32, u32) -> i32;
#[cfg(windows)]
type SetProperty = unsafe extern "system" fn(*const u8, *const u32, u32) -> i32;
#[cfg(windows)]
type Update = unsafe extern "system" fn();

#[cfg(windows)]
fn hooks(dir: &std::path::Path) -> Option<Hooks> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    let path: Vec<u16> = dir
        .join("RTSSHooks64.dll")
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // The path is NUL-terminated UTF-16; the library stays loaded for the process lifetime.
    let module = unsafe { LoadLibraryW(path.as_ptr()) };
    if module.is_null() {
        return None;
    }
    let symbol = |name: &std::ffi::CStr| {
        // `name` is a NUL-terminated ASCII export name; the module handle is valid.
        unsafe { GetProcAddress(module, name.as_ptr().cast()) }
    };
    // Exports resolved by name; the target signatures are the documented stdcall ones.
    unsafe {
        Some(Hooks {
            load: std::mem::transmute::<Export, ByName>(symbol(c"LoadProfile")?),
            save: std::mem::transmute::<Export, ByName>(symbol(c"SaveProfile")?),
            get: std::mem::transmute::<Export, GetProperty>(symbol(c"GetProfileProperty")?),
            set: std::mem::transmute::<Export, SetProperty>(symbol(c"SetProfileProperty")?),
            update: std::mem::transmute::<Export, Update>(symbol(c"UpdateProfiles")?),
        })
    }
}

#[cfg(windows)]
fn status() -> FramerateStatus {
    let Some(dir) = install_dir() else { return FramerateStatus::default() };
    let Some(hooks) = hooks(&dir) else { return FramerateStatus { installed: true, limit: None } };
    let mut limit = 0u32;
    // Global profile; the property is a 32-bit integer.
    let ok = unsafe {
        (hooks.load)(c"".as_ptr().cast());
        (hooks.get)(c"FramerateLimit".as_ptr().cast(), &mut limit, 4) != 0
    };
    FramerateStatus { installed: true, limit: ok.then_some(limit) }
}

#[cfg(windows)]
fn set_limit(fps: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let dir = install_dir().ok_or("settingUnavailable")?;
    let hooks = hooks(&dir).ok_or("settingUnavailable")?;
    // Global profile; the property is a 32-bit integer.
    let ok = unsafe {
        (hooks.load)(c"".as_ptr().cast());
        let ok = (hooks.set)(c"FramerateLimit".as_ptr().cast(), &fps, 4) != 0;
        if ok {
            (hooks.save)(c"".as_ptr().cast());
            (hooks.update)();
        }
        ok
    };
    if !ok {
        return Err("settingUnavailable".into());
    }
    // The limit only applies while RTSS runs; start it (to the tray) if it isn't.
    let running = sysinfo::System::new_all().processes_by_exact_name("RTSS.exe".as_ref()).next().is_some();
    if !running && fps > 0 {
        std::process::Command::new(dir.join("RTSS.exe"))
            .current_dir(&dir)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "settingUnavailable")?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn status() -> FramerateStatus {
    FramerateStatus::default()
}

#[cfg(not(windows))]
fn set_limit(_fps: u32) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[tauri::command]
pub async fn framerate_status() -> FramerateStatus {
    tauri::async_runtime::spawn_blocking(status).await.unwrap_or_default()
}

#[tauri::command]
pub async fn set_framerate_limit(fps: u32, app: tauri::AppHandle) -> Result<(), String> {
    if !LIMITS.contains(&fps) {
        return Err("invalidInput".into());
    }
    crate::log::info(&app, format!("rtss: framerate limit {fps}"));
    tauri::async_runtime::spawn_blocking(move || set_limit(fps))
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}
