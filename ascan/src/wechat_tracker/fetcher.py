"""WeChat public account article fetcher — uses we-mp-rss RSS endpoints."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Optional

import feedparser
import requests
import urllib3
from loguru import logger

from src.wechat_tracker.models import WeChatArticle

urllib3.disable_warnings()
UA = "ascan-wechat-tracker/1.0"
TIMEOUT = 30


def fetch_mp_articles(base_url: str, mp_id: str, mp_name: str = "",
                      limit: int = 20) -> list[WeChatArticle]:
    """Fetch articles from a single WeChat MP via we-mp-rss RSS endpoint."""
    url = f"{base_url.rstrip('/')}/feed/{mp_id}.xml?limit={limit}"
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT,
                            verify=False)
        if resp.status_code != 200:
            logger.warning(f"RSS {mp_id} HTTP {resp.status_code}")
            return []
        feed = feedparser.parse(resp.content)
        articles = []
        for entry in feed.entries:
            link = entry.get("link", "")
            title = entry.get("title", "").strip()
            if not title or not link:
                continue

            article_id = f"wx:{mp_id}:{link}"
            published = entry.get("published", "") or entry.get("updated", "")
            author = entry.get("author", "")
            summary = entry.get("summary", "")
            content = entry.get("content", [{}])[0].get("value", "") if entry.get("content") else ""

            articles.append(WeChatArticle(
                article_id=article_id,
                title=title,
                url=link,
                mp_id=mp_id,
                mp_name=mp_name or feed.feed.get("title", ""),
                publish_time=published,
                author=author,
                summary=summary,
                content=content,
            ))
        logger.info(f"RSS {mp_name or mp_id}: {len(articles)} articles")
        return articles
    except Exception as e:
        logger.warning(f"RSS {mp_id} error: {e}")
        return []


def fetch_all_mps(base_url: str, mp_list: list[dict],
                  limit: int = 20) -> list[WeChatArticle]:
    """Fetch articles from multiple MPs. mp_list: [{"id": "...", "name": "..."}]"""
    all_articles = []
    for mp in mp_list:
        mp_id = mp["id"]
        mp_name = mp.get("name", "")
        articles = fetch_mp_articles(base_url, mp_id, mp_name, limit=limit)
        all_articles.extend(articles)
        time.sleep(0.5)
    logger.info(f"Total WeChat articles fetched: {len(all_articles)} from {len(mp_list)} MPs")
    return all_articles
