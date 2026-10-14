//! Master volume of the default playback device (Windows Core Audio).
use serde::Serialize;

#[derive(Serialize, Default)]
pub struct VolumeStatus {
    /// 0–100 of the default playback device; None when there is none.
    percent: Option<u8>,
    muted: bool,
}

#[cfg(windows)]
fn endpoint() -> windows::core::Result<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender};
    use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
    // COM on this blocking thread; a repeated initialisation just reports so and is fine.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

#[cfg(windows)]
fn read() -> VolumeStatus {
    // Core Audio calls on the endpoint interface obtained above.
    let read = || -> windows::core::Result<VolumeStatus> {
        let volume = endpoint()?;
        unsafe {
            Ok(VolumeStatus {
                percent: Some((volume.GetMasterVolumeLevelScalar()? * 100.0).round() as u8),
                muted: volume.GetMute()?.as_bool(),
            })
        }
    };
    read().unwrap_or_default()
}

#[cfg(windows)]
fn write(percent: u8) -> Result<(), String> {
    let write = || -> windows::core::Result<()> {
        let volume = endpoint()?;
        // Event context null: Sofa doesn't listen for its own changes.
        unsafe {
            if percent > 0 {
                volume.SetMasterVolumeLevelScalar(f32::from(percent) / 100.0, std::ptr::null())?;
            }
            volume.SetMute(percent == 0, std::ptr::null())?;
        }
        Ok(())
    };
    write().map_err(|_| "settingUnavailable".into())
}

#[cfg(not(windows))]
fn read() -> VolumeStatus {
    VolumeStatus::default()
}

#[cfg(not(windows))]
fn write(_percent: u8) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[tauri::command]
pub async fn volume_status() -> VolumeStatus {
    tauri::async_runtime::spawn_blocking(read).await.unwrap_or_default()
}

/// 0 mutes; anything else unmutes and sets the level.
#[tauri::command]
pub async fn set_volume(percent: u8) -> Result<(), String> {
    if percent > 100 {
        return Err("invalidInput".into());
    }
    tauri::async_runtime::spawn_blocking(move || write(percent))
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}
