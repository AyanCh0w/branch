#!/bin/sh
set -eu

cd "$(dirname "$0")"
swift build --configuration release
binary_dir=$(swift build --configuration release --show-bin-path)
app="$PWD/build/Branch Desktop Probe.app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
install -m 755 "$binary_dir/BranchDesktopProbe" "$app/Contents/MacOS/BranchDesktopProbe"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
printf '%s\n' "$app"
