"""Fetcher for official sources: Anthropic sitemap, OpenAI sitemap."""
from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from loguru import logger

from src.official_tracker.models import OfficialItem

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
TIMEOUT = 20
RETRY_DELAYS = [5, 10]


class OfficialFetcher:
    """Fetch articles from official sources."""

    def __init__(self, github_token: Optional[str] = None):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA})
        self.session.verify = False
        self.github_token = github_token

    def _get_with_retry(self, url: str, label: str) -> requests.Response:
        """GET with retry on connection errors."""
        last_error = None
        for attempt, delay in enumerate([0] + RETRY_DELAYS):
            if delay:
                logger.warning(f"{label} 重试 (第{attempt}次, {delay}s)...")
                time.sleep(delay)
            try:
                resp = self.session.get(url, timeout=TIMEOUT)
                resp.raise_for_status()
                return resp
            except Exception as e:
                last_error = e
                if attempt < len(RETRY_DELAYS):
                    continue
        raise last_error  # type: ignore

    # ── Anthropic Research ────────────────────────────────────────────

    def fetch_anthropic_sitemap(
        self, sitemap_url: str = "https://www.anthropic.com/sitemap.xml",
    ) -> list[dict]:
        """Parse Anthropic sitemap, filter /research/ URLs, return [{slug, url, lastmod}]."""
        resp = self._get_with_retry(sitemap_url, "Anthropic")

        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        root = ET.fromstring(resp.text)
        items = []
        for url_el in root.findall("sm:url", ns):
            loc = url_el.findtext("sm:loc", "", ns)
            lastmod = url_el.findtext("sm:lastmod", "", ns)[:10]

            # Only /research/ articles, exclude listing page and team pages
            if "/research/" not in loc:
                continue
            if loc.rstrip("/").endswith("/research") or "/research/team/" in loc:
                continue

            slug = loc.rstrip("/").split("/")[-1] if loc else ""
            if not slug:
                continue

            full_url = loc if loc.startswith("http") else f"https://www.anthropic.com{loc}"
            items.append({"slug": f"anthropic:{slug}", "url": full_url, "lastmod": lastmod})

        logger.info(f"Anthropic sitemap: {len(items)} research articles found")
        return items

    # ── OpenAI Research ───────────────────────────────────────────────

    def fetch_openai_sitemap(
        self, sitemap_url: str = "https://openai.com/sitemap.xml/research/",
    ) -> list[dict]:
        """Parse OpenAI research sitemap, return [{slug, url, lastmod}]."""
        resp = self._get_with_retry(sitemap_url, "OpenAI")

        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        root = ET.fromstring(resp.text)
        items = []
        for url_el in root.findall("sm:url", ns):
            loc = url_el.findtext("sm:loc", "", ns)
            lastmod = url_el.findtext("sm:lastmod", "", ns)[:10]

            slug = loc.rstrip("/").split("/")[-1] if loc else ""
            if not slug:
                continue

            full_url = f"https://openai.com{loc}" if loc.startswith("/") else loc
            items.append({"slug": f"openai:{slug}", "url": full_url, "lastmod": lastmod})

        logger.info(f"OpenAI sitemap: {len(items)} research articles found")
        return items

    # ── Google DeepMind Blog ──────────────────────────────────────────

    def fetch_deepmind_sitemap(
        self, sitemap_url: str = "https://deepmind.google/sitemap.xml",
    ) -> list[dict]:
        """Parse DeepMind sitemap, filter /blog/ URLs, return [{slug, url, lastmod}]."""
        resp = self._get_with_retry(sitemap_url, "DeepMind")

        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        root = ET.fromstring(resp.text)
        items = []
        for url_el in root.findall("sm:url", ns):
            loc = url_el.findtext("sm:loc", "", ns)
            lastmod = url_el.findtext("sm:lastmod", "", ns)[:10]

            if "/blog/" not in loc:
                continue

            slug = loc.rstrip("/").split("/")[-1] if loc else ""
            if not slug or slug == "blog":
                continue

            full_url = loc if loc.startswith("http") else f"https://deepmind.google{loc}"
            items.append({"slug": f"deepmind:{slug}", "url": full_url, "lastmod": lastmod})

        logger.info(f"DeepMind sitemap: {len(items)} blog articles found")
        return items

    # ── Article Content Scraping ──────────────────────────────────────

    def scrape_article_content(self, url: str) -> dict:
        """Fetch and parse a single article page. Returns {title, date, category, summary, content}."""
        resp = self.session.get(url, timeout=TIMEOUT)
        if resp.status_code != 200:
            logger.warning(f"Failed to fetch {url}: HTTP {resp.status_code}")
            return {}

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove noise
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        # Find main content area
        main = (
            soup.find("article")
            or soup.find("main")
            or soup.find("div", class_=lambda c: c and ("content" in c or "post" in c or "article" in c))
        )
        if not main:
            main = soup.find("body")

        if not main:
            return {}

        result = {}

        # Title
        h1 = main.find("h1") or soup.find("h1")
        if h1:
            result["title"] = h1.get_text(strip=True)

        # First paragraph as summary
        first_p = main.find("p")
        if first_p:
            result["summary"] = first_p.get_text(strip=True)[:300]

        # Full content (first 2000 chars)
        text = main.get_text(separator="\n", strip=True)
        result["content"] = text[:2000]

        return result

    def scrape_articles_batch(self, items: list[OfficialItem], delay: float = 1.0) -> list[OfficialItem]:
        """Scrape content for multiple articles with delay between requests."""
        results = []
        for i, item in enumerate(items):
            if item.item_type == "commit":
                # Commits don't have a web page to scrape
                results.append(item)
                continue

            try:
                content = self.scrape_article_content(item.url)
                if content:
                    updated = item.model_copy(update={
                        "title": content.get("title") or item.title,
                        "summary": content.get("summary") or item.summary,
                        "content": content.get("content"),
                    })
                    results.append(updated)
                    logger.debug(f"[{i+1}/{len(items)}] Scraped {item.slug}")
                else:
                    results.append(item)
            except Exception as e:
                logger.warning(f"Scrape failed for {item.url}: {e}")
                results.append(item)

            if i < len(items) - 1 and delay > 0:
                time.sleep(delay)

        return results
