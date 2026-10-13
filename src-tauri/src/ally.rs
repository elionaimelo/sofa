use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct AllyStatus {
    supported: bool,
    /// Custom watts are offered only where the limits were validated.
    tdp_supported: bool,
    /// Sustained power limit (SPL) in watts, when the firmware reports it.
    tdp: Option<u8>,
}

/// ASUS WMI device ids, as documented by the Linux `asus-wmi` driver.
#[cfg(windows)]
const PPT_PL1_SPL: u32 = 0x001200A3;
#[cfg(windows)]
const PPT_PL2_SPPT: u32 = 0x001200A0;
#[cfg(windows)]
const PPT_PL3_FPPT: u32 = 0x001200C1;
/// The ROG Ally's firmware accepts this envelope; anything outside is rejected here.
pub const TDP_RANGE: std::ops::RangeInclusive<u8> = 5..=30;

#[derive(Clone, Copy, Serialize, Deserialize)]
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

    let executable = crate::system_exe(r"WindowsPowerShell\v1.0\powershell.exe")
        .ok_or("powerControlUnavailable")?;
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
fn probe() -> Probe {
    // Capability, not model: the firmware reports whether the thermal-policy device exists
    // (presence bit 0x10000 in DSTS), like the Linux asus-wmi driver checks it.
    let Ok(out) = powershell(
        "$ErrorActionPreference='Stop'; \
         \"model=$((Get-CimInstance Win32_ComputerSystem).Model)\"; \
         $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
         if($null -eq $device){exit 0}; \
         \"status=$((Invoke-CimMethod -InputObject $device -MethodName DSTS -Arguments @{Device_ID=[uint32]0x00120075}).device_status)\"",
    ) else {
        return Probe::default();
    };
    parse_probe(&out)
}

#[derive(Default, Debug, PartialEq)]
struct Probe {
    model: String,
    /// The firmware exposes the thermal policy (Silent/Balanced/Turbo).
    profiles: bool,
}

#[cfg(any(windows, test))]
fn parse_probe(out: &str) -> Probe {
    let field = |key: &str| out.lines().find_map(|l| l.trim().strip_prefix(key)).unwrap_or("");
    let status: u32 = field("status=").parse().unwrap_or(0);
    Probe {
        model: field("model=").to_owned(),
        profiles: status & 0x10000 != 0,
    }
}

/// Watts are only validated on the 2023 ROG Ally; other models' limits differ.
fn tdp_validated(model: &str) -> bool {
    model.contains("RC71L")
}


#[cfg(not(windows))]
fn probe() -> Probe {
    Probe::default()
}

#[tauri::command]
pub async fn ally_status(app: tauri::AppHandle) -> AllyStatus {
    let probe = tauri::async_runtime::spawn_blocking(probe).await.unwrap_or_default();
    crate::log::info(&app, format!("ally: model {:?}, profiles {}", probe.model, probe.profiles));
    let tdp = if probe.profiles && tdp_validated(&probe.model) {
        tauri::async_runtime::spawn_blocking(read_tdp).await.ok().flatten()
    } else {
        None
    };
    AllyStatus {
        supported: probe.profiles,
        tdp_supported: probe.profiles && tdp_validated(&probe.model),
        tdp,
    }
}

/// Custom TDP: sets sustained, slow and fast limits to the same watts (the firmware
/// keeps its own ratios for the fixed profiles; a flat limit is what "Custom" means).
#[tauri::command]
pub async fn set_tdp(watts: u8) -> Result<(), String> {
    if !TDP_RANGE.contains(&watts) {
        return Err("invalidInput".into());
    }
    tauri::async_runtime::spawn_blocking(move || write_tdp(watts))
        .await
        .map_err(|_| "powerControlUnavailable".to_string())?
}

#[cfg(windows)]
fn read_tdp() -> Option<u8> {
    // DSTS answers presence bit 0x10000 plus the value in the low bits.
    let out = powershell(&format!(
        "$ErrorActionPreference='Stop'; \
         $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
         (Invoke-CimMethod -InputObject $device -MethodName DSTS -Arguments @{{Device_ID=[uint32]{PPT_PL1_SPL}}}).device_status"
    ))
    .ok()?;
    let raw: u32 = out.trim().parse().ok()?;
    (raw & 0x10000 != 0).then(|| (raw & 0xFF) as u8).filter(|w| TDP_RANGE.contains(w))
}

#[cfg(windows)]
fn write_tdp(watts: u8) -> Result<(), String> {
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         $model=(Get-CimInstance Win32_ComputerSystem).Model; \
         if($model -notmatch 'RC71L'){{exit 1}}; \
         $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
         if($null -eq $device){{exit 1}}; \
         foreach($id in @([uint32]{PPT_PL1_SPL},[uint32]{PPT_PL2_SPPT},[uint32]{PPT_PL3_FPPT})){{ \
           $result=Invoke-CimMethod -InputObject $device -MethodName DEVS -Arguments @{{Device_ID=$id; Control_status=[uint32]{watts}}}; \
           if($result.result -ne 1){{exit 1}} }}; 'ok'"
    );
    if powershell(&script)?.trim() == "ok" {
        Ok(())
    } else {
        Err("powerControlUnavailable".into())
    }
}

#[cfg(not(windows))]
fn read_tdp() -> Option<u8> {
    None
}

#[cfg(not(windows))]
fn write_tdp(_watts: u8) -> Result<(), String> {
    Err("powerControlUnavailable".into())
}

#[tauri::command]
pub async fn set_ally_profile(profile: AllyProfile) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_profile(profile))
        .await
        .map_err(|_| "powerControlUnavailable".to_string())?
}

#[cfg(windows)]
fn set_profile(profile: AllyProfile) -> Result<(), String> {
    // Fixed firmware modes of the ASUS thermal-policy device (any model that exposes it).
    // This requests a profile; the firmware and power source decide the actual watts.
    let script = format!(
        "$ErrorActionPreference='Stop'; \
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
    fn detects_profiles_by_firmware_presence_bit() {
        let probe = parse_probe("model=RC73YA\r\nstatus=65537\r\n");
        assert_eq!(probe, Probe { model: "RC73YA".into(), profiles: true });
        assert!(!parse_probe("model=RC71L\nstatus=0").profiles);
        assert!(!parse_probe("model=Desktop").profiles);
        assert!(tdp_validated("RC71L") && !tdp_validated("RC73YA"));
    }

    #[test]
    fn firmware_modes_are_fixed() {
        assert_eq!(AllyProfile::Silent.firmware_value(), 2);
        assert_eq!(AllyProfile::Balanced.firmware_value(), 0);
        assert_eq!(AllyProfile::Turbo.firmware_value(), 1);
    }
}
