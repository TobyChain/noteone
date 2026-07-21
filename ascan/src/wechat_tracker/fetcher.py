"""WeChat public account article fetcher — calls the NoteOne server's built-in
WeChat MP service.

Server exposes:
  GET /api/wechat/mp/articles?id=<fakeid>&begin=<n>&size=<n>
    Requires header: X-Auth-Key: <auth key from QR login>
    Returns the WeChat appmsgpublish response with triple-nested JSON strings:
      resp.publish_page  (stringified JSON)
        .publish_list[i].publish_info  (stringified JSON)
          .appmsgex[j]  (article metadata: title/author/link/publish_time/...)
"""
from __future__ import annotations

import json
import time
from typing import Optional

import requests
from loguru import logger

from src.wechat_tracker.models import WeChatArticle

UA = "ascan-wechat-tracker/3.0"
TIMEOUT = 30


def _parse_appmsgpublish(resp_json: dict) -> list[dict]:
    """Extract the appmsgex[] list from the triple-nested response.

    Top-level: { base_resp: {ret, ...}, publish_page: "<json string>" }
    publish_page parsed: { total_count, publish_list: [{publish_info: "<json string>"}] }
    publish_info parsed: { appmsgex: [{title, author, link, ...}] }
    """
    base_resp = resp_json.get("base_resp") or {}
    ret = base_resp.get("ret")
    if ret != 0:
        err_msg = base_resp.get("err_msg") or f"ret={ret}"
        logger.warning(f"wechat appmsgpublish non-zero ret: {err_msg}")
        return []

    publish_page_raw = resp_json.get("publish_page")
    if not publish_page_raw:
        logger.warning("wechat appmsgpublish: empty publish_page")
        return []
    try:
        publish_page = json.loads(publish_page_raw) if isinstance(publish_page_raw, str) else publish_page_raw
    except json.JSONDecodeError as e:
        logger.warning(f"wechat publish_page JSON parse failed: {e}")
        return []

    publish_list = publish_page.get("publish_list") or []
    articles: list[dict] = []
    for item in publish_list:
        info_raw = item.get("publish_info")
        if not info_raw:
            continue
        try:
            info = json.loads(info_raw) if isinstance(info_raw, str) else info_raw
        except json.JSONDecodeError:
            continue
        appmsgex = info.get("appmsgex") or []
        for a in appmsgex:
            if isinstance(a, dict):
                articles.append(a)
    return articles


def _appmsg_to_article(
    a: dict,
    fakeid: str,
    mp_name: str,
    min_publish_ts: float = 0.0,
) -> Optional[WeChatArticle]:
    """Map AppMsgEx fields to WeChatArticle. Return None if article is older
    than min_publish_ts (unix seconds) or missing title/link."""
    link = a.get("link") or ""
    title = (a.get("title") or "").strip()
    if not title or not link:
        return None
    article_id = f"wx:{fakeid}:{link}"
    publish_time = ""
    publish_ts = 0.0
    pt = a.get("publish_time") or a.get("create_time")
    if pt:
        try:
            publish_ts = float(pt)
            publish_time = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime(int(pt)))
        except (TypeError, ValueError):
            publish_time = str(pt)
    # Date filter: skip articles older than the cutoff (0 = no filter)
    if min_publish_ts > 0 and publish_ts > 0 and publish_ts < min_publish_ts:
        return None
    summary = a.get("digest") or a.get("summary") or ""
    cover = a.get("cover_img") or a.get("cover") or ""
    author = a.get("author") or ""
    return WeChatArticle(
        article_id=article_id,
        title=title,
        url=link,
        mp_id=fakeid,
        mp_name=mp_name,
        publish_time=publish_time,
        author=author,
        summary=summary,
        content="",  # full body not provided by appmsgpublish; left empty for now
        cover_url=cover,
    )


def fetch_mp_articles(
    service_url: str,
    auth_key: str,
    fakeid: str,
    mp_name: str = "",
    limit: int = 20,
    days_recent: int = 30,
) -> list[WeChatArticle]:
    """Fetch articles for a single MP via the server's /api/wechat/mp/articles.
    Skip articles older than days_recent days (0 = no filter)."""
    if not service_url or not auth_key or not fakeid:
        logger.warning(
            f"wechat fetch skipped: service_url={bool(service_url)} auth_key={bool(auth_key)} fakeid={bool(fakeid)}"
        )
        return []

    base = service_url.rstrip("/")
    min_publish_ts = (time.time() - days_recent * 86400) if days_recent > 0 else 0.0
    collected: list[WeChatArticle] = []
    begin = 0
    page_size = min(limit, 20)
    seen_ids: set[str] = set()
    skipped_old = 0

    while begin < limit:
        size = min(page_size, limit - begin)
        url = f"{base}/api/wechat/mp/articles?id={fakeid}&begin={begin}&size={size}&keyword="
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": UA, "X-Auth-Key": auth_key},
                timeout=TIMEOUT,
            )
            if resp.status_code != 200:
                logger.warning(f"wechat {mp_name or fakeid} HTTP {resp.status_code} at begin={begin}")
                break
            data = resp.json()
            base_resp = data.get("base_resp") or {}
            if base_resp.get("ret") == 200003:
                logger.warning("wechat auth-key expired (ret=200003) — please re-scan in Settings")
                break
            articles_raw = _parse_appmsgpublish(data)
            if not articles_raw:
                break
            new_count = 0
            for a in articles_raw:
                art = _appmsg_to_article(a, fakeid, mp_name, min_publish_ts=min_publish_ts)
                if art is None:
                    # Could be missing title/link OR too old — count for logging
                    if a.get("title") and a.get("link"):
                        skipped_old += 1
                    continue
                if art.article_id not in seen_ids:
                    collected.append(art)
                    seen_ids.add(art.article_id)
                    new_count += 1
            if new_count == 0:
                break  # all duplicates or all filtered, stop
            begin += len(articles_raw)
            time.sleep(0.4)
        except Exception as e:
            logger.warning(f"wechat {mp_name or fakeid} begin={begin} error: {e}")
            break

    logger.info(
        f"wechat {mp_name or fakeid}: {len(collected)} articles (limit={limit}, days_recent={days_recent}, skipped_old≈{skipped_old})"
    )
    return collected


def fetch_all_mps(
    service_url: str,
    auth_key: str,
    mp_list: list[dict],
    limit: int = 20,
    days_recent: int = 30,
) -> list[WeChatArticle]:
    """Fetch articles from multiple MPs. mp_list: [{"id": "<fakeid>", "name": "..."}]"""
    all_articles: list[WeChatArticle] = []
    for mp in mp_list:
        fakeid = mp.get("id") or ""
        mp_name = mp.get("name") or ""
        if not fakeid:
            continue
        articles = fetch_mp_articles(
            service_url, auth_key, fakeid, mp_name,
            limit=limit, days_recent=days_recent,
        )
        all_articles.extend(articles)
        time.sleep(0.5)
    logger.info(f"Total WeChat articles fetched: {len(all_articles)} from {len(mp_list)} MPs")
    return all_articles
