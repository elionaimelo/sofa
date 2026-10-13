use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct AllyStatus {
    supported: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AllyProfile {
    Silent,
    Balanced,
    Turbo,
}

#[cfg(any(windows, test))]
impl AllyProfile {
    fn firmware_value(self) -> u8 {
        match self {
            Self::Silent => 2,
            Self::Balanced => 0,
            Self::Turbo => 1,
        }
    }
}

#[cfg(windows)]
pub(crate) fn powershell(script: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = [0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("powerControlUnavailable".into());
    }
    let executable = std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length]))
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let mut child = std::process::Command::new(executable)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "powerControlUnavailable".to_string())?;
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|_| "powerControlUnavailable")?
            .is_some()
        {
            break;
        }
        if started.elapsed() >= Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("powerControlUnavailable".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "powerControlUnavailable".to_string())?;
    if !output.status.success() {
        return Err("powerControlUnavailable".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "powerControlUnavailable".into())
}

#[cfg(windows)]
fn supported() -> bool {
    powershell(
        "$ErrorActionPreference='Stop'; $model=(Get-CimInstance Win32_ComputerSystem).Model; \
         if($model -notmatch 'RC71L'){exit 1}; \
         $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
         if($null -eq $device){exit 1}; 'ok'",
    )
    .is_ok()
}

#[cfg(not(windows))]
fn supported() -> bool {
    false
}

#[tauri::command]
pub async fn ally_status() -> AllyStatus {
    let supported = tauri::async_runtime::spawn_blocking(supported)
        .await
        .unwrap_or(false);
    AllyStatus { supported }
}

#[tauri::command]
pub async fn set_ally_profile(profile: AllyProfile) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_profile(profile))
        .await
        .map_err(|_| "powerControlUnavailable".to_string())?
}

#[cfg(windows)]
fn set_profile(profile: AllyProfile) -> Result<(), String> {
    // RC71L uses ASUS System Control Interface's fixed firmware modes.
    // This requests a profile; the firmware and power source decide the actual watts.
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         $model=(Get-CimInstance Win32_ComputerSystem).Model; \
         if($model -notmatch 'RC71L'){{exit 1}}; \
         $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
         if($null -eq $device){{exit 1}}; \
         $result=Invoke-CimMethod -InputObject $device -MethodName DEVS -Arguments @{{Device_ID=[uint32]0x00120075; Control_status=[uint32]{}}}; \
         if($result.result -ne 1){{exit 1}}; 'ok'",
        profile.firmware_value()
    );
    if powershell(&script)?.trim() == "ok" {
        Ok(())
    } else {
        Err("powerControlUnavailable".into())
    }
}

#[cfg(not(windows))]
fn set_profile(_profile: AllyProfile) -> Result<(), String> {
    Err("powerControlUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firmware_modes_are_fixed() {
        assert_eq!(AllyProfile::Silent.firmware_value(), 2);
        assert_eq!(AllyProfile::Balanced.firmware_value(), 0);
        assert_eq!(AllyProfile::Turbo.firmware_value(), 1);
    }
}
