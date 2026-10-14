#!/bin/sh
# Rust gate: tests with zero warnings, then the whole crate compiled for Windows (the release
# target) through the GNU toolchain, which builds `ring` where the MSVC target can't from macOS.
set -eu
# Hooks launched by editors or GUI clients may not have rustup's bin on PATH.
PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/../src-tauri"
out=$(cargo test 2>&1) || { printf '%s\n' "$out"; exit 1; }
if printf '%s\n' "$out" | grep -q '^warning'; then
  printf '%s\n' "$out"
  echo "cargo test must pass with zero warnings" >&2
  exit 1
fi
printf '%s\n' "$out" | grep '^test result'
if ! rustup target list --installed | grep -q '^x86_64-pc-windows-gnu$'; then
  echo "missing Rust target: rustup target add x86_64-pc-windows-gnu" >&2
  exit 1
fi
if ! command -v x86_64-w64-mingw32-gcc >/dev/null; then
  echo "missing cross compiler: brew install mingw-w64" >&2
  exit 1
fi
cargo check --target x86_64-pc-windows-gnu --all-targets
