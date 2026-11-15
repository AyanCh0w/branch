#!/bin/sh
set -eu

cd "$(dirname "$0")"
identity=${BRANCH_CODESIGN_IDENTITY:-$(git config --local --get branch.desktopSigningIdentity || :)}
app_name='Branch for Mac'
if [ -z "$identity" ] || [ "$identity" = '-' ]; then
    identity=-
    app_name='Branch Desktop Probe'
    printf '%s\n' 'Building an ad hoc diagnostic. Configure a signing identity to keep Accessibility approval across builds.' >&2
fi

swift build --configuration release
binary_dir=$(swift build --configuration release --show-bin-path)
mkdir -p build
stage=$(mktemp -d "$PWD/build/.staging.XXXXXX")
trap 'rm -rf "$stage"' EXIT
bundle="$stage/$app_name.app"
app="$PWD/build/$app_name.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp Info.plist "$bundle/Contents/Info.plist"
cp Sources/BranchDesktopProbe/Resources/desktop-baseline.json "$bundle/Contents/Resources/desktop-baseline.json"
cp ../app/icons/branch-mark.svg ../app/fonts/BDOGrotesk-Regular.woff2 ../app/fonts/BDOGrotesk-DemiBold.woff2 "$bundle/Contents/Resources/"
install -m 755 "$binary_dir/BranchDesktopProbe" "$bundle/Contents/MacOS/BranchDesktopProbe"
if [ "$identity" = '-' ]; then
    plutil -replace CFBundleName -string "$app_name" "$bundle/Contents/Info.plist"
    plutil -replace CFBundleIdentifier -string com.branch.desktop-probe "$bundle/Contents/Info.plist"
fi
codesign --force --options runtime --sign "$identity" "$bundle"
codesign --verify --strict "$bundle"
rm -rf "$app"
mv "$bundle" "$app"
printf '%s\n' "$app"
