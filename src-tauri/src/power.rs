use serde::{Deserialize, Serialize};
use starship_battery::{
    Manager, State,
    units::{energy::watt_hour, ratio::percent, time::second},
};
#[derive(Serialize)]
pub struct DeviceBattery {
    pub index: usize,
    pub model: Option<String>,
    pub charge_percent: Option<f32>,
    pub state: &'static str,
    pub full_capacity_wh: Option<f32>,
    pub design_capacity_wh: Option<f32>,
    pub health_percent: Option<f32>,
    pub cycles: Option<u32>,
    pub remaining_seconds: Option<f32>,
    pub charging_seconds: Option<f32>,
}
#[derive(Serialize)]
pub struct ControllerBattery {
    pub index: u32,
    pub kind: &'static str,
    pub level: &'static str,
}
#[derive(Serialize)]
pub struct PowerCapabilities {
    pub shutdown: bool,
    pub restart: bool,
    pub hibernate: bool,
}
#[derive(Serialize)]
pub struct PowerStatus {
    pub batteries: Vec<DeviceBattery>,
    pub battery_error: bool,
    pub controllers: Vec<ControllerBattery>,
    pub controller_battery_supported: bool,
    pub actions: PowerCapabilities,
}
pub fn positive(value: f32) -> Option<f32> {
    (value.is_finite() && value > 0.0).then_some(value)
}
fn percentage(value: f32) -> Option<f32> {
    value.is_finite().then(|| value.clamp(0.0, 100.0))
}
fn batteries() -> (Vec<DeviceBattery>, bool) {
    let Ok(manager) = Manager::new() else {
        return (vec![], true);
    };
    let Ok(items) = manager.batteries() else {
        return (vec![], true);
    };
    let mut found = Vec::new();
    let mut failed = false;
    for item in items {
        match item {
            Ok(battery) => {
                let full = positive(battery.energy_full().get::<watt_hour>());
                let design = positive(battery.energy_full_design().get::<watt_hour>());
                found.push(DeviceBattery {
                    index: found.len() + 1,
                    model: battery.model().map(str::to_owned),
                    charge_percent: percentage(battery.state_of_charge().get::<percent>()),
                    state: match battery.state() {
                        State::Charging => "charging",
                        State::Discharging => "discharging",
                        State::Full => "full",
                        State::Empty => "empty",
                        _ => "unknown",
                    },
                    full_capacity_wh: full,
                    design_capacity_wh: design,
                    health_percent: match (full, design) {
                        (Some(full), Some(design)) => percentage(full / design * 100.0),
                        _ => None,
                    },
                    cycles: battery.cycle_count(),
                    remaining_seconds: battery
                        .time_to_empty()
                        .and_then(|time| positive(time.get::<second>())),
                    charging_seconds: battery
                        .time_to_full()
                        .and_then(|time| positive(time.get::<second>())),
                });
            }
            Err(_) => failed = true,
        }
    }
    (found, failed)
}
#[cfg(windows)]
fn controllers() -> Vec<ControllerBattery> {
    use windows_sys::Win32::UI::Input::XboxController::*;
    let mut found = Vec::new();
    for index in 0..4 {
        let mut info = XINPUT_BATTERY_INFORMATION {
            BatteryType: 0,
            BatteryLevel: 0,
        };
        // The API accepts indices 0..3 and writes exactly this two-byte SDK structure.
        if unsafe { XInputGetBatteryInformation(index, BATTERY_DEVTYPE_GAMEPAD, &mut info) } != 0
            || info.BatteryType == BATTERY_TYPE_DISCONNECTED
        {
            continue;
        }
        let kind = match info.BatteryType {
            BATTERY_TYPE_WIRED => "wired",
            BATTERY_TYPE_ALKALINE => "alkaline",
            BATTERY_TYPE_NIMH => "rechargeable",
            _ => "unknown",
        };
        let level = if kind == "wired" {
            "wired"
        } else if kind == "unknown" {
            "unknown"
        } else {
            match info.BatteryLevel {
                BATTERY_LEVEL_EMPTY => "empty",
                BATTERY_LEVEL_LOW => "low",
                BATTERY_LEVEL_MEDIUM => "medium",
                BATTERY_LEVEL_FULL => "full",
                _ => "unknown",
            }
        };
        found.push(ControllerBattery {
            index: index + 1,
            kind,
            level,
        });
    }
    found
}
#[cfg(not(windows))]
fn controllers() -> Vec<ControllerBattery> {
    vec![]
}
fn capabilities() -> PowerCapabilities {
    #[cfg(windows)]
    {
        PowerCapabilities {
            shutdown: true,
            restart: true,
            hibernate: unsafe { windows_sys::Win32::System::Power::IsPwrHibernateAllowed() },
        }
    }
    #[cfg(not(windows))]
    {
        PowerCapabilities {
            shutdown: false,
            restart: false,
            hibernate: false,
        }
    }
}
fn read_power() -> PowerStatus {
    let (batteries, battery_error) = batteries();
    PowerStatus {
        batteries,
        battery_error,
        controllers: controllers(),
        controller_battery_supported: cfg!(windows),
        actions: capabilities(),
    }
}
#[tauri::command]
pub async fn power_status() -> Result<PowerStatus, String> {
    tauri::async_runtime::spawn_blocking(read_power)
        .await
        .map_err(|_| "batteryUnavailable".into())
}
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum PowerAction {
    Shutdown,
    Restart,
    Hibernate,
}
#[cfg(any(windows, test))]
fn shutdown_args(action: PowerAction) -> &'static [&'static str] {
    match action {
        PowerAction::Shutdown => &["/s", "/t", "0"],
        PowerAction::Restart => &["/r", "/t", "0"],
        PowerAction::Hibernate => &["/h"],
    }
}
#[tauri::command]
pub async fn perform_power(
    action: PowerAction,
    confirmed: bool,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if window.label() != "main" || !confirmed {
        return Err("confirmationRequired".into());
    }
    #[cfg(windows)]
    {
        if matches!(action, PowerAction::Hibernate) && !capabilities().hibernate {
            return Err("hibernateUnavailable".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
            let mut buffer = [0u16; 32768];
            let length =
                unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
            if length == 0 || length >= buffer.len() {
                return Err("powerFailed".to_string());
            }
            let executable = std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length]))
                .join("shutdown.exe");
            let result = std::process::Command::new(executable)
                .args(shutdown_args(action))
                .creation_flags(0x08000000)
                .output()
                .map_err(|_| "powerFailed".to_string())?;
            if result.status.success() {
                Ok(())
            } else {
                Err("powerFailed".into())
            }
        })
        .await
        .map_err(|_| "powerFailed".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err("powerUnavailable".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn power_arguments_never_force_close_apps() {
        for action in [
            PowerAction::Shutdown,
            PowerAction::Restart,
            PowerAction::Hibernate,
        ] {
            assert!(!shutdown_args(action).contains(&"/f"));
        }
        assert_eq!(shutdown_args(PowerAction::Shutdown), ["/s", "/t", "0"]);
        assert_eq!(shutdown_args(PowerAction::Hibernate), ["/h"]);
    }
    #[test]
    fn action_input_cannot_inject_commands() {
        for value in ["\"shutdown /f\"", "\"restart;whoami\"", "\"sleep\""] {
            assert!(serde_json::from_str::<PowerAction>(value).is_err());
        }
    }
    #[test]
    fn missing_capacity_never_creates_fake_health() {
        assert_eq!(positive(0.0), None);
        assert_eq!(positive(f32::NAN), None);
        assert_eq!(percentage(101.0), Some(100.0));
        assert_eq!(percentage(0.0), Some(0.0));
    }
    #[test]
    #[ignore = "native read-only battery integration"]
    fn native_battery_readings() {
        let power = read_power();
        for battery in power.batteries {
            assert!(
                battery
                    .charge_percent
                    .is_none_or(|v| (0.0..=100.0).contains(&v))
            );
            assert!(battery.full_capacity_wh.is_none_or(|v| v > 0.0));
        }
    }
}
