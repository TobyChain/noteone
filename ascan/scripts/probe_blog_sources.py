#!/usr/bin/env python3
"""
博客源探测脚本 — 验证各数据源的抓取可行性
==========================================
对每个源执行：发现 → 增量对比 → 内容抓取 → 结果汇总

用法:
    python scripts/probe_blog_sources.py              # 全量探测
    python scripts/probe_blog_sources.py --source ruanyifeng  # 单个源
    python scripts/probe_blog_sources.py --days 3     # 查看最近3天更新
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from loguru import logger

# ── 常量 ──────────────────────────────────────────────────────────
CACHE_FILE = Path(__file__).parent.parent / "database" / "blog_probe_cache.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
TIMEOUT = 20
GITHUB_API = "https://api.github.com"

# ── 数据结构 ──────────────────────────────────────────────────────

@dataclass
class Article:
    """统一文章表示"""
    source: str           # 源标识
    slug: str             # 唯一标识
    url: str              # 文章链接
    title: str = ""       # 标题
    date: str = ""        # 发布日期 YYYY-MM-DD
    category: str = ""    # 分类
    summary: str = ""     # 摘要/首段
    content: str = ""     # 全文（截取前2000字）
    is_new: bool = False  # 是否为新发现


@dataclass
class ProbeResult:
    """单个源的探测结果"""
    source: str
    source_type: str      # official / independent
    discovery_method: str # rss / sitemap / github_api / scrape
    status: str           # ok / error
    total_articles: int = 0
    new_articles: int = 0
    articles: list[Article] = field(default_factory=list)
    error: str = ""
    elapsed_ms: int = 0


# ── 缓存管理 ──────────────────────────────────────────────────────

def load_cache() -> dict:
    """加载已知文章的缓存 {source: {slug: lastmod}}"""
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict):
    """保存缓存"""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def get_known_slugs(cache: dict, source: str) -> dict[str, str]:
    """获取某源的已知 {slug: lastmod}"""
    return cache.get(source, {})


# ── HTTP 工具 ─────────────────────────────────────────────────────

def fetch(url: str, headers: dict | None = None) -> requests.Response | None:
    """带重试的 HTTP GET"""
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=h, timeout=TIMEOUT, verify=False)
            if resp.status_code == 200:
                return resp
            logger.warning(f"  HTTP {resp.status_code} for {url}")
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            return resp
        except Exception as e:
            logger.warning(f"  请求失败 (attempt {attempt+1}): {e}")
            time.sleep(1)
    return None


# ── 源 1: 阮一峰周刊 (RSS) ──────────────────────────────────────

def probe_ruanyifeng(cache: dict, days: int) -> ProbeResult:
    """阮一峰科技爱好者周刊 — Atom RSS"""
    result = ProbeResult(
        source="ruanyifeng", source_type="independent",
        discovery_method="rss", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://www.ruanyifeng.com/blog/atom.xml")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"RSS 获取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(resp.text)
    entries = root.findall("atom:entry", ns)
    known = get_known_slugs(cache, "ruanyifeng")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    for entry in entries:
        title = entry.findtext("atom:title", "", ns).strip()
        link_el = entry.find("atom:link", ns)
        url = link_el.get("href", "") if link_el is not None else ""
        published = entry.findtext("atom:published", "", ns)[:10]  # YYYY-MM-DD
        slug = urlparse(url).path.rstrip("/").split("/")[-1] if url else title

        article = Article(
            source="ruanyifeng", slug=slug, url=url,
            title=title, date=published,
            summary=entry.findtext("atom:summary", "", ns)[:200],
        )

        # 增量检测
        is_recent = published >= cutoff.strftime("%Y-%m-%d")
        if slug not in known:
            article.is_new = True
            known[slug] = published
            # 仅对近期文章抓取全文，避免首次运行抓取所有历史
            if is_recent:
                _fetch_article_content(article)

        if is_recent:
            result.articles.append(article)

    result.total_articles = len(entries)
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["ruanyifeng"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


# ── 源 2: Sebastian Raschka (Substack RSS) ──────────────────────

def probe_sebastian(cache: dict, days: int) -> ProbeResult:
    """Ahead of AI — Substack RSS feed"""
    result = ProbeResult(
        source="sebastian_raschka", source_type="independent",
        discovery_method="rss", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://magazine.sebastianraschka.com/feed")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"RSS 获取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    root = ET.fromstring(resp.text)
    # Substack 使用标准 RSS 2.0
    items = root.findall(".//item")
    known = get_known_slugs(cache, "sebastian_raschka")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    for item in items:
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        pub_date_str = (item.findtext("pubDate") or "").strip()
        description = (item.findtext("description") or "")[:200]

        # 解析 RFC 2822 日期
        date_str = ""
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(pub_date_str)
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            pass

        slug = urlparse(url).path.rstrip("/").split("/")[-1] if url else title

        article = Article(
            source="sebastian_raschka", slug=slug, url=url,
            title=title, date=date_str, summary=description,
        )

        is_recent = (date_str >= cutoff.strftime("%Y-%m-%d")) if date_str else False

        if slug not in known:
            article.is_new = True
            known[slug] = date_str
            if is_recent:
                _fetch_article_content(article)

        if is_recent:
            result.articles.append(article)

    result.total_articles = len(items)
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["sebastian_raschka"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


# ── 源 3: Lilian Weng (Hugo RSS) ────────────────────────────────

def probe_lilianweng(cache: dict, days: int) -> ProbeResult:
    """Lil'Log — Hugo index.xml RSS"""
    result = ProbeResult(
        source="lilianweng", source_type="independent",
        discovery_method="rss", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://lilianweng.github.io/index.xml")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"RSS 获取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    root = ET.fromstring(resp.text)
    items = root.findall(".//item")
    known = get_known_slugs(cache, "lilianweng")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    for item in items:
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        pub_date_str = (item.findtext("pubDate") or "").strip()

        date_str = ""
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(pub_date_str)
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            pass

        slug = urlparse(url).path.rstrip("/").split("/")[-1] if url else title

        article = Article(
            source="lilianweng", slug=slug, url=url,
            title=title, date=date_str,
            summary=(item.findtext("description") or "")[:200],
        )

        is_recent = (date_str >= cutoff.strftime("%Y-%m-%d")) if date_str else False

        if slug not in known:
            article.is_new = True
            known[slug] = date_str
            if is_recent:
                _fetch_article_content(article)

        if is_recent:
            result.articles.append(article)

    result.total_articles = len(items)
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["lilianweng"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


def _get_github_token() -> Optional[str]:
    """从 .env 或 gh CLI 获取 GitHub token"""
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("GITHUB_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    # fallback: gh CLI
    try:
        import subprocess
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        pass
    return None


# ── 源 5: BentoML Blog (页面抓取) ────────────────────────────────

def probe_bentoml(cache: dict, days: int) -> ProbeResult:
    """BentoML Blog — 抓取博客列表页"""
    result = ProbeResult(
        source="bentoml", source_type="official",
        discovery_method="scrape", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://www.bentoml.com/blog")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"页面抓取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    soup = BeautifulSoup(resp.text, "html.parser")
    known = get_known_slugs(cache, "bentoml")

    # 查找所有文章链接 — BentoML 使用 Next.js，文章链接在 <a> 标签中
    links = soup.find_all("a", href=True)
    seen_slugs = set()

    for a in links:
        href = a.get("href", "")
        if "/blog/" in href and href != "/blog":
            slug = href.rstrip("/").split("/")[-1]
            if slug in seen_slugs or slug == "blog":
                continue
            seen_slugs.add(slug)

            full_url = href if href.startswith("http") else f"https://www.bentoml.com{href}"

            # 尝试从父元素获取标题和分类
            title = a.get_text(strip=True) or slug.replace("-", " ").title()
            # 查找分类标签（通常在标题上方）
            category = ""
            parent = a.parent
            if parent:
                cat_el = parent.find("span") or parent.find("p")
                if cat_el:
                    category = cat_el.get_text(strip=True)

            article = Article(
                source="bentoml", slug=slug, url=full_url,
                title=title[:100], category=category,
            )

            if slug not in known:
                article.is_new = True
                known[slug] = datetime.now().strftime("%Y-%m-%d")
                # BentoML 无日期，首次运行都算新文章，但限制抓取数量
                if len([a for a in result.articles if a.is_new]) <= 5:
                    _fetch_article_content(article)

            result.articles.append(article)

    result.total_articles = len(result.articles)
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["bentoml"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


# ── 源 6: OpenAI Research (Sitemap) ─────────────────────────────

def probe_openai(cache: dict, days: int) -> ProbeResult:
    """OpenAI Research — sitemap.xml/research/ 子站点地图"""
    result = ProbeResult(
        source="openai_research", source_type="official",
        discovery_method="sitemap", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://openai.com/sitemap.xml/research/")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"Sitemap 获取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    # 解析 sitemap XML
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    root = ET.fromstring(resp.text)
    urls = root.findall("sm:url", ns)
    known = get_known_slugs(cache, "openai_research")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    for url_el in urls:
        loc = url_el.findtext("sm:loc", "", ns)
        lastmod = url_el.findtext("sm:lastmod", "", ns)[:10]
        slug = loc.rstrip("/").split("/")[-1] if loc else ""

        if not slug:
            continue

        full_url = f"https://openai.com{loc}" if loc.startswith("/") else loc

        article = Article(
            source="openai_research", slug=slug, url=full_url,
            title=slug.replace("-", " ").title(), date=lastmod,
        )

        is_recent = lastmod >= cutoff.strftime("%Y-%m-%d")

        if slug not in known:
            article.is_new = True
            known[slug] = lastmod
            if is_recent:
                _fetch_article_content(article)

        if is_recent:
            result.articles.append(article)

    result.total_articles = len(urls)
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["openai_research"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


# ── 源 7: Anthropic Research (Sitemap) ──────────────────────────

def probe_anthropic(cache: dict, days: int) -> ProbeResult:
    """Anthropic Research — sitemap.xml 过滤 /research/ 路径"""
    result = ProbeResult(
        source="anthropic_research", source_type="official",
        discovery_method="sitemap", status="ok"
    )
    t0 = time.time()

    resp = fetch("https://www.anthropic.com/sitemap.xml")
    if not resp or resp.status_code != 200:
        result.status = "error"
        result.error = f"Sitemap 获取失败: HTTP {resp.status_code if resp else 'timeout'}"
        result.elapsed_ms = int((time.time() - t0) * 1000)
        return result

    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    root = ET.fromstring(resp.text)
    urls = root.findall("sm:url", ns)
    known = get_known_slugs(cache, "anthropic_research")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    for url_el in urls:
        loc = url_el.findtext("sm:loc", "", ns)
        lastmod = url_el.findtext("sm:lastmod", "", ns)[:10]

        # 只关注 /research/ 路径，排除团队页面和索引页
        if "/research/" not in loc:
            continue
        if loc.endswith("/research") or "/research/team/" in loc:
            continue

        slug = loc.rstrip("/").split("/")[-1] if loc else ""
        if not slug:
            continue

        full_url = loc if loc.startswith("http") else f"https://www.anthropic.com{loc}"

        article = Article(
            source="anthropic_research", slug=slug, url=full_url,
            title=slug.replace("-", " ").title(), date=lastmod,
        )

        if slug not in known:
            article.is_new = True
            known[slug] = lastmod
            _fetch_article_content(article)

        if lastmod >= cutoff.strftime("%Y-%m-%d"):
            result.articles.append(article)

    result.total_articles = len([u for u in urls if "/research/" in (u.findtext("sm:loc", "", ns))])
    result.new_articles = sum(1 for a in result.articles if a.is_new)
    cache["anthropic_research"] = known
    result.elapsed_ms = int((time.time() - t0) * 1000)
    return result


# ── 文章内容抓取 ──────────────────────────────────────────────────

def _fetch_article_content(article: Article):
    """抓取单篇文章的正文内容（首段 + 前2000字）"""
    resp = fetch(article.url)
    if not resp or resp.status_code != 200:
        return

    soup = BeautifulSoup(resp.text, "html.parser")

    # 移除 script/style
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # 尝试找主内容区域
    main = (
        soup.find("article")
        or soup.find("main")
        or soup.find("div", class_=lambda c: c and ("content" in c or "post" in c or "article" in c))
        or soup.find("body")
    )
    if not main:
        return

    # 提取标题
    if not article.title or article.title == article.slug.replace("-", " ").title():
        h1 = main.find("h1") or soup.find("h1")
        if h1:
            article.title = h1.get_text(strip=True)

    # 提取首段作为摘要
    if not article.summary:
        first_p = main.find("p")
        if first_p:
            article.summary = first_p.get_text(strip=True)[:300]

    # 提取全文（截取前2000字）
    text = main.get_text(separator="\n", strip=True)
    article.content = text[:2000]


# ── 报告输出 ──────────────────────────────────────────────────────

def print_report(results: list[ProbeResult]):
    """打印探测结果汇总"""
    print("\n" + "=" * 70)
    print(f"  博客源探测报告  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # 分组显示
    for group_name, group_type in [("官方动态跟踪", "official"), ("独立博客订阅", "independent")]:
        group_results = [r for r in results if r.source_type == group_type]
        if not group_results:
            continue

        print(f"\n  ── {group_name} {'─' * (56 - len(group_name))}")
        for r in group_results:
            status_icon = "✅" if r.status == "ok" else "❌"
            new_badge = f" | 🆕 {r.new_articles} 篇新文章" if r.new_articles > 0 else ""
            print(f"\n  {status_icon} {r.source:<25} [{r.discovery_method:<10}] "
                  f"共 {r.total_articles} 篇{new_badge}  ({r.elapsed_ms}ms)")

            if r.error:
                print(f"     ⚠️  {r.error}")

            # 显示近期/新文章
            display_articles = [a for a in r.articles if a.is_new or a.date]
            display_articles.sort(key=lambda a: a.date or "", reverse=True)
            for a in display_articles[:5]:
                new_marker = "🆕" if a.is_new else "  "
                date_str = a.date or "????"
                title_display = a.title[:50] + ("..." if len(a.title) > 50 else "")
                content_len = len(a.content) if a.content else 0
                print(f"     {new_marker} [{date_str}] {title_display}  "
                      f"({content_len} chars)")

    # 总结
    total = sum(r.total_articles for r in results)
    new = sum(r.new_articles for r in results)
    ok = sum(1 for r in results if r.status == "ok")
    print(f"\n{'=' * 70}")
    print(f"  总结: {ok}/{len(results)} 个源可用, "
          f"共 {total} 篇文章, 其中 {new} 篇新发现")
    print(f"  缓存文件: {CACHE_FILE}")
    print(f"{'=' * 70}\n")


# ── 入口 ──────────────────────────────────────────────────────────

SOURCES = {
    "ruanyifeng": ("independent", probe_ruanyifeng),
    "sebastian": ("independent", probe_sebastian),
    "lilianweng": ("independent", probe_lilianweng),
    # BentoML 被网络代理拦截，暂标记不可用
    # "bentoml": ("official", probe_bentoml),
    "openai": ("official", probe_openai),
    "anthropic": ("official", probe_anthropic),
}


def main():
    parser = argparse.ArgumentParser(description="博客源探测脚本")
    parser.add_argument("--source", "-s", choices=list(SOURCES.keys()),
                        help="只探测指定源")
    parser.add_argument("--days", "-d", type=int, default=7,
                        help="查看最近 N 天的更新 (默认 7)")
    parser.add_argument("--reset", action="store_true",
                        help="清除缓存后重新探测")
    args = parser.parse_args()

    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    if args.reset and CACHE_FILE.exists():
        CACHE_FILE.unlink()
        logger.info("已清除缓存")

    cache = load_cache()
    results = []

    if args.source:
        targets = {args.source: SOURCES[args.source]}
    else:
        targets = SOURCES

    for name, (_, probe_fn) in targets.items():
        logger.info(f"探测 {name}...")
        try:
            result = probe_fn(cache, args.days)
            results.append(result)
        except Exception as e:
            logger.error(f"探测 {name} 异常: {e}")
            results.append(ProbeResult(
                source=name, source_type="unknown",
                discovery_method="unknown", status="error",
                error=str(e),
            ))

    save_cache(cache)
    print_report(results)


if __name__ == "__main__":
    main()
