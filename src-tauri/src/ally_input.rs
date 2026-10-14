//! ROG Ally 2023 OEM buttons use ASUS HID reports, not XInput buttons.
//! Protocol references: Linux hid-asus/hid-ids and G-Helper KeyboardListener.

#[derive(Default)]
struct CommandCenterButton {
    held: bool,
}

impl CommandCenterButton {
    fn update(&mut self, report: &[u8]) -> bool {
        // Other report IDs must not reset the state of an OEM key.
        if report.len() < 2 || report[0] != 0x5a {
            return false;
        }
        let pressed = report[1] == 0xa6;
        let rising = pressed && !self.held;
        self.held = pressed;
        rising
    }
}

#[cfg(windows)]
pub fn watch(app: tauri::AppHandle) {
    use std::{thread, time::Duration};
    thread::spawn(move || {
        let mut announced = false;
        loop {
            // Re-enumerate after disconnect/suspend. Only touch the 2023 Ally's
            // vendor interface, never its keyboard/mouse or another ASUS device.
            let device = hidapi::HidApi::new().ok().and_then(|api| {
                api.device_list()
                    .filter(|info| {
                        info.vendor_id() == 0x0b05
                            && info.product_id() == 0x1abe
                            && info.usage_page() >= 0xff00
                    })
                    .find_map(|info| {
                        let device = info.open_device(&api).ok()?;
                        let mut feature = [0u8; 64];
                        feature[0] = 0x5a;
                        let size = device.get_feature_report(&mut feature).ok()?;
                        (size > 1 && feature[0] == 0x5a).then_some(device)
                    })
            });
            let Some(device) = device else {
                if !announced {
                    crate::log::info(&app, "ally: Command Center HID unavailable; retrying");
                    announced = true;
                }
                thread::sleep(Duration::from_secs(5));
                continue;
            };
            // Enable ASUS input reports; this does not remap controls or profiles.
            let mut init = [0u8; 64];
            let handshake = b"\x5aASUS Tech.Inc.";
            init[..handshake.len()].copy_from_slice(handshake);
            if device.send_feature_report(&init).is_err() {
                crate::log::info(&app, "ally: Command Center HID initialization failed");
                thread::sleep(Duration::from_secs(5));
                continue;
            }
            crate::log::info(&app, "ally: Command Center HID connected");
            announced = false;
            let mut button = CommandCenterButton::default();
            let mut report = [0u8; 64];
            loop {
                match device.read_timeout(&mut report, 1000) {
                    Ok(0) => {}
                    Ok(size) => {
                        if button.update(&report[..size]) {
                            crate::log::info(
                                &app,
                                "ally: Command Center pressed; opening Game Bar",
                            );
                            if let Err(error) = crate::widget::open_game_bar(&app) {
                                crate::log::info(
                                    &app,
                                    format!("ally: Game Bar launch failed: {error}"),
                                );
                            }
                        }
                    }
                    Err(_) => {
                        crate::log::info(&app, "ally: Command Center HID disconnected; retrying");
                        break;
                    }
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_center_opens_once_per_press_and_rearms_on_release() {
        let mut button = CommandCenterButton::default();
        assert!(button.update(&[0x5a, 0xa6]));
        assert!(!button.update(&[0x5a, 0xa6]));
        assert!(!button.update(&[0x5d, 0]));
        assert!(!button.update(&[0x5a, 0xa6]));
        assert!(!button.update(&[0x5a, 0]));
        assert!(button.update(&[0x5a, 0xa6]));
    }

    #[test]
    fn ignores_short_reports_paddles_and_armoury_crate() {
        let mut button = CommandCenterButton::default();
        for report in [
            &[][..],
            &[0x5a],
            &[0x5d, 0xa6],
            &[0x5a, 0xa5],
            &[0x5a, 0x38],
            &[0x5a, 0xa7],
        ] {
            assert!(!button.update(report));
        }
    }
}
