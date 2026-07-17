#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime
from html import escape
from pathlib import Path

HOME_BUTTON_MARKER = "ascan-home-button"
DEFAULT_FRONT_MATTER = """---
layout: page
title: Ascan
icon: fas fa-robot
order: 5
---
"""
DEFAULT_TAB_BODY = """
## 科技前沿日报

Ascan 自动汇总 arXiv 论文精选、GitHub 项目挖掘、官方动态、独立博客和会议论文追踪。
""".lstrip()
LATEST_HEADING = "### 最新报告"
ARCHIVE_HEADING = "### 归档"
ARCHIVE_ROW_PATTERN = re.compile(r"^\|\s*20\d{2}-\d{2}-\d{2}\s*\|")
LATEST_REPORT_PATTERN = re.compile(
    r"^\s*-\s+\[Ascan-\d{8}\]\(/ascan/reports/Ascan-\d{8}\.html\).*"
)


def inject_home_button(html: str, home_url: str) -> str:
    if HOME_BUTTON_MARKER in html:
        return html

    safe_home_url = escape(home_url, quote=True)
    button = f'''
<a class="{HOME_BUTTON_MARKER}" href="{safe_home_url}" style="position:fixed;top:16px;left:16px;z-index:9999;display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border-radius:999px;background:#ffffff;border:1px solid #e5e3df;color:#37352f;text-decoration:none;font:14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 24px rgba(15,15,15,.10);">← 返回主页</a>
'''

    if "<body" not in html.lower():
        return button + html

    lower = html.lower()
    body_start = lower.find("<body")
    body_open_end = html.find(">", body_start)
    if body_open_end == -1:
        return button + html
    return html[: body_open_end + 1] + button + html[body_open_end + 1 :]


def publish_report(date_compact: str, ascan_repo: Path, pages_repo: Path, home_url: str) -> Path:
    source = ascan_repo / "docs" / f"Ascan-{date_compact}.html"
    if not source.is_file():
        raise FileNotFoundError(f"Missing Ascan report: {source}")

    target_dir = pages_repo / "ascan" / "reports"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name

    html = source.read_text(encoding="utf-8")
    target.write_text(inject_home_button(html, home_url), encoding="utf-8")
    return target


def split_front_matter(content: str) -> tuple[str, str]:
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return DEFAULT_FRONT_MATTER, content

    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "".join(lines[: index + 1]), "".join(lines[index + 1 :])

    return DEFAULT_FRONT_MATTER, content


def find_heading(lines: list[str], heading: str, start: int = 0) -> int | None:
    for index in range(start, len(lines)):
        if lines[index].strip() == heading:
            return index
    return None


def find_next_peer_heading(lines: list[str], start: int) -> int:
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("### "):
            return index
    return len(lines)


def upsert_latest_section(body: str, date_compact: str, report_url: str) -> str:
    lines = body.splitlines()
    latest_line = f'- [Ascan-{date_compact}]({report_url}){{:target="_blank"}}'
    latest_index = find_heading(lines, LATEST_HEADING)

    if latest_index is None:
        section = [LATEST_HEADING, "", latest_line, ""]
        archive_index = find_heading(lines, ARCHIVE_HEADING)
        if archive_index is None:
            return "\n".join(lines + ([""] if lines and lines[-1] else []) + section) + "\n"
        return "\n".join(lines[:archive_index] + section + lines[archive_index:]) + "\n"

    section_end = find_next_peer_heading(lines, latest_index)
    preserved_section_lines = [
        line
        for line in lines[latest_index + 1 : section_end]
        if not LATEST_REPORT_PATTERN.match(line)
    ]
    while preserved_section_lines and not preserved_section_lines[0].strip():
        preserved_section_lines.pop(0)

    replacement = [LATEST_HEADING, "", latest_line]
    if preserved_section_lines:
        replacement.extend([""] + preserved_section_lines)
    if section_end < len(lines) and replacement[-1].strip():
        replacement.append("")

    return "\n".join(lines[:latest_index] + replacement + lines[section_end:]) + "\n"


def upsert_archive_section(body: str, new_row: str, report_url: str) -> str:
    lines = body.splitlines()
    existing_rows = [
        line
        for line in lines
        if ARCHIVE_ROW_PATTERN.match(line) and report_url not in line
    ]
    replacement = [
        ARCHIVE_HEADING,
        "",
        "| 日期 | 报告 |",
        "| --- | --- |",
        new_row,
        *existing_rows,
    ]

    archive_index = find_heading(lines, ARCHIVE_HEADING)
    if archive_index is None:
        spacer = [""] if lines and lines[-1].strip() else []
        return "\n".join(lines + spacer + replacement) + "\n"

    archive_end = find_next_peer_heading(lines, archive_index)
    if archive_end < len(lines) and replacement[-1].strip():
        replacement.append("")

    return "\n".join(lines[:archive_index] + replacement + lines[archive_end:]) + "\n"


def update_ascan_index(date_compact: str, pages_repo: Path) -> None:
    year = date_compact[:4]
    month = date_compact[4:6]
    day = date_compact[6:8]
    report_name = f"Ascan-{date_compact}.html"
    report_url = f"/ascan/reports/{report_name}"

    tab_path = pages_repo / "_tabs" / "ascan.md"
    tab_path.parent.mkdir(parents=True, exist_ok=True)
    if tab_path.is_file():
        front_matter, body = split_front_matter(tab_path.read_text(encoding="utf-8"))
    else:
        front_matter, body = DEFAULT_FRONT_MATTER, DEFAULT_TAB_BODY

    body = upsert_latest_section(body, date_compact, report_url)
    new_row = f"| {year}-{month}-{day} | [HTML]({report_url}){{:target=\"_blank\"}} |"
    body = upsert_archive_section(body, new_row, report_url)
    tab_path.write_text(f"{front_matter.rstrip()}\n\n{body.lstrip()}", encoding="utf-8")

    index_path = pages_repo / "ascan" / "index.html"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url={report_url}">
  <title>Ascan 最新日报</title>
</head>
<body>
  <p>正在跳转到 <a href="{report_url}">Ascan 最新日报</a>。</p>
</body>
</html>
''', encoding="utf-8")


def git_commit_and_push(pages_repo: Path, date_compact: str) -> None:
    report_path = f"ascan/reports/Ascan-{date_compact}.html"
    subprocess.run(
        ["git", "add", report_path, "ascan/index.html", "_tabs/ascan.md"],
        cwd=pages_repo,
        check=True,
    )
    status = subprocess.check_output(["git", "status", "--short"], cwd=pages_repo, text=True)
    if not status.strip():
        return
    subprocess.run(["git", "commit", "-m", f"Publish Ascan {date_compact}"], cwd=pages_repo, check=True)
    subprocess.run(["git", "push", "origin", "main"], cwd=pages_repo, check=True)


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish Ascan HTML report to GitHub Pages")
    parser.add_argument("date", nargs="?", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--config", default="config.local.json")
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    ascan_repo = Path(config["ascan_repo"]).expanduser().resolve()
    pages_repo = Path(config["pages_repo"]).expanduser().resolve()
    home_url = config.get("site_home_url", "https://tobychain.github.io/")

    output = publish_report(args.date, ascan_repo, pages_repo, home_url)
    update_ascan_index(args.date, pages_repo)
    print(f"Published {output}")

    if not args.no_push:
        git_commit_and_push(pages_repo, args.date)


if __name__ == "__main__":
    main()
