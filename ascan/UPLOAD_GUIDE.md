# Ascan 报告上传工具

## 概述

`scripts/upload_dingtalk_direct.py` 直接通过 aone-km 的 **Streamable HTTP MCP 协议**(JSON-RPC)
调用 `createDingDocWorkspaceDoc`,将当日 MD 日报上传到钉钉知识库。

特点:
- **不依赖本地 AI**:不再嵌套启动 `claude -p`,适合无人值守的定时任务
- 纯 Python 标准库实现(urllib / json),无额外依赖
- 自动去除文档首行 H1 标题(钉钉会用文档名作为标题,避免重复显示)

## 用法

```bash
cd /Users/bingtao/Documents/ai.alibaba/ai-agent-ascan

python3 scripts/upload_dingtalk_direct.py            # 上传今天的报告
python3 scripts/upload_dingtalk_direct.py 20260611   # 上传指定日期的报告
```

报告文件路径约定为 `docs/Ascan-<YYYYMMDD>.md`,上传后的文档名为 `Ascan-<YYYYMMDD>`。

## 配置

默认值已内置在脚本中,可用环境变量覆盖:

| 环境变量 | 含义 | 默认值 |
| --- | --- | --- |
| `AONE_KM_MCP_URL` | aone-km MCP 端点 | `https://mcp.alibaba-inc.com/aone-km/mcp` |
| `AONE_KM_TOKEN` | MCP 鉴权 token (PRIVATE-TOKEN) | (内置) |
| `DING_WORKSPACE_ID` | 钉钉知识库工作空间 ID | `nb9XJjQZAoR2lXyA` |
| `DING_PARENT_NODE_ID` | 目标文件夹节点 ID(技术摘要持续更新) | `o14dA3GK8gQlkoYwcKYo6jPLV9ekBD76` |

## 自动化

`scripts/run.sh` 在日报生成成功后会自动调用本脚本上传(失败不阻塞主流程)。
定时任务通过 `scripts/install_launchd.sh` 安装,每天 08:30 触发 `run.sh`。

## 故障排除

上传失败时:
1. 确认 MCP token 有效、网络可达 `mcp.alibaba-inc.com`
2. 确认钉钉知识库授权有效
3. 确认工作空间 ID 与父节点 ID 正确
4. 确认 `docs/Ascan-<日期>.md` 文件存在且格式正确
