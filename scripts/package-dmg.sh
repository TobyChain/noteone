#!/bin/bash
# Package NoteOne as a self-contained, Developer ID-signed and notarized DMG.
#
#   scripts/package-dmg.sh [output-dir]
#   scripts/package-dmg.sh --local [output-dir]
#
# Produces NoteOne.dmg; --local produces NoteOne-local.dmg for this Mac only.
# The .app embeds the Node runtime, the bundled server (PGlite embedded DB),
# and the TS newlore pipeline. No Docker/Postgres/Python required.
#
# Required for a release build:
#   NOTEONE_SIGNING_IDENTITY="Developer ID Application: ..."
#   NOTEONE_NOTARY_KEYCHAIN_PROFILE=<notarytool profile>
# Or, instead of a keychain profile:
#   NOTEONE_NOTARY_KEY=<AuthKey_....p8 path>
#   NOTEONE_NOTARY_KEY_ID=<App Store Connect key ID>
#   NOTEONE_NOTARY_ISSUER=<App Store Connect issuer ID>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING_MODE="developer-id"
if [ "${1:-}" = "--local" ]; then
  SIGNING_MODE="local"
  shift
fi
[ "$#" -le 1 ] || {
  echo "usage: scripts/package-dmg.sh [--local] [output-dir]" >&2
  exit 2
}
OUT_DIR="${1:-$ROOT/dist}"
if [[ "$OUT_DIR" != /* ]]; then
  OUT_DIR="$ROOT/$OUT_DIR"
fi
APP_NAME="NoteOne"
STAGE="$OUT_DIR/stage"
APP="$STAGE/$APP_NAME.app"
if [ "$SIGNING_MODE" = "local" ]; then
  DMG="$OUT_DIR/$APP_NAME-local.dmg"
else
  DMG="$OUT_DIR/$APP_NAME.dmg"
fi
MACOS_ENTITLEMENTS="$ROOT/apple/NoteOne/NoteOne-macOS.entitlements"
NODE_ENTITLEMENTS="$ROOT/apple/NoteOne/NodeRuntime-macOS.entitlements"
SIGNING_IDENTITY="${NOTEONE_SIGNING_IDENTITY:-}"
NOTARY_KEYCHAIN_PROFILE="${NOTEONE_NOTARY_KEYCHAIN_PROFILE:-}"
NOTARY_KEY="${NOTEONE_NOTARY_KEY:-}"
NOTARY_KEY_ID="${NOTEONE_NOTARY_KEY_ID:-}"
NOTARY_ISSUER="${NOTEONE_NOTARY_ISSUER:-}"

fail() {
  echo "error: $*" >&2
  exit 1
}

if [ "$SIGNING_MODE" = "developer-id" ]; then
  [[ "$SIGNING_IDENTITY" == "Developer ID Application: "* ]] || fail \
    'NOTEONE_SIGNING_IDENTITY must name a Developer ID Application certificate.'
  if [[ "$SIGNING_IDENTITY" =~ \(([A-Z0-9]{10})\)$ ]]; then
    EXPECTED_TEAM_IDENTIFIER="${BASH_REMATCH[1]}"
  else
    fail 'NOTEONE_SIGNING_IDENTITY must end with a 10-character Team ID in parentheses.'
  fi
  AVAILABLE_IDENTITIES="$(security find-identity -v -p codesigning)"
  grep -Fq -- "\"$SIGNING_IDENTITY\"" <<< "$AVAILABLE_IDENTITIES" || fail \
    "Developer ID signing identity not found in the current keychain: $SIGNING_IDENTITY"

  if [ -n "$NOTARY_KEYCHAIN_PROFILE" ]; then
    NOTARY_ARGUMENTS=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE")
  elif [ -n "$NOTARY_KEY" ] && [ -n "$NOTARY_KEY_ID" ] && [ -n "$NOTARY_ISSUER" ]; then
    [ -f "$NOTARY_KEY" ] || fail "App Store Connect API key not found: $NOTARY_KEY"
    NOTARY_ARGUMENTS=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
  else
    fail 'Configure NOTEONE_NOTARY_KEYCHAIN_PROFILE or all three App Store Connect API key variables.'
  fi
else
  echo "warning: building a local ad-hoc DMG; do not publish this artifact" >&2
fi

mkdir -p "$OUT_DIR"

echo "==> 1/7 bundle server (esbuild)"
cd "$ROOT/server"
node scripts/bundle.mjs

echo "==> 2/7 build macOS app (Release)"
cd "$ROOT/apple"
if command -v xcodegen >/dev/null 2>&1; then
  xcodegen generate --quiet
else
  echo "    xcodegen not found; using the checked-in Xcode project"
fi
xcodebuild -project NoteOne.xcodeproj -scheme NoteOne_macOS -configuration Release \
  -derivedDataPath build ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build \
  | tee "$OUT_DIR/xcodebuild.log"

APP_SRC="$ROOT/apple/build/Build/Products/Release/$APP_NAME.app"
[ -d "$APP_SRC" ] || { echo "app not found: $APP_SRC"; exit 1; }

echo "==> 3/7 embed server + node runtime into .app"
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -R "$APP_SRC" "$APP"
RES="$APP/Contents/Resources/server"
mkdir -p "$RES"
cp -R "$ROOT/server/bundle/." "$RES/"
# Official Node.js static binary (Homebrew's node dynamically links libnode and
# is not relocatable). Downloaded once and cached under dist/node-runtime.
NODE_VERSION="v22.21.1"
NODE_DIST="node-$NODE_VERSION-darwin-arm64"
NODE_ARCHIVE="$NODE_DIST.tar.gz"
NODE_SHA256="c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af"
NODE_BIN="$OUT_DIR/node-runtime/$NODE_DIST/bin/node"
NODE_TARBALL="$OUT_DIR/node-runtime/$NODE_ARCHIVE"
mkdir -p "$OUT_DIR/node-runtime"
if [ -f "$NODE_TARBALL" ] && ! echo "$NODE_SHA256  $NODE_TARBALL" | shasum -a 256 --check --status; then
  echo "    cached Node.js archive failed verification; downloading it again"
  rm -f "$NODE_TARBALL"
fi
if [ ! -f "$NODE_TARBALL" ]; then
  echo "    downloading Node.js $NODE_VERSION runtime..."
  NODE_DOWNLOAD="$NODE_TARBALL.download"
  rm -f "$NODE_DOWNLOAD"
  curl --fail --location --silent --show-error --retry 3 \
    "https://nodejs.org/dist/$NODE_VERSION/$NODE_ARCHIVE" -o "$NODE_DOWNLOAD"
  echo "$NODE_SHA256  $NODE_DOWNLOAD" | shasum -a 256 --check
  mv "$NODE_DOWNLOAD" "$NODE_TARBALL"
fi
echo "$NODE_SHA256  $NODE_TARBALL" | shasum -a 256 --check
rm -rf "$OUT_DIR/node-runtime/$NODE_DIST"
tar xzf "$NODE_TARBALL" -C "$OUT_DIR/node-runtime"
cp "$NODE_BIN" "$RES/node"
chmod +x "$RES/node"

echo "==> 4/7 sign app ($SIGNING_MODE)"
if [ "$SIGNING_MODE" = "developer-id" ]; then
  # Sign nested executable code before the outer app. Avoid --deep for signing
  # so every code object has an explicit, auditable signature.
  codesign --force --options runtime --timestamp \
    --entitlements "$NODE_ENTITLEMENTS" \
    --sign "$SIGNING_IDENTITY" \
    "$RES/node"
  codesign --force --options runtime --timestamp \
    --entitlements "$MACOS_ENTITLEMENTS" \
    --sign "$SIGNING_IDENTITY" \
    "$APP"
else
  # Keep the official Node.js Foundation signature intact. Only the outer app
  # is ad-hoc signed for an explicit local build.
  codesign --verify --strict --verbose=2 "$RES/node"
  codesign --force --options runtime \
    --entitlements "$MACOS_ENTITLEMENTS" \
    --sign - \
    "$APP"
fi
codesign --verify --deep --strict --verbose=2 "$APP"

APP_APPLE_EVENTS="$(codesign --display --entitlements - --xml "$APP" 2>/dev/null \
  | plutil -extract 'com\.apple\.security\.automation\.apple-events' raw -)"
[ "$APP_APPLE_EVENTS" = "true" ] || fail \
  'Signed app is missing the Apple Events entitlement required for browser metadata capture.'

if [ "$SIGNING_MODE" = "developer-id" ]; then
  SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "$APP" 2>&1)"
  TEAM_IDENTIFIER="$(printf '%s\n' "$SIGNATURE_DETAILS" | sed -n 's/^TeamIdentifier=//p')"
  [ "$TEAM_IDENTIFIER" = "$EXPECTED_TEAM_IDENTIFIER" ] || fail \
    "Signed app TeamIdentifier '$TEAM_IDENTIFIER' does not match '$EXPECTED_TEAM_IDENTIFIER'."
  printf '%s\n' "$SIGNATURE_DETAILS" | grep -q 'flags=.*runtime' || fail \
    'Signed app does not have Hardened Runtime enabled.'
  DESIGNATED_REQUIREMENT="$(codesign -dr - "$APP" 2>&1 | sed -n 's/^designated => //p')"
  [ -n "$DESIGNATED_REQUIREMENT" ] || fail 'Signed app has no designated requirement.'
  case "$DESIGNATED_REQUIREMENT" in
    *cdhash*) fail 'App designated requirement is tied to a cdhash; use a stable Developer ID identity.' ;;
  esac
fi

echo "==> 5/7 create and sign DMG"
rm -f "$DMG"
ln -sfn /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" | tail -1
if [ "$SIGNING_MODE" = "developer-id" ]; then
  codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG"
else
  codesign --force --sign - "$DMG"
fi
codesign --verify --verbose=2 "$DMG"
hdiutil verify "$DMG"

if [ "$SIGNING_MODE" = "developer-id" ]; then
  echo "==> 6/7 notarize DMG"
  xcrun notarytool submit "$DMG" "${NOTARY_ARGUMENTS[@]}" --wait
  xcrun stapler staple "$DMG"

  echo "==> 7/7 validate notarized artifact"
  xcrun stapler validate "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
else
  echo "==> 6/7 skip notarization for explicit local build"
  echo "==> 7/7 local artifact verified; Accessibility must be reauthorized after replacement"
fi
rm -rf "$STAGE"

if [ "$SIGNING_MODE" = "developer-id" ]; then
  echo "done: $DMG ($(du -h "$DMG" | cut -f1)), Team ID $TEAM_IDENTIFIER"
else
  echo "done: $DMG ($(du -h "$DMG" | cut -f1)), local ad-hoc build"
fi
