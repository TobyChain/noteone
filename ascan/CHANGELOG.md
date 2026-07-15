# Changelog

## 2026-06-02

### Added
- macOS launchd 定时调度：`install_launchd.sh` / `uninstall_launchd.sh`，每工作日 08:30 自动出报
- `run.sh` 周末跳过逻辑（arXiv 周末不发布）
- `run.sh` 幂等保护（当日日报已存在则跳过）
- `run.sh` 环境隔离（unset VIRTUAL_ENV/PYTHONHOME/PYTHONPATH）
- LLM 并发调用：`Semaphore(15)` + `ThreadPoolExecutor(15)`，arXiv 论文和 GitHub 仓库分析均已并行化

### Changed
- `run.sh` 改为直接调用 `.venv/bin/python`，不再依赖 `uv run` 环境探测
- `BuildGithubFragmentStage`（原 `PublishGithubReportStage`）重命名，stage name 改为 `building_fragment`
- `.env.example` 重写，与 `settings.py` 一一对齐，去掉行内注释
- `README.md` 全面重写

### Removed
- V 消息推送模块 `src/tools/call_vmsg.py` 及所有关联配置
- KM 知识平台模块 `src/tools/call_km.py` 及 cookie 刷新脚本
- 飞书推送相关配置与 `enable_feishu_push` 字段
- Windows 调度工件（`arXiv-Agent-Daily.xml` / `setup_task_scheduler.ps1` / `run_windows.bat`）
- `output/` 临时注入文件、`scripts/archive/` 旧脚本、`scripts/dev/` 开发脚本
- `docs/plans/` / `docs/guides/` 过时文档
- `requirements.txt` 中 `cryptography` / `playwright` / `markdown` 死依赖
- `main_github.py` 的 `--dry-run` 参数（KM 已删，该参数无实际作用）
- `main_daily.py` 的 `dry_run` 函数签名参数（通知已删，仅保留 CLI `--dry-run` 控制 lock 逻辑）
