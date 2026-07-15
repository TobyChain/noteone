# Design: Daily Scheduler (macOS launchd)

## Context

`main_daily.py` 当前依赖人工触发 `scripts/run.sh`。仓库已有的 Windows 计划任务 XML 不适用 macOS,且 README 给出的 `crontab` 示例在笔记本休眠场景下会静默漏跑。本设计要解决两个核心约束:

1. **休眠 / lid-closed 时段的 missed run 必须能补跑**——这是 cron 做不到、launchd 能做到的关键差异。
2. **补跑必须幂等**——避免同一天产出多份 `Ascan-YYYYMMDD.html`、覆盖前次产物或下游消费方误判。

设计范围仅限「定时调度 + 入口脚本幂等」,不动 pipeline / 配置 / 数据库。

## Decision 1: 用 launchd (StartCalendarInterval) 而非 cron

**选择**:macOS `LaunchAgent`,`StartCalendarInterval` 设 `Hour=8 Minute=30`,部署到 `~/Library/LaunchAgents/com.ascan.daily.plist`(用户域,不需 sudo)。

**为什么**:
- `StartCalendarInterval` 在「触发时刻系统不可用(休眠/关机)」时,会在系统下一次唤醒/启动后**尽快执行一次**,这正是「每天 8:30 出日报」的语义,而 cron 在 8:30 时机器没醒就直接错过。
- 用户域 LaunchAgent 跟用户会话同生命周期,无需 sudo,卸载干净。
- README 自身已经推荐过 launchd:「也可以用 launchd 调度,命令指向同一个 scripts/run.sh 即可。」本次把这句话落到产物上。

**为什么不**:
- **不用 cron**:休眠期间漏跑无法补,且 macOS 14+ 用户的 cron 还需要被授予「完全磁盘访问权限」才能写 `docs/`,对新用户不友好。
- **不双产物(同时 launchd + cron)**:两个调度器并行触发,容易绕过幂等竞争(两者同秒级触发,文件存在判断未必准),增加复杂度无收益。
- **不用 Python `schedule`/`APScheduler` 长驻进程**:需要单独的守护进程、登录自启,跟「macOS 原生、停机即停」的预期不符;`src/core/scheduler.py` 已经存在但需要用户自己 `--scheduler` 开着不关,实际不会有人这么干。

## Decision 2: plist 用模板 + 占位符,安装脚本生成最终文件

**选择**:仓库内只提交 `scripts/launchd/com.ascan.daily.plist.template`,里面的项目路径写成字面量 `__PROJECT_DIR__`。`install_launchd.sh` 用 `sed "s|__PROJECT_DIR__|$PROJECT_DIR|g"` 生成最终 plist 写到 `~/Library/LaunchAgents/`。

**为什么**:
- plist 要求路径是绝对值,不支持 `$HOME` 展开;不同用户的仓库克隆位置不同,直接 commit 绝对路径必然要改。
- 模板 + 安装脚本的组合让产物可被 git diff 跟踪、且每个用户首次安装一次即可,后续无需手动同步路径。
- `__PROJECT_DIR__` 这种「明显占位符」比 `{{PROJECT_DIR}}` 之类 Jinja 风格更安全——`sed` 替换不会撞 plist 里的 `{}`/XML 实体。

**为什么不**:
- 不用 `envsubst`:macOS 默认不带,需要额外依赖。
- 不在 `install_launchd.sh` 里手写整个 plist 字符串:plist 后续若加 `EnvironmentVariables`、`Nice` 等字段,模板文件比 shell heredoc 易读易维护。

## Decision 3: 幂等保护放在 `run.sh`,不放在 `main_daily.py`

**选择**:在 `scripts/run.sh` 里、`uv run python main_daily.py "$@"` 之前判断:

```bash
TODAY_REPORT="docs/Ascan-$(date +%Y%m%d).html"
if [ $# -eq 0 ] && [ -f "$TODAY_REPORT" ]; then
  echo "[$(date '+%F %T')] [skip] today's report already exists: $TODAY_REPORT" >> "$LOG_FILE"
  exit 0
fi
```

幂等键 = 「当日报告文件已存在 + 用户没传任何参数」。

**为什么**:
- launchd 在唤醒后**只补跑一次**(`StartCalendarInterval` 的语义),所以幂等只需要解决「8:30 已经跑过 + 之后又被人手动执行 / 或同日二次唤醒触发」这类边缘情况,文件存在判断足够。
- 放在 shell 入口,可以**绕过 pipeline 启动开销**(`uv run` + import 一堆模块大约 1-2s),也避免让 `main_daily.py` 关心调度上下文。
- 用「文件存在」做幂等键,语义直观、可由用户通过 `rm docs/Ascan-YYYYMMDD.html` 强制重跑;不需要额外的 lock 文件/状态目录。
- `$# -eq 0` 的判断很关键:当用户显式 `./scripts/run.sh --date 20260530` 或 `--force`(未来扩展)时,必须能照常跑,不被幂等卡住。

**为什么不**:
- **不用 `flock` / lock 文件**:lock 是防并发,这里是防同日重跑,语义不同;且 lock 文件残留会导致下次永久跳过,运维负担大。
- **不在 `main_daily.py` 内部判断**:Python 启动成本已经付了,收益小;而且 `main.py`/`main_github.py` 单独执行时不该被这个判断卡住——幂等只属于「定时调度 + 默认运行」这一场景,刚好对应 `run.sh` 无参数调用。
- **不用「跑过了就 touch 一个 sentinel」**:产出的日报 HTML 本身就是天然 sentinel,不引入新文件。

## Decision 4: 不开 `RunAtLoad`、不加 `StartInterval` 兜底

**选择**:plist 只设 `StartCalendarInterval`,`RunAtLoad` 不设(默认 false),不再额外配 `StartInterval`。

**为什么**:
- `RunAtLoad=true` 会让每次 `launchctl bootstrap` / 登录都立刻跑一次 pipeline,跟「8:30 出日报」的语义冲突,且首装时会立即烧一次 LLM 配额。
- 不加 `StartInterval` 是因为 `StartCalendarInterval` 在唤醒后自带补跑能力,再叠 `StartInterval` 反而会让一天跑多次(虽然有幂等保护,但日志会变脏,排障变难)。
- 日志路径设为 `logs/launchd_daily.{out,err}.log`,跟 `run.sh` 已经按天滚动的 `logs/ascan_daily_YYYYMMDD.log` 区分:launchd 日志记录的是「调度器调用情况」,pipeline 日志记录「业务执行情况」,排障时各看各的。

## Decision 5: 删除 Windows 历史调度工件

**选择**:删除 `scripts/arXiv-Agent-Daily.xml`、`scripts/setup_task_scheduler.ps1`、`scripts/run_windows.bat`。

**为什么**:
- 这些文件里写死了开发者本机的 Windows 绝对路径与域账户,迁移到任何新机器都直接失效;实际无人维护。
- macOS launchd 调度落地后,项目正式收敛为单平台。保留双调度路径意味着未来需要同步维护两条,但 Windows 一侧无验证、无 owner,属于纯负担。
- 同时清理了 `.env.example` 中只服务于已删除模块的 KM/V 消息相关配置项与 `requirements.txt` 中的 `cryptography`/`playwright`/`markdown` 死依赖,使「环境模板 + 依赖清单 + 实际代码」三者一致。

## Risks & Open Questions

- **风险 1**:用户把仓库目录从 `~/Documents/ai.alibaba/ai-agent-ascan` 移动到别处后,旧 plist 里的绝对路径会失效。
  - **缓解**:`install_launchd.sh` 是幂等的,移动后重跑一次即可重建 plist。在 README 中显式说明此操作。
- **风险 2**:`uv` 不在 launchd 的默认 PATH 中(launchd 启动的子进程 PATH 很短,通常只有 `/usr/bin:/bin:/usr/sbin:/sbin`)。
  - **缓解**:plist 里加 `<key>EnvironmentVariables</key>` 设置 `PATH=$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,覆盖常见的 uv 安装位置;`install_launchd.sh` 在生成 plist 时检测 `command -v uv` 拿到实际路径并在日志中提示。
- **风险 3**:首次安装时已经过了当天 8:30,用户期望「装完立刻先出一次今天的日报」,但 `RunAtLoad=false` 不会立即跑。
  - **缓解**:`install_launchd.sh` 在最后输出一句提示:「如需立即生成当日日报,请手动执行 `./scripts/run.sh`」,把决定权交给用户,避免静默烧配额。
- **Open Question**:是否需要在 `run.sh` 增加 `--force` flag 显式跳过幂等?当前设计只通过「传任意参数」隐式跳过,语义不直观。**暂不实现**,等真有用例再加;现在 `./scripts/run.sh --date $(date +%Y%m%d)` 也能强制重跑,够用。

## Out of Scope

- Linux 端的 systemd unit / cron(项目当前明确只在 macOS 部署)。
- 日报生成失败的告警通道(失败时本身就有 `logs/ascan_daily_*.log`,主动告警另起 change)。
- 多用户/多机器集中调度(当前是单机本地工具)。
- 改造 `src/core/scheduler.py` (Python 内置调度器):本次明确不依赖它。
