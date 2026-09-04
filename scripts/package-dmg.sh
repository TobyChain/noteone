#!/bin/bash
# Package NoteOne as a self-contained macOS .app + DMG (ad-hoc signed).
#
#   scripts/package-dmg.sh [output-dir]
#
# Produces: dist/NoteOne.dmg — download, drag to /Applications, double-click.
# The .app embeds the Node runtime, the bundled server (PGlite embedded DB),
# and the TS newlore pipeline. No Docker/Postgres/Python required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
if [[ "$OUT_DIR" != /* ]]; then
  OUT_DIR="$ROOT/$OUT_DIR"
fi
APP_NAME="NoteOne"
STAGE="$OUT_DIR/stage"
mkdir -p "$OUT_DIR"

echo "==> 1/5 bundle server (esbuild)"
cd "$ROOT/server"
node scripts/bundle.mjs

echo "==> 2/5 build macOS app (Release)"
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

echo "==> 4/5 codesign (ad-hoc)"
codesign --force --deep --sign - "$STAGE/$APP_NAME.app"

echo "==> 5/5 create dmg"
mkdir -p "$OUT_DIR"
DMG="$OUT_DIR/$APP_NAME.dmg"
rm -f "$DMG"
ln -sfn /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" | tail -1
rm -rf "$STAGE"

echo "done: $DMG ($(du -h "$DMG" | cut -f1))"
