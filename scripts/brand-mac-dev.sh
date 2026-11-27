#!/usr/bin/env bash
# Brands the local Electron.app dev bundle on macOS so the Dock, Cmd+Tab,
# and top menu bar display "Faktum" and the Faktum icon instead of "Electron".
set -e

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/node_modules/electron/dist/Electron.app"
PLIST="$APP_BUNDLE/Contents/Info.plist"
ICON_SRC="$ROOT_DIR/build/icon.icns"
ICON_DST="$APP_BUNDLE/Contents/Resources/electron.icns"

if [ ! -f "$PLIST" ]; then
  exit 0
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleName Faktum" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string Faktum" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Faktum" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Faktum" "$PLIST"

if [ -f "$ICON_SRC" ]; then
  cp -f "$ICON_SRC" "$ICON_DST"
fi

# Refresh macOS LaunchServices metadata cache for the bundle
touch "$APP_BUNDLE"
