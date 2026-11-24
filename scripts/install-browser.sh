#!/usr/bin/env bash
# Install one Playwright browser and its Ubuntu packages, and survive a slow or stuck package mirror.
# Usage: scripts/install-browser.sh <firefox|webkit|chrome|msedge|chromium>
#
# Why: on 2026-11-23 the Ubuntu mirror crawled for hours, and one `playwright install --with-deps webkit`
# ran into the step's 10-minute (then 20-minute) limit again and again before a single test started (PRs #76-#87).
# This only changes how the browser gets installed. Every test still runs.
#   - apt retries a dropped or stalled download itself, and gives up on a silent connection after 30 s.
#   - Each command gets 15 min per try; leftover apt processes are stopped and dpkg is tidied before the next.
#     apt keeps the .deb files it already fetched, so a retry continues instead of starting over.
#   - Try 1 uses the runner's own mirror; tries 2 and 3 switch to archive.ubuntu.com.
set -uo pipefail

BROWSER="${1:?usage: install-browser.sh <browser>}"
TRIES="${VCGE_INSTALL_TRIES:-3}"
LIMIT="${VCGE_INSTALL_LIMIT:-15m}"

printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nDPkg::Lock::Timeout "120";\n' \
  | sudo tee /etc/apt/apt.conf.d/80-vcge-retries > /dev/null

use_main_mirror() {
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do
    [ -f "$f" ] && sudo sed -i -E 's#https?://[a-z0-9.-]*azure\.archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' "$f"
  done
  echo "Switched apt to archive.ubuntu.com"
}

tidy_apt() {
  sudo pkill -x apt-get 2>/dev/null || true
  sudo pkill -f '/usr/lib/apt/methods/' 2>/dev/null || true
  sleep 3
  sudo dpkg --configure -a || true
}

for try in $(seq 1 "$TRIES"); do
  echo "::group::Install $BROWSER for Playwright (try $try of $TRIES, limit $LIMIT)"
  [ "$try" -ge 2 ] && use_main_mirror
  if timeout --kill-after=20s "$LIMIT" sudo apt-get update \
     && timeout --kill-after=20s "$LIMIT" npx playwright install-deps "$BROWSER" \
     && timeout --kill-after=20s "$LIMIT" npx playwright install "$BROWSER"; then
    echo "::endgroup::"
    echo "Installed $BROWSER on try $try"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::Installing $BROWSER failed or stalled on try $try of $TRIES"
  tidy_apt
done

echo "::error::Could not install $BROWSER for Playwright after $TRIES tries"
exit 1
