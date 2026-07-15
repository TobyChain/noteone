## Why

`main_daily.py` 已经能稳定产出 `docs/Ascan-YYYYMMDD.html` 统一日报,但目前**没有任何 macOS 端自动调度产物**:

- 仓库里只有遗留的 Windows 计划任务 (`scripts/arXiv-Agent-Daily.xml`、`scripts/setup_task_scheduler.ps1`),`scripts/run.sh` 必须人工触发。
- `README.md` 「定时任务设置」一段只给出了 `crontab -e` 的示例文本,并未真正写入用户的 crontab,实际上长期处于「靠人工记忆每天跑一次」的状态。
- 出差/休假/笔记本休眠时一旦漏跑,当日 `Ascan-YYYYMMDD.html` 就会断档,无法补回(因为 ArXiv API 只返回当日窗口,过期需用 `--date` 显式回补)。
- 即便有 cron,Mac 在 8:30 时常处于休眠或 lid-closed,cron 不会补跑;而 launchd 的 `StartCalendarInterval` 会在唤醒后立即补跑,语义更符合「每天 8:30 出一份日报」的诉求。

需要一份开箱即用、可重复部署、可被 git 追踪的 macOS 原生定时调度产物,实现「每天上午 8:30 自动出日报,休眠唤醒后能补跑且不会重复」。

## What Changes

### 新增 launchd 调度产物

- 新增 `scripts/launchd/com.ascan.daily.plist.template`:LaunchAgent 配置模板,使用 `StartCalendarInterval` (Hour=8, Minute=30) 每天 08:30 触发,`RunAtLoad=false`、`StandardOutPath`/`StandardErrorPath` 指向 `logs/launchd_daily.{out,err}.log`,`WorkingDirectory` 与 `ProgramArguments` 中的项目路径写为 `__PROJECT_DIR__` 占位符,由安装脚本替换为绝对路径。
- 模板内不固化用户路径,plist 实际产物写入 `~/Library/LaunchAgents/com.ascan.daily.plist`(用户域,不需要 sudo)。

### 新增一键安装/卸载脚本

- 新增 `scripts/install_launchd.sh`:
  - 读取 `scripts/launchd/com.ascan.daily.plist.template`,把 `__PROJECT_DIR__` 替换为脚本所在仓库的绝对路径,生成最终 plist 到 `~/Library/LaunchAgents/com.ascan.daily.plist`。
  - 调用 `launchctl bootout gui/$UID/com.ascan.daily 2>/dev/null || true` 先清理旧实例,再 `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.ascan.daily.plist`。
  - 用 `launchctl print gui/$UID/com.ascan.daily` 打印一次状态,便于核对。
- 新增 `scripts/uninstall_launchd.sh`:`launchctl bootout` + 删除 `~/Library/LaunchAgents/com.ascan.daily.plist`,无残留。
- 两个脚本均加 `chmod +x`,顶部加 `set -euo pipefail`。

### `scripts/run.sh` 加幂等保护

- 在 `uv run python main_daily.py "$@"` 之前判断 `docs/Ascan-$(date +%Y%m%d).html` 是否已存在:
  - 若存在且未传 `--force`/`--date` 参数,则记录一条 `[skip] today's report already exists` 到日志后直接 `exit 0`,避免 launchd 在唤醒后补跑重复生成日报。
  - 若用户显式传了 `--date YYYYMMDD` 或自定义参数(`$#` > 0),则跳过幂等检查,按用户意图执行。

### README 同步更新

- 重写 `README.md` 「定时任务设置 → macOS(推荐)」段落:
  - 推荐使用 `./scripts/install_launchd.sh` 完成安装,贴出 `launchctl list | grep com.ascan.daily` 与 `tail -f logs/launchd_daily.err.log` 两条排障命令。
  - 保留 cron 示例作为「不希望使用 launchd」时的替代方案,但提示 cron 在休眠期间不会补跑。
  - 显式说明:launchd 在 08:30 触发;若休眠唤醒后才触发,会执行一次,但 `run.sh` 的幂等保护会在当日已生成日报时静默跳过。

### 删除 Windows 历史调度工件

- 删除 `scripts/arXiv-Agent-Daily.xml`、`scripts/setup_task_scheduler.ps1`、`scripts/run_windows.bat`。
- 这些文件均为早期 Windows 部署遗留,内容含已失效的绝对路径与域账户;macOS launchd 调度落地后无人维护。统一收敛到 macOS 单平台支持,降低后续误用风险。

## Capabilities

### Added Capabilities

- `scheduling`:首次为项目引入「macOS 端原生定时调度」能力,声明每天 08:30 自动产出当日 `Ascan-YYYYMMDD.html` 日报,休眠唤醒后自动补跑,且对同日重复触发幂等。

### Modified Capabilities

- `daily-pipeline` (`main_daily.py` + `scripts/run.sh`):入口脚本新增幂等行为——当日报已存在且未显式指定参数时,跳过 pipeline。`main_daily.py` 自身不改动。

### Removed Capabilities

- `windows-scheduling`:Windows 计划任务调度路径被完整移除,项目收敛为 macOS 单平台。

## Impact

- **新增文件**:`scripts/launchd/com.ascan.daily.plist.template`、`scripts/install_launchd.sh`、`scripts/uninstall_launchd.sh`。
- **修改文件**:`scripts/run.sh`(追加幂等检查 + unset VIRTUAL_ENV/PYTHONHOME/PYTHONPATH + 改用 `.venv/bin/python` 直调)、`README.md`(重写定时任务段落)。
- **删除文件**:`scripts/arXiv-Agent-Daily.xml`、`scripts/setup_task_scheduler.ps1`、`scripts/run_windows.bat`。
- **运行时行为**:首次执行 `./scripts/install_launchd.sh` 后,本机每天 08:30 自动跑 `main_daily.py`;休眠唤醒会补跑一次但当日不会重复出日报。卸载只需 `./scripts/uninstall_launchd.sh`。
- **不影响**:`main_daily.py`/`main.py`/`main_github.py` 的 CLI 参数、pipeline 阶段、SQLite schema、Streamlit Web UI 均保持不变。
- **依赖兼容**:不引入新的 Python 依赖;`launchctl` 为 macOS 系统自带。
- **回滚成本**:执行 `./scripts/uninstall_launchd.sh` 即可完全回滚;`run.sh` 的幂等检查可通过删除当日 `docs/Ascan-*.html` 重新触发。
