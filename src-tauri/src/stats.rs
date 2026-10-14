//! Live numbers for the HUD: the game's framerate and frame time from RivaTuner Statistics
//! Server's shared memory (when RTSS runs), and the GPU's 3D load from Windows' performance
//! counters. Both are read only while the HUD asks, never in the background.
use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct GameStats {
    fps: Option<u32>,
    /// Milliseconds, one decimal.
    frame_time: Option<f32>,
    /// Percent of the GPU's 3D engine in use.
    gpu: Option<u8>,
}

#[cfg_attr(not(any(windows, test)), expect(dead_code, reason = "RTSS and PDH exist only on Windows"))]
fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

/// Apps RTSS hooks that aren't the game: Sofa's own webview and Xbox's overlays.
#[cfg_attr(not(any(windows, test)), expect(dead_code, reason = "RTSS and PDH exist only on Windows"))]
const NOT_GAMES: [&str; 4] = ["msedgewebview2", "sofa", "gamebar", "xboxpcapp"];

/// FPS and frame time of the app RTSS measured last, skipping `NOT_GAMES`. The SDK's v2
/// layout: a header ('RTSS', version, entry size, array offset, entry count), then entries of
/// pid, name[260], flags, time0, time1 (ms), frames between them, frame time (µs).
#[cfg_attr(not(any(windows, test)), expect(dead_code, reason = "RTSS and PDH exist only on Windows"))]
fn parse_rtss(memory: &[u8]) -> Option<(u32, f32)> {
    if u32_at(memory, 0)? != u32::from_be_bytes(*b"RTSS") || u32_at(memory, 4)? < 0x0002_0000 {
        return None;
    }
    let (size, offset, count) =
        (u32_at(memory, 8)? as usize, u32_at(memory, 12)? as usize, u32_at(memory, 16)? as usize);
    if size < 284 {
        return None;
    }
    (0..count.min(256))
        .filter_map(|i| {
            let at = offset.checked_add(i.checked_mul(size)?)?;
            if u32_at(memory, at)? == 0 {
                return None;
            }
            let name = memory.get(at + 4..at + 264)?;
            let name = String::from_utf8_lossy(&name[..name.iter().position(|&b| b == 0).unwrap_or(name.len())])
                .to_lowercase();
            if NOT_GAMES.iter().any(|n| name.contains(n)) {
                return None;
            }
            let (start, end) = (u32_at(memory, at + 268)?, u32_at(memory, at + 272)?);
            let (frames, frame_time) = (u32_at(memory, at + 276)?, u32_at(memory, at + 280)?);
            let span = end.checked_sub(start).filter(|s| *s > 0 && start > 0)?;
            let fps = (1000 * u64::from(frames) / u64::from(span)) as u32;
            (frames > 0).then_some((end, fps, (frame_time as f32 / 100.0).round() / 10.0))
        })
        .max_by_key(|(end, _, _)| *end)
        .map(|(_, fps, frame_time)| (fps, frame_time))
}

/// A copy of RTSS's shared memory, or None when RTSS isn't running.
#[cfg(windows)]
fn rtss_memory() -> Option<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Memory::{FILE_MAP_READ, MEMORY_BASIC_INFORMATION, MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery},
    };
    let name: Vec<u16> = "RTSSSharedMemoryV2".encode_utf16().chain([0]).collect();
    // A NUL-terminated name; a null handle means RTSS isn't running.
    let mapping = unsafe { OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr()) };
    if mapping.is_null() {
        return None;
    }
    // A read-only view of the whole mapping, unmapped below.
    let view = unsafe { MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0) };
    let copy = (!view.Value.is_null()).then(|| {
        let mut info = MEMORY_BASIC_INFORMATION::default();
        // The size of the region the view starts; `info` is a valid out buffer.
        let found = unsafe { VirtualQuery(view.Value, &mut info, size_of::<MEMORY_BASIC_INFORMATION>()) } != 0;
        let size = if found { info.RegionSize.min(16 << 20) } else { 0 };
        // `size` bytes from the view's start lie inside the mapped, readable region.
        unsafe { std::slice::from_raw_parts(view.Value as *const u8, size) }.to_vec()
    });
    if !view.Value.is_null() {
        // The view mapped above, no longer read.
        unsafe { UnmapViewOfFile(view) };
    }
    // The mapping handle opened above.
    unsafe { CloseHandle(mapping) };
    copy
}

/// Load of the GPU's 3D engine summed over processes, as Task Manager's per-process GPU column.
#[cfg(windows)]
fn gpu_load() -> Option<u8> {
    use windows_sys::Win32::System::Performance::{
        PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_MORE_DATA, PdhAddEnglishCounterW, PdhCloseQuery,
        PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
    };
    let path: Vec<u16> = r"\GPU Engine(*engtype_3D)\Utilization Percentage".encode_utf16().chain([0]).collect();
    let mut query = std::ptr::null_mut();
    // Local machine (null source); `query` receives the handle, closed below.
    if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
        return None;
    }
    let total = (|| {
        let mut counter = std::ptr::null_mut();
        // `path` is NUL-terminated; the wildcard covers every process's 3D engine.
        if unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) } != 0 {
            return None;
        }
        // A rate counter needs two samples a moment apart.
        unsafe { PdhCollectQueryData(query) };
        std::thread::sleep(std::time::Duration::from_millis(250));
        // Second sample on the same query.
        if unsafe { PdhCollectQueryData(query) } != 0 {
            return None;
        }
        let (mut size, mut count) = (0u32, 0u32);
        // A null buffer asks for the size the items and their names need.
        let sizing = unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut()) };
        if sizing != PDH_MORE_DATA {
            return None;
        }
        // Items first, then their names, in one block; u64 keeps it 8-byte aligned.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let items = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        // `buffer` holds `size` bytes, as PDH asked.
        if unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, items) } != 0 {
            return None;
        }
        // PDH wrote `count` items at the start of the buffer.
        let values = unsafe { std::slice::from_raw_parts(items, count as usize) };
        Some(
            values
                .iter()
                .filter(|v| v.FmtValue.CStatus <= 1)
                // PDH_FMT_DOUBLE was requested, so the union holds a double.
                .map(|v| unsafe { v.FmtValue.Anonymous.doubleValue })
                .sum::<f64>(),
        )
    })();
    // The query opened above.
    unsafe { PdhCloseQuery(query) };
    total.map(|t| t.clamp(0.0, 100.0).round() as u8)
}

#[cfg(windows)]
fn read() -> GameStats {
    let frames = rtss_memory().as_deref().and_then(parse_rtss);
    GameStats { fps: frames.map(|f| f.0), frame_time: frames.map(|f| f.1), gpu: gpu_load() }
}
#[cfg(not(windows))]
fn read() -> GameStats {
    GameStats::default()
}

#[tauri::command]
pub async fn game_stats() -> GameStats {
    tauri::async_runtime::spawn_blocking(read).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(memory: &mut [u8], at: usize, pid: u32, name: &str, times: [u32; 4]) {
        memory[at..at + 4].copy_from_slice(&pid.to_le_bytes());
        memory[at + 4..at + 4 + name.len()].copy_from_slice(name.as_bytes());
        for (i, value) in times.iter().enumerate() {
            memory[at + 268 + i * 4..at + 272 + i * 4].copy_from_slice(&value.to_le_bytes());
        }
    }

    #[test]
    fn reads_the_newest_game_framerate_from_rtss_memory() {
        let (size, offset) = (300usize, 64usize);
        let mut memory = vec![0u8; offset + size * 3];
        for (at, value) in [(0, u32::from_be_bytes(*b"RTSS")), (4, 0x0002_000e), (8, size as u32), (12, offset as u32), (16, 3)] {
            memory[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
        entry(&mut memory, offset, 10, "game.exe", [1000, 2000, 60, 16_667]);
        entry(&mut memory, offset + size, 11, "msedgewebview2.exe", [1000, 3000, 240, 4_000]);
        entry(&mut memory, offset + 2 * size, 12, "other.exe", [1000, 1500, 15, 33_333]);
        assert_eq!(parse_rtss(&memory), Some((60, 16.7)));
        memory[0] = 0;
        assert_eq!(parse_rtss(&memory), None);
        assert_eq!(parse_rtss(&[]), None);
    }
}
