//! Remove only files named by the installed Epic build manifest. Unknown files (including saves/mods)
//! are retained. The format is verified against the launcher manifest schema documented by Legendary.
use flate2::read::ZlibDecoder;
use sha1::{Digest, Sha1};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
const LIMIT: usize = 64 * 1024 * 1024;
fn invalid<T>() -> Result<T, String> {
    Err("invalidUninstallManifest".into())
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or("invalidUninstallManifest")?;
    Ok(u32::from_le_bytes(value.try_into().unwrap()))
}
fn string(bytes: &[u8], cursor: &mut usize) -> Result<String, String> {
    let length = u32_at(bytes, *cursor)? as i32;
    *cursor += 4;
    if length == 0 {
        return Ok(String::new());
    }
    if length.unsigned_abs() > 32768 {
        return invalid();
    }
    let wide = length < 0;
    let size = length.unsigned_abs() as usize * if wide { 2 } else { 1 };
    let value = bytes
        .get(*cursor..*cursor + size)
        .ok_or("invalidUninstallManifest")?;
    *cursor += size;
    if wide {
        if value[size - 2..] != [0, 0] {
            return invalid();
        }
        String::from_utf16(
            &value[..size - 2]
                .chunks_exact(2)
                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| "invalidUninstallManifest".into())
    } else {
        if value[size - 1] != 0 {
            return invalid();
        }
        String::from_utf8(value[..size - 1].to_vec()).map_err(|_| "invalidUninstallManifest".into())
    }
}
fn file_names(bytes: &[u8], expected_app: &str) -> Result<Vec<String>, String> {
    if bytes.len() > LIMIT || u32_at(bytes, 0)? != 0x44bec00c {
        return invalid();
    }
    let header = u32_at(bytes, 4)? as usize;
    let raw_size = u32_at(bytes, 8)? as usize;
    let stored_size = u32_at(bytes, 12)? as usize;
    let flags = *bytes.get(36).ok_or("invalidUninstallManifest")?;
    if header < 41
        || header > bytes.len()
        || raw_size > LIMIT
        || flags & !1 != 0
        || bytes.len() - header != stored_size
    {
        return invalid();
    }
    let payload = &bytes[header..];
    let data = if flags == 1 {
        let mut decoded = Vec::new();
        ZlibDecoder::new(payload)
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut decoded)
            .map_err(|_| "invalidUninstallManifest")?;
        decoded
    } else {
        payload.to_vec()
    };
    if data.len() != raw_size || Sha1::digest(&data).as_slice() != &bytes[16..36] {
        return invalid();
    }
    let meta_end = u32_at(&data, 0)? as usize;
    if meta_end < 14 || meta_end > data.len() {
        return invalid();
    }
    let mut cursor = 14;
    if string(&data[..meta_end], &mut cursor)? != expected_app {
        return invalid();
    }
    let chunk_size = u32_at(&data, meta_end)? as usize;
    if chunk_size < 9 {
        return invalid();
    }
    let files_start = meta_end
        .checked_add(chunk_size)
        .ok_or("invalidUninstallManifest")?;
    let files_size = u32_at(&data, files_start)? as usize;
    let end = files_start
        .checked_add(files_size)
        .ok_or("invalidUninstallManifest")?;
    if files_size < 9 || end > data.len() {
        return invalid();
    }
    let count = u32_at(&data, files_start + 5)? as usize;
    if count == 0 || count > 200000 {
        return invalid();
    }
    cursor = files_start + 9;
    let mut names = Vec::with_capacity(count);
    for _ in 0..count {
        let name = string(&data[..end], &mut cursor)?;
        safe_relative(&name)?;
        names.push(name);
    }
    // Symlink records aren't supported for destructive operations.
    for _ in 0..count {
        if !string(&data[..end], &mut cursor)?.is_empty() {
            return invalid();
        }
    }
    Ok(names)
}
fn safe_relative(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.contains(':')
        || value.contains('\0')
        || value.starts_with(['/', '\\'])
    {
        return invalid();
    }
    let normalized = value.replace('\\', "/");
    if normalized
        .split('/')
        .any(|v| v.is_empty() || v == "." || v == "..")
    {
        return invalid();
    }
    let path = PathBuf::from(normalized);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return invalid();
    }
    Ok(path)
}
fn contained_file(root: &Path, relative: &str) -> Result<Option<PathBuf>, String> {
    let relative = safe_relative(relative)?;
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err("unsafeUninstallPath".into());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err("unsafeUninstallPath".into());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("uninstallFailed".into()),
        }
    }
    let canonical = fs::canonicalize(&path).map_err(|_| "uninstallFailed")?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("unsafeUninstallPath".into());
    }
    Ok(Some(canonical))
}
pub fn uninstall(app: &str) -> Result<(), String> {
    let directory = crate::library::epic_manifests_dir().ok_or("uninstallUnavailable")?;
    let mut matching = Vec::new();
    for file in fs::read_dir(directory)
        .map_err(|_| "uninstallUnavailable")?
        .flatten()
    {
        let path = file.path();
        if path.extension().is_none_or(|e| e != "item") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if value.get("AppName").and_then(|v| v.as_str()) == Some(app) {
            matching.push((path, value));
        }
    }
    if matching.len() != 1 {
        return invalid();
    }
    let (item, value) = matching.pop().unwrap();
    let install = value
        .get("InstallLocation")
        .and_then(|v| v.as_str())
        .ok_or("invalidUninstallManifest")?;
    let root = fs::canonicalize(install).map_err(|_| "uninstallUnavailable")?;
    if root.components().count() < 3 || !root.is_dir() {
        return Err("unsafeUninstallPath".into());
    }
    #[cfg(windows)]
    {
        let processes = sysinfo::System::new_all();
        if processes.processes().values().any(|process| {
            process
                .name()
                .to_string_lossy()
                .eq_ignore_ascii_case("EpicGamesLauncher.exe")
                || process.exe().and_then(|exe| fs::canonicalize(exe).ok()).is_some_and(|exe| exe.starts_with(&root))
        }) {
            return Err("uninstallTitleRunning".into());
        }
    }
    let executable = value
        .get("LaunchExecutable")
        .and_then(|v| v.as_str())
        .ok_or("invalidUninstallManifest")?;
    contained_file(&root, executable)?;
    let guid = value
        .get("InstallationGuid")
        .and_then(|v| v.as_str())
        .filter(|s| {
            !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        })
        .ok_or("invalidUninstallManifest")?;
    let build_relative = format!(".egstore/{guid}.manifest");
    let build_path = contained_file(&root, &build_relative)?.ok_or("invalidUninstallManifest")?;
    if fs::metadata(&build_path)
        .map_err(|_| "invalidUninstallManifest")?
        .len()
        > LIMIT as u64
    {
        return invalid();
    }
    let bytes = fs::read(&build_path).map_err(|_| "invalidUninstallManifest")?;
    let names = file_names(&bytes, app)?;
    let mut paths = Vec::new();
    // Resolve and validate the entire list before changing any files.
    for name in &names {
        if let Some(path) = contained_file(&root, name)? {
            paths.push(path);
        }
    }
    if !names
        .iter()
        .any(|name| safe_relative(name).ok() == safe_relative(executable).ok())
    {
        return invalid();
    }
    // The item's directory must be writable; don't delete game files if bookkeeping can't be updated.
    let backup = item.with_extension("sofa-uninstall-backup");
    if backup.exists() {
        return Err("uninstallFailed".into());
    }
    fs::copy(&item, &backup).map_err(|_| "uninstallFailed")?;
    let result = remove_owned(&paths)
        .and_then(|_| fs::remove_file(&item).map_err(|_| "uninstallFailed".into()));
    if result.is_ok() {
        let _ = fs::remove_file(build_path);
        if let Ok(Some(path)) = contained_file(&root, &format!(".egstore/{guid}.mancpn")) {
            let _ = fs::remove_file(path);
        }
        // Remove empty directories only. Unlisted personal files and saves are preserved.
        let mut parents = paths
            .iter()
            .filter_map(|p| p.parent().map(Path::to_path_buf))
            .collect::<Vec<_>>();
        parents.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        parents.dedup();
        for mut path in parents {
            while path.starts_with(&root) && path != root {
                if fs::remove_dir(&path).is_err() {
                    break;
                }
                path.pop();
            }
        }
        let _ = fs::remove_dir(root.join(".egstore"));
        let _ = fs::remove_dir(&root);
    }
    let _ = fs::remove_file(backup);
    result
}
fn remove_owned(paths: &[PathBuf]) -> Result<(), String> {
    for path in paths {
        fs::remove_file(path).map_err(|_| "uninstallFailed")?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn build(app: &str, filenames: &[&str], compressed: bool) -> Vec<u8> {
        fn fstring(value: &str) -> Vec<u8> {
            let mut bytes = ((value.len() + 1) as u32).to_le_bytes().to_vec();
            bytes.extend_from_slice(value.as_bytes());
            bytes.push(0);
            bytes
        }
        let mut meta = vec![0u8; 14];
        meta[5..9].copy_from_slice(&18u32.to_le_bytes());
        meta.extend(fstring(app));
        let size = meta.len() as u32;
        meta[..4].copy_from_slice(&size.to_le_bytes());
        let mut chunks = 9u32.to_le_bytes().to_vec();
        chunks.extend([0u8; 5]);
        let mut files = vec![0u8; 9];
        files[5..9].copy_from_slice(&(filenames.len() as u32).to_le_bytes());
        for name in filenames {
            files.extend(fstring(name));
        }
        for _ in filenames {
            files.extend(0u32.to_le_bytes());
        }
        let size = files.len() as u32;
        files[..4].copy_from_slice(&size.to_le_bytes());
        let data = [meta, chunks, files].concat();
        let payload = if compressed {
            use std::io::Write;
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(&data).unwrap();
            encoder.finish().unwrap()
        } else {
            data.clone()
        };
        let mut header = 0x44bec00cu32.to_le_bytes().to_vec();
        header.extend(41u32.to_le_bytes());
        header.extend((data.len() as u32).to_le_bytes());
        header.extend((payload.len() as u32).to_le_bytes());
        header.extend_from_slice(&Sha1::digest(&data));
        header.push(u8::from(compressed));
        header.extend(18u32.to_le_bytes());
        header.extend(payload);
        header
    }
    #[test]
    fn valid_build_is_bound_to_the_title_and_its_integrity() {
        for compressed in [false, true] {
            let bytes = build("Title", &["game.exe", "content/data.pak"], compressed);
            assert_eq!(
                file_names(&bytes, "Title").unwrap(),
                ["game.exe", "content/data.pak"]
            );
            assert!(file_names(&bytes, "DifferentTitle").is_err());
            let mut corrupt = bytes.clone();
            corrupt[16] ^= 1;
            assert!(file_names(&corrupt, "Title").is_err());
            assert!(file_names(&bytes[..bytes.len() - 1], "Title").is_err());
        }
        assert!(file_names(&build("Title", &["../personal"], false), "Title").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn links_to_personal_files_are_rejected() {
        let root =
            std::env::temp_dir().join(format!("sofa-uninstall-link-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        assert!(contained_file(&canonical, "outside/anything").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn paths_cannot_escape_or_target_drives_or_windows_streams() {
        for path in [
            "../save",
            "a/../../x",
            "C:\\Windows\\x",
            "\\\\server\\x",
            "/root",
            "a:stream",
            "a//b",
            "a/./b",
        ] {
            assert!(safe_relative(path).is_err(), "{path}");
        }
        assert_eq!(
            safe_relative("Game\\bin\\game.exe").unwrap(),
            PathBuf::from("Game/bin/game.exe")
        );
    }
    #[test]
    fn remove_owned_keeps_unlisted_personal_files() {
        let root = std::env::temp_dir().join(format!("sofa-uninstall-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let game = root.join("game.exe");
        let save = root.join("save.dat");
        fs::write(&game, b"fixture").unwrap();
        fs::write(&save, b"personal").unwrap();
        remove_owned(&[game.clone()]).unwrap();
        assert!(!game.exists());
        assert_eq!(fs::read(&save).unwrap(), b"personal");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn malformed_or_encrypted_build_is_rejected_before_removal() {
        assert!(file_names(b"corrupt", "Game").is_err());
        let mut data = vec![0; 41];
        data[..4].copy_from_slice(&0x44bec00cu32.to_le_bytes());
        data[4..8].copy_from_slice(&41u32.to_le_bytes());
        data[36] = 2;
        assert!(file_names(&data, "Game").is_err());
    }
}
