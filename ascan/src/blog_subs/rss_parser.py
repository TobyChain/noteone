"""Unified RSS/Atom feed parser for blog subscriptions."""
from __future__ import annotations

import time
from email.utils import parsedate_to_datetime
from typing import Optional

import feedparser
import requests
from loguru import logger

from src.blog_subs.models import BlogPost

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
TIMEOUT = 20

# Default sources — may be overridden via BLOG_RSS_SOURCES env/settings
_DEFAULT_RSS_SOURCES = [
    # ── 个人技术博客 ──
    {"name": "ruanyifeng", "url": "https://www.ruanyifeng.com/blog/atom.xml", "label": "阮一峰周刊"},
    {"name": "sebastian", "url": "https://magazine.sebastianraschka.com/feed", "label": "Sebastian Raschka"},
    {"name": "lilianweng", "url": "https://lilianweng.github.io/index.xml", "label": "Lilian Weng"},
    {"name": "huyenchip", "url": "https://huyenchip.com/feed.xml", "label": "Chip Huyen"},
    {"name": "simonw", "url": "https://simonwillison.net/atom/everything/", "label": "Simon Willison"},
    {"name": "eugeneyan", "url": "https://eugeneyan.com/rss/", "label": "Eugene Yan"},
    {"name": "karpathy", "url": "https://karpathy.github.io/feed.xml", "label": "Andrej Karpathy"},
    # ── 学术机构 ──
    {"name": "bair", "url": "https://bair.berkeley.edu/blog/feed.xml", "label": "BAIR (Berkeley AI)"},
    # ── AI 科技巨头 ──
    {"name": "openai", "url": "https://openai.com/news/rss.xml", "label": "OpenAI Blog"},
    {"name": "apple_ml", "url": "https://machinelearning.apple.com/rss.xml", "label": "Apple ML Research"},
    {"name": "huggingface", "url": "https://huggingface.co/blog/feed.xml", "label": "HuggingFace Blog"},
    # ── AI 基础设施与工程 ──
    {"name": "nvidia_tech", "url": "https://developer.nvidia.com/blog/feed", "label": "NVIDIA Tech Blog"},
    {"name": "nvidia", "url": "https://blogs.nvidia.com/feed/", "label": "NVIDIA Blog"},
    {"name": "aws_ml", "url": "https://aws.amazon.com/blogs/machine-learning/feed/", "label": "AWS ML Blog"},
    {"name": "github_eng", "url": "https://github.blog/engineering/feed/", "label": "GitHub Engineering"},
    # ── AI 日报通讯 ──
    {"name": "tldr_ai", "url": "https://tldr.tech/api/rss/ai", "label": "TLDR AI"},
    {"name": "import_ai", "url": "https://importai.substack.com/feed", "label": "Import AI"},
    {"name": "aws_china", "url": "https://aws.amazon.com/cn/blogs/china/feed/", "label": "AWS 中国博客"},
]


def _get_rss_sources() -> list[dict]:
    """Get RSS sources from settings if configured, otherwise use defaults."""
    try:
        from src.config.settings import get_settings
        settings = get_settings()
        sources = settings.blog_rss_sources
        if sources and len(sources) > 0 and isinstance(sources[0], dict):
            return sources
    except Exception:
        pass
    return _DEFAULT_RSS_SOURCES


def _parse_date(date_str: str) -> Optional[str]:
    """Parse various date formats to YYYY-MM-DD."""
    if not date_str:
        return None
    try:
        # Try ISO 8601 first
        if "T" in date_str:
            return date_str[:10]
        # RFC 2822 (used by RSS 2.0)
        dt = parsedate_to_datetime(date_str)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        # Fallback: just take first 10 chars
        return date_str[:10] if len(date_str) >= 10 else None


def fetch_rss_feed(url: str) -> list[dict]:
    """Fetch and parse an RSS/Atom feed using feedparser. Returns list of raw dicts."""
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT, verify=False)
    if resp.status_code != 200:
        logger.warning(f"RSS fetch failed: {url} (HTTP {resp.status_code})")
        return []

    feed = feedparser.parse(resp.content)
    if feed.bozo:
        logger.debug(f"Feed parser warning for {url}: {feed.bozo_exception}")

    items = []
    for entry in feed.entries:
        title = (entry.get("title") or "").strip()

        # Link: feedparser normalizes, but Atom feeds may have a list
        link = entry.get("link")
        if isinstance(link, list):
            link = link[0].get("href", "") if link else ""
        link = (link or "").strip()
        if not title or not link:
            continue

        # Date: try published, then updated
        date_str = entry.get("published") or entry.get("updated") or ""
        if "T" in date_str:
            published = date_str[:10]
        else:
            published = _parse_date(date_str)

        # Summary
        summary = (entry.get("summary") or entry.get("description") or "")[:300]

        items.append({
            "title": title,
            "url": link,
            "date": published,
            "summary": summary,
        })

    if not items:
        logger.warning(f"No entries found in RSS feed: {url}")
    return items


def fetch_all_feeds(max_per_source: int = 2) -> list[BlogPost]:
    """Fetch all configured RSS feeds and return unified BlogPost list."""
    sources = _get_rss_sources()
    all_posts = []

    for source in sources:
        logger.info(f"Fetching RSS: {source['label']} ({source['url']})")
        try:
            items = fetch_rss_feed(source["url"])
            for item in items[:max_per_source]:
                if not item.get("url") or not item.get("title"):
                    continue

                # Create unique slug from URL path
                from urllib.parse import urlparse
                path = urlparse(item["url"]).path.rstrip("/")
                slug_part = path.split("/")[-1] if path else item["title"]
                slug = f"{source['name']}:{slug_part}"

                post = BlogPost(
                    source=source["name"],
                    slug=slug,
                    url=item["url"],
                    title=item["title"],
                    date=item.get("date"),
                    source_label=source["label"],
                    summary=item.get("summary"),
                )
                all_posts.append(post)

            logger.info(f"  {source['label']}: {len(items)} posts found")
        except Exception as e:
            logger.warning(f"  {source['label']}: fetch failed: {e}")

        # Be polite between feeds
        if source != sources[-1]:
            time.sleep(0.5)

    logger.info(f"All RSS feeds: {len(all_posts)} total posts")
    return all_posts
