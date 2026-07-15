#!/usr/bin/env bash
# Ascan macOS LaunchAgent 卸载脚本
# 用法: ./scripts/uninstall_launchd.sh

set -euo pipefail

LABEL="com.ascan.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

rm -f "$PLIST"

echo "[done] 已卸载 $LABEL LaunchAgent。"
echo "  plist 已删除: $PLIST"
echo "  如需重新安装: ./scripts/install_launchd.sh"
