#!/usr/bin/env bash
# Runs the desktop end-to-end test on Linux (headless): Xvfb display + private D-Bus session + unlocked gnome-keyring.
# Prerequisites (Debian/Ubuntu): libwebkit2gtk-4.1-dev webkit2gtk-driver gnome-keyring libsecret-tools xvfb dbus-x11,
# plus `cargo install tauri-driver --locked` and a built app: `npx tauri build --debug --no-bundle`.
set -euo pipefail
cd "$(dirname "$0")/.."

exec dbus-run-session -- bash -c '
  # Throwaway keyring for the test run; its password only unlocks this temporary session keyring.
  export XDG_DATA_HOME="$(mktemp -d)"
  echo -n "vcge-test-keyring" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  xvfb-run -a node tests/tauri.e2e.test.cjs
'
