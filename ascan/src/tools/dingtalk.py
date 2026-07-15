"""钉钉知识库上传 — 供 Claude Code MCP 手动触发使用。

Python pipeline 无法直调 MCP 服务（超时），上传由 Claude Code 完成：
    读取 docs/Ascan-YYYYMMDD.md → 调用 mcp__aone-km__createDingDocWorkspaceDoc
"""

from __future__ import annotations

from pathlib import Path

from loguru import logger

from src.config.settings import get_settings


def get_latest_md_report() -> tuple[str, str] | None:
    """返回最新的 (title, content)，无文件时返回 None。"""
    settings = get_settings()
    output_dir = Path(settings.output_dir).expanduser().resolve()
    md_files = sorted(output_dir.glob("Ascan-*.md"), reverse=True)
    if not md_files:
        return None
    path = md_files[0]
    title = path.stem
    content = path.read_text(encoding="utf-8")
    return title, content
