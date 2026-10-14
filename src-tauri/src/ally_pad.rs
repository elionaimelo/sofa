//! ROG Ally built-in gamepad: lighting and mouse mode through its ASUS HID interface, and
//! disabling it (PnP) so only an external controller is seen by games.
use serde::Serialize;
use std::sync::Mutex;

/// What Sofa last asked the firmware for; it reports neither back.
#[derive(Default)]
pub struct PadState(Mutex<Requested>);

#[derive(Default, Clone, Copy, Serialize)]
pub struct Requested {
    pub lighting: Option<bool>,
    pub mouse_mode: Option<bool>,
}

#[derive(Serialize, Default)]
pub struct BuiltinPad {
    /// PnP instance id of the Ally's XInput device, when present.
    instance: Option<String>,
    enabled: Option<bool>,
}

impl PadState {
    pub fn requested(&self) -> Requested {
        self.0.lock().map(|r| *r).unwrap_or_default()
    }
}

/// Feature reports go to every vendor collection of the Ally; the one that owns the report
/// id accepts it and the others reject it harmlessly.
#[cfg(windows)]
fn send_feature(report: &[u8]) -> Result<(), String> {
    let api = hidapi::HidApi::new().map_err(|_| "settingUnavailable")?;
    let mut accepted = false;
    for info in api.device_list().filter(|i| {
        i.vendor_id() == 0x0b05 && i.product_id() == 0x1abe && i.usage_page() >= 0xff00
    }) {
        let Ok(device) = info.open_device(&api) else { continue };
        let mut buffer = [0u8; 64];
        buffer[..report.len()].copy_from_slice(report);
        accepted |= device.send_feature_report(&buffer).is_ok();
    }
    accepted.then_some(()).ok_or_else(|| "settingUnavailable".into())
}

#[cfg(not(windows))]
fn send_feature(_report: &[u8]) -> Result<(), String> {
    Err("settingUnavailable".into())
}

/// Keyboard-backlight command of the ASUS HID protocol; on the Ally it drives the stick rings.
#[tauri::command]
pub async fn set_controller_lighting(on: bool, state: tauri::State<'_, PadState>) -> Result<(), String> {
    let level = if on { 3 } else { 0 };
    tauri::async_runtime::spawn_blocking(move || send_feature(&[0x5a, 0xba, 0xc5, 0xc4, level]))
        .await
        .map_err(|_| "settingUnavailable".to_string())??;
    if let Ok(mut r) = state.0.lock() {
        r.lighting = Some(on);
    }
    Ok(())
}

/// Gamepad (1) or mouse (3) mode of the built-in pad, as the Linux Ally driver sets it.
#[tauri::command]
pub async fn set_controller_mode(mouse: bool, state: tauri::State<'_, PadState>) -> Result<(), String> {
    let mode = if mouse { 3 } else { 1 };
    tauri::async_runtime::spawn_blocking(move || send_feature(&[0x5a, 0xd1, 0x01, 0x01, mode]))
        .await
        .map_err(|_| "settingUnavailable".to_string())??;
    if let Ok(mut r) = state.0.lock() {
        r.mouse_mode = Some(mouse);
    }
    Ok(())
}

#[cfg(windows)]
fn builtin_pad() -> BuiltinPad {
    let Ok(out) = crate::ally::powershell(
        "$d=Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USB\\VID_0B05&PID_1ABE*' -and ($_.Class -eq 'XboxComposite' -or $_.Service -eq 'xusb22') } | Select-Object -First 1; \
         if($d){\"instance=$($d.InstanceId)\"; \"problem=$($d.Problem)\"}",
    ) else {
        return BuiltinPad::default();
    };
    parse_builtin_pad(&out)
}

#[cfg(not(windows))]
fn builtin_pad() -> BuiltinPad {
    BuiltinPad::default()
}

#[cfg(any(windows, test))]
fn parse_builtin_pad(out: &str) -> BuiltinPad {
    let field = |key: &str| out.lines().find_map(|l| l.trim().strip_prefix(key)).map(str::trim);
    let instance = field("instance=").filter(|id| valid_instance(id)).map(str::to_owned);
    let enabled = instance.as_ref().map(|_| field("problem=") != Some("CM_PROB_DISABLED"));
    BuiltinPad { instance, enabled }
}

/// A PnP instance id as Windows prints it; it is passed to pnputil, never to a shell.
#[cfg(any(windows, test))]
fn valid_instance(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"\\&_.{}-#".contains(&b))
}

#[tauri::command]
pub async fn builtin_controller(app: tauri::AppHandle) -> BuiltinPad {
    let pad = tauri::async_runtime::spawn_blocking(builtin_pad).await.unwrap_or_default();
    crate::log::info(&app, format!("pad: built-in {:?} enabled {:?}", pad.instance, pad.enabled));
    pad
}

/// Disabling the built-in pad needs administrator rights: pnputil runs through UAC.
#[tauri::command]
pub async fn set_builtin_controller(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
    let pad = tauri::async_runtime::spawn_blocking(builtin_pad).await.map_err(|_| "settingUnavailable")?;
    let instance = pad.instance.ok_or("settingUnavailable")?;
    crate::log::info(&app, format!("pad: {} built-in pad", if enabled { "enabling" } else { "disabling" }));
    tauri::async_runtime::spawn_blocking(move || toggle_device(&instance, enabled))
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}

#[cfg(windows)]
fn toggle_device(instance: &str, enabled: bool) -> Result<(), String> {
    let pnputil = crate::system_exe("pnputil.exe").ok_or("settingUnavailable")?;
    let verb = if enabled { "/enable-device" } else { "/disable-device" };
    // Single-quoted PowerShell literals; the instance id was validated to contain no quotes.
    let script = format!(
        "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath '{}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('{verb}','\"{instance}\"'); exit $p.ExitCode",
        pnputil.display()
    );
    crate::ally::powershell_with_timeout(&script, std::time::Duration::from_secs(120))
        .map(|_| ())
        .map_err(|_| "settingUnavailable".into())
}

#[cfg(not(windows))]
fn toggle_device(_instance: &str, _enabled: bool) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_built_in_pad_and_its_disabled_state() {
        let pad = parse_builtin_pad("instance=USB\\VID_0B05&PID_1ABE&MI_02\\7&1A2B3C&0&0002\r\nproblem=\r\n");
        assert_eq!(pad.instance.as_deref(), Some("USB\\VID_0B05&PID_1ABE&MI_02\\7&1A2B3C&0&0002"));
        assert_eq!(pad.enabled, Some(true));
        let pad = parse_builtin_pad("instance=USB\\VID_0B05&PID_1ABE&MI_02\\7&1A2B3C&0&0002\nproblem=CM_PROB_DISABLED");
        assert_eq!(pad.enabled, Some(false));
        assert_eq!(parse_builtin_pad("").instance, None);
        assert_eq!(parse_builtin_pad("instance=bad'id\nproblem=").instance, None);
    }
}
