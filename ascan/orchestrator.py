"""
Ascan Orchestrator — module registry + unified runner.

Replaces the copy-pasted boilerplate in main_daily.py and the per-module
main_*.py entry files with a single registry-driven runner. Modules can be
run individually (fragments persisted to logs/fragments/{date}/) and merged
independently, so 闹闹 can orchestrate them one at a time.

No lock files — orchestration is coordinated by the caller (闹闹 / run_all).

Usage (via main_daily.py thin CLI):
    python main_daily.py --module arxiv --date 20260717
    python main_daily.py --merge --date 20260717
    python main_daily.py                 # run_all (today, concurrent)
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Awaitable, Callable

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from loguru import logger

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.pipeline.core import PipelineContext

# module -> (display name, html field on PipelineContext, md field)
MODULE_FIELDS: dict[str, tuple[str, str, str]] = {
    "arxiv":      ("arXiv 论文精选",   "arxiv_html",      "arxiv_md"),
    "github":     ("GitHub 项目挖掘",  "github_html",     "github_md"),
    "official":   ("官方动态跟踪",     "official_html",   "official_md"),
    "blog":       ("独立博客订阅",     "blog_html",       "blog_md"),
    "conference": ("会议论文追踪",     "conference_html", "conference_md"),
    "wechat":     ("微信公众号",       "wechat_html",     "wechat_md"),
}

FRAGMENT_DIR = Path("logs/fragments")


def _arxiv_data_date(date_compact: str) -> str:
    """arXiv publishes at 22:00 Beijing; fetch the previous day, falling back
    over weekends (Sat/Sun → Friday)."""
    from src.config.settings import get_settings
    settings = get_settings()
    dt = datetime.strptime(date_compact, "%Y%m%d") - timedelta(days=settings.arxiv_date_offset_days)
    w = dt.weekday()
    if w == 5:  # Saturday → Friday
        dt -= timedelta(days=1)
    elif w == 6:  # Sunday → Friday
        dt -= timedelta(days=2)
    return dt.strftime("%Y-%m-%d")


# ── Module runners (lazy imports so a broken module doesn't crash the whole orchestrator) ──

async def _run_arxiv(date_compact: str) -> PipelineContext:
    from main import run_multi_dimension_pipeline
    return await run_multi_dimension_pipeline(date=_arxiv_data_date(date_compact))

async def _run_github(date_compact: str) -> PipelineContext:
    from main_github import run_daily
    return await run_daily(date_compact=date_compact)

async def _run_official(date_compact: str) -> PipelineContext:
    from main_official import run_daily
    return await run_daily(date_compact=date_compact)

async def _run_blog(date_compact: str) -> PipelineContext:
    from main_blog import run_daily
    return await run_daily(date_compact=date_compact)

async def _run_conference(date_compact: str) -> PipelineContext:
    from main_conf import run_daily
    return await run_daily(date_compact=date_compact)

async def _run_wechat(date_compact: str) -> PipelineContext:
    from main_wechat import run_daily
    return await run_daily(date_compact=date_compact)


MODULE_REGISTRY: dict[str, Callable[[str], Awaitable[PipelineContext]]] = {
    "arxiv": _run_arxiv,
    "github": _run_github,
    "official": _run_official,
    "blog": _run_blog,
    "conference": _run_conference,
    "wechat": _run_wechat,
}


def module_names() -> list[str]:
    return list(MODULE_REGISTRY.keys())


# ── Fragment persistence ───────────────────────────────────────────────

def _fragment_paths(date_compact: str, module: str) -> tuple[Path, Path]:
    base = FRAGMENT_DIR / date_compact
    return base / f"{module}.html", base / f"{module}.md"


def _persist_fragment(date_compact: str, module: str, ctx: PipelineContext) -> int:
    _, html_field, md_field = MODULE_FIELDS[module]
    html = getattr(ctx, html_field, None) or ""
    md = getattr(ctx, md_field, None) or ""
    html_path, md_path = _fragment_paths(date_compact, module)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html, encoding="utf-8")
    md_path.write_text(md, encoding="utf-8")
    return len(html)


def _load_fragment(date_compact: str, module: str) -> tuple[str, str]:
    html_path, md_path = _fragment_paths(date_compact, module)
    html = html_path.read_text(encoding="utf-8") if html_path.exists() else ""
    md = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    return html, md


# ── Public API ─────────────────────────────────────────────────────────

async def run_module(name: str, date_compact: str) -> dict:
    """Run a single module, persist its fragment, return a JSON-serializable result."""
    if name not in MODULE_REGISTRY:
        return {"module": name, "ok": False, "chars": 0, "error": f"unknown module: {name}"}
    logger.info(f"[{name}] run_module start (date={date_compact})")
    try:
        ctx = await MODULE_REGISTRY[name](date_compact)
        chars = _persist_fragment(date_compact, name, ctx)
        err = ctx.error_message or ""
        ok = not err
        logger.info(f"[{name}] run_module done ok={ok} chars={chars}")
        return {"module": name, "ok": ok, "chars": chars, "error": err}
    except Exception as e:
        logger.exception(f"[{name}] run_module exception: {e}")
        return {"module": name, "ok": False, "chars": 0, "error": str(e)}


async def merge_report(date_compact: str) -> dict:
    """Read persisted fragments for date_compact, build unified HTML+MD, write to docs/."""
    from src.tools.unified_report import build_unified_html
    from src.tools.report_md import build_unified_md
    from src.config.settings import get_settings

    settings = get_settings()
    fragments = {m: _load_fragment(date_compact, m) for m in MODULE_REGISTRY}
    arxiv_html, arxiv_md = fragments["arxiv"]
    github_html, github_md = fragments["github"]
    official_html, official_md = fragments["official"]
    blog_html, blog_md = fragments["blog"]
    conference_html, conference_md = fragments["conference"]
    wechat_html, wechat_md = fragments["wechat"]

    unified_html = build_unified_html(
        date_compact, arxiv_html, github_html, official_html, blog_html, conference_html, wechat_html,
    )
    unified_md = build_unified_md(
        date_compact, arxiv_md, github_md, official_md, blog_md, conference_md, wechat_md,
    )

    output_dir = Path(settings.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    html_path = output_dir / f"Ascan-{date_compact}.html"
    md_path = output_dir / f"Ascan-{date_compact}.md"
    html_path.write_text(unified_html, encoding="utf-8")
    md_path.write_text(unified_md, encoding="utf-8")
    logger.success(f"[merge] report written: {html_path} (md: {md_path})")
    return {"ok": True, "date": date_compact, "html_path": str(html_path), "md_path": str(md_path)}


async def run_all(date_compact: str, modules: list[str] | None = None) -> dict:
    """Run all (or a subset of) modules concurrently, then merge. No lock —
    concurrency across modules is safe (each writes its own fragment file)."""
    mods = modules or list(MODULE_REGISTRY.keys())
    logger.info(f"[run_all] modules={mods} date={date_compact} (concurrent)")
    results = await asyncio.gather(*[run_module(m, date_compact) for m in mods])
    merge = await merge_report(date_compact)
    return {"date": date_compact, "modules": results, "merge": merge}


def today_compact() -> str:
    return datetime.now().strftime("%Y%m%d")
