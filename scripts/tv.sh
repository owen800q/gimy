#!/usr/bin/env bash
# Build, sign, install and launch Gimy TV on a Samsung TV in Developer mode.
# Usage: GIMY_API=https://gimy-tv.<account>.workers.dev scripts/tv.sh <tv-ip> <samsung-certificate-profile>
# The profile's distributor certificate must list the TV's DUID.
set -euo pipefail
TV_IP="${1:?usage: scripts/tv.sh <tv-ip> <certificate-profile>}"
PROFILE="${2:?usage: scripts/tv.sh <tv-ip> <certificate-profile>}"
TIZEN_HOME="${TIZEN_HOME:-$HOME/tizen-studio}"
export PATH="$TIZEN_HOME/tools/ide/bin:$TIZEN_HOME/tools:$PATH"
APP_ID="GimyTvApp1.GimyTV"
cd "$(dirname "$0")/.."

sdb connect "$TV_IP" >/dev/null
TARGET="$(sdb devices | awk -v ip="$TV_IP" 'index($1, ip ":") == 1 && $2 == "device" {print $3; exit}')"
[ -n "$TARGET" ] || { echo "TV $TV_IP not connected. Is Developer mode on and the TV awake?" >&2; exit 1; }

node scripts/package-tv.mjs --profile "$PROFILE" ${GIMY_API:+--api "$GIMY_API"}
OUT="$(tizen install -n GimyTV.wgt -t "$TARGET" -- build 2>&1 || true)"
echo "$OUT"
echo "$OUT" | grep -q "successfully installed" || { echo "Install failed. Check the TV's DUID is in '$PROFILE'." >&2; exit 1; }
tizen run -p "$APP_ID" -t "$TARGET"
echo "Running on $TARGET ($TV_IP)."
