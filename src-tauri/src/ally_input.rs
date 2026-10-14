//! ROG Ally 2023 OEM buttons (Command Center, Armoury Crate) use ASUS HID reports, not XInput.
//! Protocol references: Linux hid-asus/hid-ids and G-Helper KeyboardListener.

/// Usages as the Linux hid-asus driver names them: 0x38 is the ROG (Armoury Crate) key,
/// 0xa6 the Command Center (QAM) key, 0xa7 the ROG key held, 0xa5 a back paddle.
#[derive(Clone, Copy, PartialEq, Debug)]
enum OemAction {
    /// Command Center or Armoury Crate tapped.
    GameBar,
    /// Armoury Crate held.
    TaskSwitcher,
}

#[derive(Default)]
struct OemButtons {
    held: u8,
}

impl OemButtons {
    fn update(&mut self, report: &[u8]) -> Option<OemAction> {
        // Other report IDs must not reset the state of an OEM key.
        if report.len() < 2 || report[0] != 0x5a {
            return None;
        }
        let key = report[1];
        let rising = key != self.held;
        self.held = key;
        match key {
            0x38 | 0xa6 if rising => Some(OemAction::GameBar),
            0xa7 if rising => Some(OemAction::TaskSwitcher),
            _ => None,
        }
    }
}

#[cfg(windows)]
pub fn watch(app: tauri::AppHandle) {
    use std::{thread, time::Duration};
    thread::spawn(move || {
        let mut announced = false;
        loop {
            // Re-enumerate after disconnect/suspend. Only touch the 2023 Ally's vendor
            // collections, never its keyboard/mouse or another ASUS device. The OEM keys
            // arrive on the keyboard-like collection; the gamepad configuration one accepts
            // the same report id but never sends keys, so every collection gets a reader.
            let devices: Vec<_> = hidapi::HidApi::new()
                .map(|api| {
                    api.device_list()
                        .filter(|info| {
                            info.vendor_id() == 0x0b05
                                && info.product_id() == 0x1abe
                                && info.usage_page() >= 0xff00
                        })
                        .filter_map(|info| {
                            Some((info.open_device(&api).ok()?, info.usage_page(), info.usage()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            if devices.is_empty() {
                if !announced {
                    crate::log::info(&app, "ally: Command Center HID unavailable; retrying");
                    announced = true;
                }
                thread::sleep(Duration::from_secs(5));
                continue;
            }
            announced = false;
            let readers: Vec<_> = devices
                .into_iter()
                .map(|(device, page, usage)| {
                    let app = app.clone();
                    thread::spawn(move || read_keys(&app, &device, page, usage))
                })
                .collect();
            for reader in readers {
                let _ = reader.join();
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

/// Reads one vendor collection until it fails (disconnect, suspend) or proves not to be the
/// keyboard-like one.
#[cfg(windows)]
fn read_keys(app: &tauri::AppHandle, device: &hidapi::HidDevice, page: u16, usage: u16) {
    // Enable ASUS input reports; this does not remap controls or profiles.
    let mut init = [0u8; 64];
    let handshake = b"\x5aASUS Tech.Inc.";
    init[..handshake.len()].copy_from_slice(handshake);
    if device.send_feature_report(&init).is_err() {
        crate::log::info(app, format!("ally: HID {page:#06x}/{usage:#04x} rejected initialization"));
        return;
    }
    crate::log::info(app, format!("ally: HID {page:#06x}/{usage:#04x} connected"));
    let mut buttons = OemButtons::default();
    let mut report = [0u8; 256];
    loop {
        match device.read_timeout(&mut report, 1000) {
            Ok(0) => {}
            Ok(size) => {
                let report = &report[..size];
                // Key codes only (never held state), so the log shows which button is which.
                if report.len() > 1 && report[0] == 0x5a && report[1] != 0 {
                    crate::log::info(app, format!("ally: HID {page:#06x}/{usage:#04x} key {:#04x}", report[1]));
                }
                if let Some(action) = buttons.update(report).filter(|_| first_press()) {
                    let result = match action {
                        OemAction::GameBar => crate::widget::open_game_bar(app),
                        OemAction::TaskSwitcher => crate::widget::open_task_switcher(app),
                    };
                    if let Err(error) = result {
                        crate::log::info(app, format!("ally: {action:?} failed: {error}"));
                    }
                }
            }
            Err(_) => {
                crate::log::info(app, format!("ally: HID {page:#06x}/{usage:#04x} disconnected; retrying"));
                return;
            }
        }
    }
}

/// Several collections can deliver the same key; a second Win+G would close Game Bar again.
#[cfg(windows)]
fn first_press() -> bool {
    use std::{sync::Mutex, time::Instant};
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    let first = last.is_none_or(|at| now.duration_since(at).as_millis() > 300);
    if first {
        *last = Some(now);
    }
    first
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_center_opens_once_per_press_and_rearms_on_release() {
        let mut buttons = OemButtons::default();
        assert_eq!(buttons.update(&[0x5a, 0xa6]), Some(OemAction::GameBar));
        assert_eq!(buttons.update(&[0x5a, 0xa6]), None);
        assert_eq!(buttons.update(&[0x5d, 0]), None);
        assert_eq!(buttons.update(&[0x5a, 0xa6]), None);
        assert_eq!(buttons.update(&[0x5a, 0]), None);
        assert_eq!(buttons.update(&[0x5a, 0xa6]), Some(OemAction::GameBar));
    }

    #[test]
    fn armoury_crate_held_opens_the_task_switcher_once() {
        let mut buttons = OemButtons::default();
        assert_eq!(buttons.update(&[0x5a, 0xa5]), None);
        assert_eq!(buttons.update(&[0x5a, 0xa7]), Some(OemAction::TaskSwitcher));
        assert_eq!(buttons.update(&[0x5a, 0xa7]), None);
        assert_eq!(buttons.update(&[0x5a, 0]), None);
    }

    #[test]
    fn armoury_crate_tap_opens_game_bar_too() {
        let mut buttons = OemButtons::default();
        assert_eq!(buttons.update(&[0x5a, 0x38]), Some(OemAction::GameBar));
        assert_eq!(buttons.update(&[0x5a, 0x38]), None);
    }

    #[test]
    fn ignores_short_reports_and_paddles() {
        let mut buttons = OemButtons::default();
        for report in [&[][..], &[0x5a], &[0x5d, 0xa6], &[0x5a, 0xa5]] {
            assert_eq!(buttons.update(report), None);
        }
    }
}
