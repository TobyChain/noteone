#!/bin/bash
# Package NoteOne as a self-contained macOS .app + dmg (ad-hoc signed, personal use).
#
#   scripts/package-dmg.sh [output-dir]
#
# Produces: dist/NoteOne.dmg — download, drag to /Applications, double-click.
# The .app embeds the Node runtime, the bundled server (PGlite embedded DB),
# and the TS ascan pipeline. No Docker/Postgres/Python required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
APP_NAME="NoteOne"
STAGE="$OUT_DIR/stage"

echo "==> 1/5 bundle server (esbuild)"
cd "$ROOT/server"
node scripts/bundle.mjs

echo "==> 2/5 build macOS app (Release)"
cd "$ROOT/apple"
xcodegen generate --quiet
xcodebuild -project NoteOne.xcodeproj -scheme NoteOne_macOS -configuration Release \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build | tail -2

APP_SRC="$ROOT/apple/build/Build/Products/Release/$APP_NAME.app"
[ -d "$APP_SRC" ] || { echo "app not found: $APP_SRC"; exit 1; }

echo "==> 3/5 embed server + node runtime into .app"
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -R "$APP_SRC" "$STAGE/$APP_NAME.app"
RES="$STAGE/$APP_NAME.app/Contents/Resources/server"
mkdir -p "$RES"
cp -R "$ROOT/server/bundle/." "$RES/"
# Official Node.js static binary (Homebrew's node dynamically links libnode and
# is not relocatable). Downloaded once and cached under dist/node-runtime.
NODE_VERSION="v22.21.1"
NODE_DIST="node-$NODE_VERSION-darwin-arm64"
NODE_BIN="$OUT_DIR/node-runtime/$NODE_DIST/bin/node"
if [ ! -f "$NODE_BIN" ]; then
  echo "    downloading Node.js $NODE_VERSION runtime..."
  mkdir -p "$OUT_DIR/node-runtime"
  curl -sL "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.gz" \
    | tar xz -C "$OUT_DIR/node-runtime"
fi
cp "$NODE_BIN" "$RES/node"
chmod +x "$RES/node"

echo "==> 4/5 ad-hoc codesign"
codesign --force --deep -s - "$STAGE/$APP_NAME.app"

echo "==> 5/5 create dmg"
mkdir -p "$OUT_DIR"
DMG="$OUT_DIR/$APP_NAME.dmg"
rm -f "$DMG"
ln -sfn /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" | tail -1
rm -rf "$STAGE"

echo "done: $DMG ($(du -h "$DMG" | cut -f1))"
