#!/usr/bin/env bash
# Ascan macOS LaunchAgent 安装脚本
# 用法: ./scripts/install_launchd.sh
#
# 行为:
#   1. 读取 scripts/launchd/com.ascan.daily.plist.template
#   2. 把 __PROJECT_DIR__ / __USER_HOME__ 替换为本机绝对路径
#   3. 写入 ~/Library/LaunchAgents/com.ascan.daily.plist
#   4. launchctl bootout (清旧) + bootstrap (加载)
#
# 每天 08:30 触发 scripts/run.sh,休眠唤醒后自动补跑一次。
#
# 更新说明 (2026-06-11):
# - 现在 daily 报告会自动上传到钉钉知识库，且自动去除H1标题（避免重复显示）
# - 上传改为直连 aone-km MCP (scripts/upload_dingtalk_direct.py)，不再嵌套本地 claude

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TEMPLATE="$SCRIPT_DIR/launchd/com.ascan.daily.plist.template"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/com.ascan.daily.plist"
LABEL="com.ascan.daily"

if [ ! -f "$TEMPLATE" ]; then
  echo "[ERROR] 找不到 plist 模板: $TEMPLATE" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[ERROR] 未找到 uv 命令。请先安装 uv:" >&2
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

UV_PATH="$(command -v uv)"
UV_DIR="$(dirname "$UV_PATH")"
echo "[info] uv 已找到: $UV_PATH"
echo "[info] 项目目录: $PROJECT_DIR"

mkdir -p "$TARGET_DIR"
mkdir -p "$PROJECT_DIR/logs"

# 替换模板占位符,| 作分隔符避免和绝对路径里的 / 冲突
# __UV_DIR__ 注入实际检测到的 uv 安装目录(miniforge/conda/asdf 等非默认位置)
sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
    -e "s|__USER_HOME__|$HOME|g" \
    -e "s|__UV_DIR__|$UV_DIR|g" \
    "$TEMPLATE" > "$TARGET_PLIST"

echo "[info] 已生成 plist: $TARGET_PLIST"

if ! plutil -lint "$TARGET_PLIST" >/dev/null; then
  echo "[ERROR] 生成的 plist 不合法,请检查模板与路径" >&2
  exit 1
fi

DOMAIN="gui/$(id -u)"

# 清理旧实例(若不存在 bootout 会返回非零,用 || true 忽略)
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

# 加载新 plist
launchctl bootstrap "$DOMAIN" "$TARGET_PLIST"

echo
echo "[info] LaunchAgent 注册状态:"
launchctl print "$DOMAIN/$LABEL" 2>/dev/null | head -30 || \
  echo "  (launchctl print 无输出,可能需要 macOS 13+)"

echo
echo "[done] 已安装。每天 08:30 自动执行 scripts/run.sh。"
echo "      休眠唤醒后会补跑一次,run.sh 的幂等保护会跳过当日已生成的日报。"
echo
echo "[updated] 更新内容:"
echo "      - 日报现在会自动上传到钉钉知识库"
echo "      - 自动去除H1标题，避免在钉钉中重复显示"
echo "      - 如需手动上传，请使用: python3 scripts/upload_dingtalk_direct.py [YYYYMMDD]"
echo
echo "排障命令:"
echo "  launchctl list | grep $LABEL"
echo "  tail -f $PROJECT_DIR/logs/launchd_daily.err.log"
echo
echo "如需立即生成当日日报,请手动执行:"
echo "  $PROJECT_DIR/scripts/run.sh"