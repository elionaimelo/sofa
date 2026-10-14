//! Pair a Bluetooth controller from inside Sofa, through Windows' own device enumeration
//! (WinRT). Windows keeps the pairing; Sofa only drives the ceremony.
use serde::Serialize;
use std::sync::Mutex;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Found {
    /// Windows device id; opaque to the UI, which only hands it back to `bluetooth_pair`.
    id: String,
    name: String,
}

/// The last scan; a pairing request must name one of these ids.
#[derive(Default)]
pub struct Scan(Mutex<Vec<Found>>);

#[cfg(windows)]
fn init_winrt() {
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    // Per blocking thread; initialising again just reports so.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

/// Unpaired classic and Low Energy devices in range; controllers must be in pairing mode.
#[cfg(windows)]
fn scan() -> Result<Vec<Found>, String> {
    use windows::Devices::Bluetooth::{BluetoothDevice, BluetoothLEDevice};
    use windows::Devices::Enumeration::DeviceInformation;
    init_winrt();
    let selectors = [
        BluetoothDevice::GetDeviceSelectorFromPairingState(false),
        BluetoothLEDevice::GetDeviceSelectorFromPairingState(false),
    ];
    let mut found = Vec::new();
    for selector in selectors {
        let selector = selector.map_err(|_| "settingUnavailable")?;
        let devices = DeviceInformation::FindAllAsyncAqsFilter(&selector)
            .and_then(|operation| operation.join())
            .map_err(|_| "settingUnavailable")?;
        for index in 0..devices.Size().map_err(|_| "settingUnavailable")? {
            let Ok(device) = devices.GetAt(index) else { continue };
            let name = device.Name().map(|n| n.to_string()).unwrap_or_default();
            let id = device.Id().map(|i| i.to_string()).unwrap_or_default();
            if !name.trim().is_empty() && !id.is_empty() {
                found.push(Found { id, name: name.trim().to_owned() });
            }
        }
    }
    Ok(dedup(found))
}

#[cfg(any(windows, test))]
fn dedup(mut found: Vec<Found>) -> Vec<Found> {
    found.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    found.dedup_by(|a, b| a.id == b.id);
    found
}

#[cfg(windows)]
fn pair(id: &str) -> Result<(), String> {
    use windows::Devices::Enumeration::{
        DeviceInformation, DevicePairingKinds, DevicePairingRequestedEventArgs, DevicePairingResultStatus,
    };
    use windows::Foundation::TypedEventHandler;
    use windows::core::HSTRING;
    init_winrt();
    let failed = |_| "bluetoothPairFailed".to_string();
    let device = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id))
        .and_then(|operation| operation.join())
        .map_err(failed)?;
    let custom = device.Pairing().and_then(|p| p.Custom()).map_err(failed)?;
    // Controllers pair without a code ("just works") or ask only for confirmation.
    let token = custom
        .PairingRequested(&TypedEventHandler::new(|_, args: windows::core::Ref<DevicePairingRequestedEventArgs>| {
            if let Some(args) = args.as_ref() {
                args.Accept()?;
            }
            Ok(())
        }))
        .map_err(failed)?;
    let kinds = DevicePairingKinds(DevicePairingKinds::ConfirmOnly.0 | DevicePairingKinds::None.0);
    let result = custom.PairAsync(kinds).and_then(|operation| operation.join());
    let _ = custom.RemovePairingRequested(token);
    let status = result.and_then(|r| r.Status()).map_err(failed)?;
    if status == DevicePairingResultStatus::Paired || status == DevicePairingResultStatus::AlreadyPaired {
        Ok(())
    } else {
        Err(format!("bluetoothPairFailed:{}", status.0))
    }
}

#[cfg(not(windows))]
fn scan() -> Result<Vec<Found>, String> {
    Err("settingUnavailable".into())
}

#[cfg(not(windows))]
fn pair(_id: &str) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[tauri::command]
pub async fn bluetooth_scan(app: tauri::AppHandle, state: tauri::State<'_, Scan>) -> Result<Vec<Found>, String> {
    let found = tauri::async_runtime::spawn_blocking(scan)
        .await
        .map_err(|_| "settingUnavailable".to_string())??;
    crate::log::info(&app, format!("bluetooth: {} unpaired devices in range", found.len()));
    *state.0.lock().map_err(|_| "serviceUnavailable")? = found.clone();
    Ok(found)
}

#[tauri::command]
pub async fn bluetooth_pair(id: String, app: tauri::AppHandle, state: tauri::State<'_, Scan>) -> Result<(), String> {
    let device = state
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .iter()
        .find(|d| d.id == id)
        .cloned()
        .ok_or("invalidInput")?;
    crate::log::info(&app, format!("bluetooth: pairing {:?}", device.name));
    let result = tauri::async_runtime::spawn_blocking(move || pair(&device.id))
        .await
        .map_err(|_| "settingUnavailable".to_string())?;
    if let Err(error) = &result {
        crate::log::info(&app, format!("bluetooth: pairing failed: {error}"));
        return Err("bluetoothPairFailed".into());
    }
    Ok(())
}

/// Windows' own Bluetooth page, for anything the ceremony above can't do.
#[tauri::command]
pub async fn open_bluetooth_settings() -> Result<(), String> {
    tauri_plugin_opener::open_url("ms-settings:bluetooth", None::<&str>).map_err(|_| "openFailed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_results_are_sorted_by_name_without_duplicate_ids() {
        let found = dedup(vec![
            Found { id: "b".into(), name: "Xbox Wireless Controller".into() },
            Found { id: "a".into(), name: "DualSense".into() },
            Found { id: "b".into(), name: "Xbox Wireless Controller".into() },
        ]);
        assert_eq!(found.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    }
}
