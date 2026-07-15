#!/usr/bin/env bash
# Ascan macOS 定时运行脚本：生成统一 HTML 日报

set -euo pipefail

# 避免被外层 shell 激活的其他项目 venv 干扰(uv run 会优先用 $VIRTUAL_ENV)
unset VIRTUAL_ENV
unset PYTHONHOME
unset PYTHONPATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs docs

LOG_FILE="./logs/ascan_daily_$(date +%Y%m%d).log"

# 日志轮转：清理 30 天前的运行日志和过期 lock 文件
find ./logs -name "ascan_daily_*.log" -mtime +30 -delete 2>/dev/null || true
find ./logs -name "ascan_*.lock" -mtime +7 -delete 2>/dev/null || true
# 截断 launchd stdout/stderr 日志（保留最近 1000 行）
for lf in ./logs/launchd_daily.out.log ./logs/launchd_daily.err.log; do
  if [ -f "$lf" ] && [ "$(wc -l < "$lf")" -gt 2000 ]; then
    tail -1000 "$lf" > "${lf}.tmp" && mv "${lf}.tmp" "$lf"
  fi
done

# 周末跳过：launchd 周六/周日唤醒补跑时直接退出（arXiv 周末不更新）
DOW=$(date +%u)  # 1=Mon ... 7=Sun
if [ $# -eq 0 ] && [ "$DOW" -ge 6 ]; then
  echo "[$(date '+%F %T')] [skip] weekend (day=$DOW), arXiv does not publish" >> "$LOG_FILE"
  exit 0
fi

# 幂等保护：当日日报已存在且无显式参数时跳过，避免 launchd 唤醒补跑重复生成
TODAY_REPORT="docs/Ascan-$(date +%Y%m%d).html"
if [ $# -eq 0 ] && [ -f "$TODAY_REPORT" ]; then
  echo "[$(date '+%F %T')] [skip] today's report already exists: $TODAY_REPORT" >> "$LOG_FILE"
  exit 0
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "[$(date '+%F %T')] Rebuilding macOS virtual environment..." >> "$LOG_FILE"
  # Build in a temp directory first; only replace .venv after success
  rm -rf .venv_tmp
  if uv venv --directory . .venv_tmp >> "$LOG_FILE" 2>&1 && \
     uv pip install --python .venv_tmp/bin/python -r requirements.txt >> "$LOG_FILE" 2>&1; then
    rm -rf .venv
    mv .venv_tmp .venv
    echo "[$(date '+%F %T')] venv 重建成功" >> "$LOG_FILE"
  else
    echo "[$(date '+%F %T')] [ERROR] venv 重建失败，保留现有环境" >> "$LOG_FILE"
    rm -rf .venv_tmp
    exit 1
  fi
fi

# 带重试的执行：失败后等待 10 分钟再试一次（应对瞬时网络/API 故障）
MAX_RETRIES=2
RETRY_DELAY=600  # 10 minutes

for attempt in $(seq 1 $MAX_RETRIES); do
  echo "[$(date '+%F %T')] [attempt $attempt/$MAX_RETRIES] 开始执行 main_daily.py" >> "$LOG_FILE"
  if .venv/bin/python main_daily.py "$@" >> "$LOG_FILE" 2>&1; then
    echo "[$(date '+%F %T')] [success] 日报生成成功" >> "$LOG_FILE"

    # 自动上传钉钉知识库（直连 aone-km MCP，失败不阻塞流程）
    echo "[$(date '+%F %T')] [upload] 开始上传钉钉..." >> "$LOG_FILE"
    if .venv/bin/python "$SCRIPT_DIR/upload_dingtalk_direct.py" >> "$LOG_FILE" 2>&1; then
      echo "[$(date '+%F %T')] [upload] 钉钉上传成功" >> "$LOG_FILE"
    else
      echo "[$(date '+%F %T')] [upload] 钉钉上传失败（不阻塞流程）" >> "$LOG_FILE"
    fi

    exit 0
  fi

  echo "[$(date '+%F %T')] [fail] attempt $attempt/$MAX_RETRIES 失败" >> "$LOG_FILE"
  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    echo "[$(date '+%F %T')] [retry] 等待 ${RETRY_DELAY}s 后重试..." >> "$LOG_FILE"
    sleep $RETRY_DELAY
  fi
done

echo "[$(date '+%F %T')] [ERROR] 全部 $MAX_RETRIES 次尝试均失败，请检查日志: $LOG_FILE" >> "$LOG_FILE"
exit 1
