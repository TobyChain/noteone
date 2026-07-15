# Ascan 自动技术摘要任务流程

## 概述

Ascan 项目每天自动生成技术摘要报告，并自动上传到钉钉知识库。此文档记录了完整的流程和配置。

## 自动任务流程

### 1. LaunchAgent 定时任务

- **配置文件**: `scripts/launchd/com.ascan.daily.plist.template`
- **安装脚本**: `scripts/install_launchd.sh`
- **运行频率**: 每天早上 8:30
- **工作目录**: 项目根目录
- **日志路径**: `logs/launchd_daily.{out,err}.log`

### 2. 主执行脚本

- **脚本位置**: `scripts/run.sh`
- **主要功能**:
  - 检查虚拟环境并安装依赖
  - 运行 `main_daily.py` 生成报告
  - 调用 `upload_dingtalk_direct.py` 上传到钉钉
  - 包含重试机制和幂等保护

### 3. 报告生成

- **主程序**: `main_daily.py`
- **生成内容**: 
  - arXiv 论文精选
  - GitHub 项目挖掘
  - 官方动态跟踪
  - 独立博客订阅

### 4. 自动上传

- **上传脚本**: `scripts/upload_dingtalk_direct.py`
- **上传方式**: 直连 aone-km MCP (Streamable HTTP / JSON-RPC) 调用 `createDingDocWorkspaceDoc`，不再嵌套本地 `claude -p`
- **上传目标**: 钉钉知识库
- **工作空间**: nb9XJjQZAoR2lXyA
- **目标文件夹**: 技术摘要（持续更新），节点 ID `o14dA3GK8gQlkoYwcKYo6jPLV9ekBD76`
- **特殊处理**: 自动去除H1标题（避免钉钉重复显示）

## 更新内容

### H1 标题处理

- **问题**: 钉钉知识库会自动使用文档名称作为标题，如果内容中也包含H1标题会造成重复显示
- **解决方案**: 上传脚本会去除文档首行 H1 标题（`# Ascan-...`）后再上传
- **效果**: 上传到钉钉的文档不会出现重复标题

## 手动操作

### 重新安装定时任务
```bash
cd /Users/bingtao/Documents/ai.alibaba/ai-agent-ascan
./scripts/install_launchd.sh
```

### 手动运行当天报告生成
```bash
cd /Users/bingtao/Documents/ai.alibaba/ai-agent-ascan
./scripts/run.sh
```

### 手动上传当天报告
```bash
cd /Users/bingtao/Documents/ai.alibaba/ai-agent-ascan
python3 scripts/upload_dingtalk_direct.py            # 今天
python3 scripts/upload_dingtalk_direct.py 20260611   # 指定日期
```

## 相关脚本

- `scripts/upload_dingtalk_direct.py`: 直连 aone-km MCP 的上传脚本
- `UPLOAD_GUIDE.md`: 详细使用指南

## 故障排除

1. **定时任务未运行**:
   - 检查 launchctl 状态: `launchctl list | grep com.ascan.daily`
   - 查看日志: `tail -f logs/launchd_daily.err.log`

2. **上传失败**:
   - 检查钉钉知识库授权
   - 确认网络连接
   - 检查工作空间和节点ID

3. **报告生成失败**:
   - 检查依赖安装: `uv pip install -r requirements.txt`
   - 查看详细日志: `logs/ascan_daily_YYYYMMDD.log`