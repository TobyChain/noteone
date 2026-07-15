# Tasks: Daily Scheduler (macOS launchd)

## Phase 1: launchd 调度产物

### Task 1.1: 新建 plist 模板 [x]
- **文件**: `scripts/launchd/com.ascan.daily.plist.template` (新增)
- **操作**:
  - 创建 `scripts/launchd/` 目录
  - 写入标准 LaunchAgent plist,包含字段:
    - `Label` = `com.ascan.daily`
    - `ProgramArguments` = `["/bin/bash", "__PROJECT_DIR__/scripts/run.sh"]`
    - `WorkingDirectory` = `__PROJECT_DIR__`
    - `EnvironmentVariables` 内 `PATH` = `__USER_HOME__/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`(覆盖常见 uv 位置)
    - `StartCalendarInterval` = `{ Hour: 8, Minute: 30 }`
    - `RunAtLoad` 不显式设置(默认 false)
    - `StandardOutPath` = `__PROJECT_DIR__/logs/launchd_daily.out.log`
    - `StandardErrorPath` = `__PROJECT_DIR__/logs/launchd_daily.err.log`
- **验证**: `plutil -lint scripts/launchd/com.ascan.daily.plist.template` 报 "OK"(占位符不破坏 XML 合法性)

### Task 1.2: 新建安装脚本 [x]
- **文件**: `scripts/install_launchd.sh` (新增)
- **操作**:
  - `#!/usr/bin/env bash` + `set -euo pipefail`
  - 解析 `SCRIPT_DIR` → `PROJECT_DIR`(同 `run.sh` 风格)
  - 检查 `command -v uv` 存在,不存在则报错退出并提示安装命令
  - `sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__USER_HOME__|$HOME|g" scripts/launchd/com.ascan.daily.plist.template > "$HOME/Library/LaunchAgents/com.ascan.daily.plist"`
  - `launchctl bootout gui/$UID/com.ascan.daily 2>/dev/null || true`(清旧)
  - `launchctl bootstrap gui/$UID "$HOME/Library/LaunchAgents/com.ascan.daily.plist"`
  - `launchctl print gui/$UID/com.ascan.daily | head -40`(展示注册结果)
  - 末尾输出:"如需立即生成当日日报,请手动执行 ./scripts/run.sh"
  - `chmod +x scripts/install_launchd.sh`
- **验证**:
  - `./scripts/install_launchd.sh` 退出码 0
  - `launchctl list | grep com.ascan.daily` 能看到一行
  - `cat ~/Library/LaunchAgents/com.ascan.daily.plist` 内绝对路径已替换,无 `__PROJECT_DIR__` 残留

### Task 1.3: 新建卸载脚本 [x]
- **文件**: `scripts/uninstall_launchd.sh` (新增)
- **操作**:
  - `#!/usr/bin/env bash` + `set -euo pipefail`
  - `launchctl bootout gui/$UID/com.ascan.daily 2>/dev/null || true`
  - `rm -f "$HOME/Library/LaunchAgents/com.ascan.daily.plist"`
  - 输出:"已卸载 com.ascan.daily LaunchAgent"
  - `chmod +x scripts/uninstall_launchd.sh`
- **验证**:
  - `./scripts/uninstall_launchd.sh` 退出码 0
  - `launchctl list | grep com.ascan.daily` 无输出
  - `~/Library/LaunchAgents/com.ascan.daily.plist` 不存在

---

## Phase 2: `run.sh` 幂等保护

### Task 2.1: 追加当日已生成则跳过的判断 [x]
- **文件**: `scripts/run.sh` (修改)
- **操作**:
  - 在 `uv run python main_daily.py "$@"` 之前(即虚拟环境重建判断之后)插入:
    ```bash
    TODAY_REPORT="docs/Ascan-$(date +%Y%m%d).html"
    if [ $# -eq 0 ] && [ -f "$TODAY_REPORT" ]; then
      echo "[$(date '+%F %T')] [skip] today's report already exists: $TODAY_REPORT" >> "$LOG_FILE"
      exit 0
    fi
    ```
  - 不修改 `mkdir -p logs docs` / venv 重建逻辑,保持向后兼容
- **验证**:
  - 删除 `docs/Ascan-$(date +%Y%m%d).html`(若存在)→ `./scripts/run.sh` 正常跑完 pipeline,生成日报
  - 第二次 `./scripts/run.sh`(无参数)→ 日志末尾出现 `[skip] today's report already exists`,无 `uv run` 输出
  - `./scripts/run.sh --date 20260530` → 即使当日报告已存在也会执行 pipeline(`$# -eq 0` 不成立)

---

## Phase 3: 文档与历史文件 banner

### Task 3.1: 重写 README 定时任务段落 [x]
- **文件**: `README.md` (修改第 218-239 行附近的「定时任务设置」)
- **操作**:
  - 「macOS(推荐)」改为推荐 `./scripts/install_launchd.sh`,贴出:
    ```bash
    ./scripts/install_launchd.sh
    # 排障
    launchctl list | grep com.ascan.daily
    tail -f logs/launchd_daily.err.log
    # 卸载
    ./scripts/uninstall_launchd.sh
    ```
  - 显式说明:每天 08:30 触发;若机器休眠,唤醒后会补跑一次,但 `run.sh` 的幂等保护会在当日已生成日报时静默跳过。
  - 提示「迁移仓库目录后请重跑 install 脚本」
  - cron 段落保留为「不希望使用 launchd 的备选方案」,加一句「cron 在休眠期间不会补跑」
  - 把现存的 `0 9 * * *` 示例改为 `30 8 * * *`,与 launchd 触发时刻对齐
- **验证**: `grep -n "install_launchd" README.md` 至少 1 处命中,`grep -n "30 8 \* \* \*" README.md` 命中 1 处

### Task 3.2: 删除 Windows 历史调度工件 [x]
- **文件**: `scripts/arXiv-Agent-Daily.xml`、`scripts/setup_task_scheduler.ps1`、`scripts/run_windows.bat` (全部删除)
- **背景**: macOS launchd 落地后,Windows 调度路径无 owner 且含失效路径/域账户,统一收敛为单平台。
- **操作**:
  - `rm -f scripts/arXiv-Agent-Daily.xml scripts/setup_task_scheduler.ps1 scripts/run_windows.bat`
- **验证**: `ls scripts/` 输出中不包含上述任一文件。

### Task 3.3: .env.example 与 requirements.txt 同步清理 [x]
- **文件**: `.env.example`、`requirements.txt` (修改)
- **背景**: 前序已删除 `src/tools/call_vmsg.py`、`src/tools/call_km.py`,环境模板与依赖清单仍残留对应配置项与包。
- **操作**:
  - `.env.example`:删除 VMSG_*、KM_*、GITHUB_KM_*、FEISHU_* 配置项与 `bluecode-ai/minimax-m2-vivo` 注释。
  - `requirements.txt`:删除 `cryptography`(VMSG AES)、`playwright`(KM 浏览器自动化)、`markdown`(KM 发布) — 已用 `grep -rn` 确认 `src/` 与 main 入口零引用。
- **验证**:
  - `grep -ni "vmsg\|km_\|feishu\|vivo" .env.example` 无输出。
  - `grep -E "^(cryptography|playwright|markdown)" requirements.txt` 无输出。

---

## Phase 4: 端到端验证

### Task 4.1: 端到端冒烟
- **前提**: 已执行 Task 1.2(安装)与 Task 2.1(幂等)
- **操作**:
  - 备份并删除当日 `docs/Ascan-$(date +%Y%m%d).html`(如存在)
  - `launchctl kickstart -k gui/$UID/com.ascan.daily`(手动触发一次,模拟 8:30)
  - 等待 pipeline 完成(约 1-5 分钟,取决于 LLM 响应速度)
  - 检查 `docs/Ascan-$(date +%Y%m%d).html` 生成
  - 检查 `logs/launchd_daily.out.log` / `logs/launchd_daily.err.log` 无致命报错
- **验证**:
  - 日报文件存在且体积 > 10KB
  - `launchctl kickstart -k gui/$UID/com.ascan.daily` 再触发一次,`logs/ascan_daily_*.log` 出现 `[skip] today's report already exists`,`docs/` 下日报文件未被覆盖(mtime 未变)

### Task 4.2: 卸载冒烟
- **操作**: `./scripts/uninstall_launchd.sh`
- **验证**:
  - 退出码 0
  - `launchctl list | grep com.ascan.daily` 无输出
  - `~/Library/LaunchAgents/com.ascan.daily.plist` 不存在

---

## 完成判定

- 所有 Phase 1-3 文件已创建/修改并通过各自 Task 的验证步骤
- Phase 4 端到端冒烟两条用例均通过
- README 中「定时任务设置」段落只指向新脚本,不留旧 cron 9:00 示例
- `git status` 中新增/修改的文件清单与 proposal.md 「Impact」段一致
