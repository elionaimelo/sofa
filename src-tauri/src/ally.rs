use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct AllyStatus {
    supported: bool,
    /// Custom watts are offered only where the limits were validated.
    tdp_supported: bool,
    /// Sustained power limit (SPL) in watts, when the firmware reports it.
    tdp: Option<u8>,
    /// The ASUS ACPI driver accepts fan curves.
    fans: bool,
    /// Lighting and mouse mode Sofa last requested from the built-in pad.
    pad: crate::ally_pad::Requested,
}

/// Fan curve presets: eight temperature points and the duty at each, for both fans.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum FanPreset {
    /// Whatever the firmware uses for the current profile.
    Default,
    Quiet,
    Cool,
}

#[cfg(any(windows, test))]
const FAN_TEMPS: [u8; 8] = [30, 40, 50, 60, 70, 80, 90, 100];

#[cfg(any(windows, test))]
impl FanPreset {
    /// Duty per temperature point; the top point always runs the fan flat out.
    fn duties(self) -> Option<[u8; 8]> {
        match self {
            Self::Default => None,
            Self::Quiet => Some([0, 0, 10, 20, 35, 50, 70, 100]),
            Self::Cool => Some([25, 35, 45, 55, 65, 75, 90, 100]),
        }
    }

    /// The 16-byte DEVS payload: temperatures, then duties (as the Linux asus-wmi driver sends).
    fn curve(self) -> Option<[u8; 16]> {
        let duties = self.duties()?;
        let mut curve = [0u8; 16];
        curve[..8].copy_from_slice(&FAN_TEMPS);
        curve[8..].copy_from_slice(&duties);
        Some(curve)
    }
}

/// ASUS WMI device ids of the fan curves, as the Linux asus-wmi driver names them.
#[cfg(windows)]
const CPU_FAN_CURVE: u32 = 0x00110024;
#[cfg(windows)]
const GPU_FAN_CURVE: u32 = 0x00110025;
#[cfg(windows)]
const THERMAL_POLICY: u32 = 0x00120075;

/// Calls the DEVS method of the ASUS ACPI driver with a multi-byte argument, which the WMI
/// class can't carry (its DEVS takes one 32-bit value). Same ioctl G-Helper uses.
#[cfg(windows)]
fn atk_devs(device: u32, params: &[u8]) -> Result<u32, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
    use windows_sys::Win32::System::IO::DeviceIoControl;
    const DEVS: u32 = 0x53564544;
    const CONTROL_CODE: u32 = 0x0022240C;
    let path: Vec<u16> = "\\\\.\\ATKACPI".encode_utf16().chain(std::iter::once(0)).collect();
    // NUL-terminated path to the driver's control device; no overlapped IO.
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err("settingUnavailable".into());
    }
    let mut input = Vec::with_capacity(12 + params.len());
    input.extend_from_slice(&DEVS.to_le_bytes());
    input.extend_from_slice(&((4 + params.len()) as u32).to_le_bytes());
    input.extend_from_slice(&device.to_le_bytes());
    input.extend_from_slice(params);
    let mut output = [0u8; 20];
    let mut returned = 0u32;
    // Both buffers outlive the call and their lengths are passed with them.
    let ok = unsafe {
        DeviceIoControl(
            handle,
            CONTROL_CODE,
            input.as_ptr().cast(),
            input.len() as u32,
            output.as_mut_ptr().cast(),
            output.len() as u32,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    // The handle came from a successful CreateFileW above.
    unsafe { CloseHandle(handle) };
    if ok == 0 {
        return Err("settingUnavailable".into());
    }
    Ok(u32::from_le_bytes([output[0], output[1], output[2], output[3]]))
}

#[cfg(windows)]
fn fans_supported() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
    let path: Vec<u16> = "\\\\.\\ATKACPI".encode_utf16().chain(std::iter::once(0)).collect();
    // Only probes that the driver's control device opens.
    let handle = unsafe {
        CreateFileW(path.as_ptr(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, std::ptr::null_mut())
    };
    if handle == INVALID_HANDLE_VALUE {
        return false;
    }
    // Opened just above.
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(not(windows))]
fn fans_supported() -> bool {
    false
}

#[cfg(windows)]
fn write_fan_curve(preset: FanPreset) -> Result<(), String> {
    match preset.curve() {
        Some(curve) => {
            for device in [CPU_FAN_CURVE, GPU_FAN_CURVE] {
                if atk_devs(device, &curve)? != 1 {
                    return Err("settingUnavailable".into());
                }
            }
            Ok(())
        }
        // Re-applying the thermal policy restores the firmware's own curves.
        None => {
            let out = powershell(&format!(
                "$ErrorActionPreference='Stop'; \
                 $device=Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB | Select-Object -First 1; \
                 (Invoke-CimMethod -InputObject $device -MethodName DSTS -Arguments @{{Device_ID=[uint32]{THERMAL_POLICY}}}).device_status"
            ))?;
            let raw: u32 = out.trim().parse().map_err(|_| "settingUnavailable")?;
            let profile = match raw & 0xFF {
                1 => AllyProfile::Turbo,
                2 => AllyProfile::Silent,
                _ => AllyProfile::Balanced,
            };
            set_profile(profile).map_err(|_| "settingUnavailable".into())
        }
    }
}

#[cfg(not(windows))]
fn write_fan_curve(_preset: FanPreset) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[tauri::command]
pub async fn set_fan_curve(preset: FanPreset, app: tauri::AppHandle) -> Result<(), String> {
    crate::log::info(&app, format!("ally: fan preset {preset:?}"));
    tauri::async_runtime::spawn_blocking(move || write_fan_curve(preset))
        .await
        .map_err(|_| "settingUnavailable".to_string())?
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
    powershell_with_timeout(script, std::time::Duration::from_secs(8))
}

#[cfg(windows)]
pub(crate) fn powershell_with_timeout(script: &str, timeout: std::time::Duration) -> Result<String, String> {
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
        if started.elapsed() >= timeout {
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
pub async fn ally_status(app: tauri::AppHandle, pad: tauri::State<'_, crate::ally_pad::PadState>) -> Result<AllyStatus, String> {
    let requested = pad.requested();
    let probe = tauri::async_runtime::spawn_blocking(probe).await.unwrap_or_default();
    crate::log::info(&app, format!("ally: model {:?}, profiles {}", probe.model, probe.profiles));
    let tdp = if probe.profiles && tdp_validated(&probe.model) {
        tauri::async_runtime::spawn_blocking(read_tdp).await.ok().flatten()
    } else {
        None
    };
    Ok(AllyStatus {
        supported: probe.profiles,
        tdp_supported: probe.profiles && tdp_validated(&probe.model),
        tdp,
        fans: probe.profiles && fans_supported(),
        pad: requested,
    })
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
    (raw & 0x10000 != 0).then_some((raw & 0xFF) as u8).filter(|w| TDP_RANGE.contains(w))
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
    fn fan_presets_end_flat_out_and_default_has_no_curve() {
        let quiet = FanPreset::Quiet.curve().unwrap();
        assert_eq!(&quiet[..8], &FAN_TEMPS);
        assert_eq!(quiet[15], 100);
        assert!(FanPreset::Quiet.duties().unwrap().iter().zip(FanPreset::Cool.duties().unwrap()).all(|(q, c)| *q <= c));
        assert_eq!(FanPreset::Default.curve(), None);
    }

    #[test]
    fn firmware_modes_are_fixed() {
        assert_eq!(AllyProfile::Silent.firmware_value(), 2);
        assert_eq!(AllyProfile::Balanced.firmware_value(), 0);
        assert_eq!(AllyProfile::Turbo.firmware_value(), 1);
    }
}
