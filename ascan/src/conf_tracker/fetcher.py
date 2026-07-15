"""Conference paper fetcher — papers.cool (primary) + DBLP (fallback).

papers.cool: https://papers.cool/venue/{Name}.{Year}?show={count}
  - Rich fields: title, authors, keywords, abstract, PDF, type (Oral/Poster)
  - No API key needed, single HTTP request + lxml XPath parsing
  - May be blocked by corporate proxy (域名拦截)

DBLP: https://dblp.org/search/publ/api
  - Fields: title, authors, DOI, URL (no abstract, no keywords)
  - Queries current + previous year
"""
from __future__ import annotations

import hashlib
import time
from datetime import datetime, timedelta
from typing import Optional

import requests
import yaml
from loguru import logger

from src.conf_tracker.models import ConferencePaper

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
DBLP_BASE = "https://dblp.org/search/publ/api"
PAPERS_COOL_BASE = "https://papers.cool/venue"
TIMEOUT = 20


def load_ccf_conferences(yaml_path: str, rank_filter: list[str] | None = None,
                         category_filter: list[str] | None = None) -> list[dict]:
    """Load and filter conferences from CCF YAML mapping."""
    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    conferences = data.get("conferences", [])
    if rank_filter:
        conferences = [c for c in conferences if c["rank"] in rank_filter]
    if category_filter:
        conferences = [c for c in conferences if c["category"] in category_filter]
    return conferences


def _make_paper_key(doi: str | None, s2_id: str | None, title: str) -> str:
    if doi:
        return f"doi:{doi.lower()}"
    if s2_id:
        return f"s2:{s2_id}"
    return f"hash:{hashlib.md5(title.lower().strip().encode()).hexdigest()[:16]}"


# ── papers.cool ─────────────────────────────────────────────────────────────

def fetch_papers_cool(conf: dict, year: int | None = None,
                      max_papers: int = 500) -> list[ConferencePaper]:
    """Fetch papers from papers.cool venue page using lxml XPath."""
    if year is None:
        year = datetime.now().year
    venue_name = conf.get("papers_cool_venue", conf["name"])
    url = f"{PAPERS_COOL_BASE}/{venue_name}.{year}?show={max_papers}"

    try:
        from lxml import etree
    except ImportError:
        logger.warning("lxml not installed, skipping papers.cool")
        return []

    try:
        resp = requests.get(url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        }, timeout=TIMEOUT, verify=False)

        if resp.status_code != 200:
            logger.warning(f"papers.cool {conf['name']} {year}: HTTP {resp.status_code}")
            return []

        # Detect corporate proxy block (域名拦截 page is < 2KB)
        if len(resp.text) < 5000 and "域名拦截" in resp.text:
            logger.warning(f"papers.cool blocked by corporate proxy for {conf['name']}")
            return []

        root = etree.HTML(resp.text)
        container = root.xpath('//*[@class="papers"]')
        if not container:
            logger.info(f"papers.cool {conf['name']} {year}: no papers container found")
            return []

        children = container[0].getchildren()
        papers = []
        for child in children:
            title_els = child.xpath('.//h2[@class="title"]/a/text()')
            title = (title_els[0].strip() if title_els else "").strip()
            if not title:
                continue

            author_els = child.xpath('.//p[contains(@class,"metainfo") and contains(@class,"authors")]/a/text()')
            authors = [a.strip() for a in author_els if a.strip()]

            kw_els = child.xpath('./@keywords')
            keywords = kw_els[0] if kw_els else ""

            abs_els = child.xpath('.//p[contains(@class,"summary")]/text()')
            abstract = (abs_els[0].strip() if abs_els else "").strip()

            pdf_els = child.xpath('.//h2[@class="title"]/a[contains(@class,"title-pdf")]/@data')
            pdf_url = pdf_els[0] if pdf_els else None

            abs_link = child.xpath('.//h2[@class="title"]/a/@href')
            abs_url = abs_link[0] if abs_link else None

            type_els = child.xpath('.//p[contains(@class,"metainfo") and contains(@class,"subjects")]/a/text()')
            paper_type = (type_els[0].strip() if type_els else "").strip()

            doi = None
            if abs_url and "doi.org" in abs_url:
                doi = abs_url.split("doi.org/")[-1]

            paper_key = _make_paper_key(doi, None, title)

            papers.append(ConferencePaper(
                paper_key=paper_key,
                title=title,
                authors=authors,
                abstract=abstract or None,
                keywords=keywords,
                paper_type=paper_type,
                venue=conf["name"],
                venue_full_name=conf.get("full_name", ""),
                rank=conf["rank"],
                category=conf.get("category", ""),
                year=year,
                publication_date=f"{year}",
                doi=doi,
                url=abs_url,
                pdf_url=pdf_url,
                citation_count=0,
                tldr=None,
                source="papers_cool",
            ))

        logger.info(f"papers.cool {conf['name']} {year}: {len(papers)} papers found")
        return papers

    except Exception as e:
        logger.warning(f"papers.cool error for {conf['name']} {year}: {e}")
        return []


# ── DBLP ────────────────────────────────────────────────────────────────────

def fetch_dblp(conf: dict, year: int | None = None) -> list[ConferencePaper]:
    """Fetch papers from DBLP TOC (current + previous year)."""
    if year is None:
        year = datetime.now().year
    dblp_key = conf["dblp_key"]
    years_to_query = [year, year - 1]

    all_papers = []
    for y in years_to_query:
        params = {
            "q": f"toc:db/conf/{dblp_key}/{dblp_key}{y}.bht:",
            "format": "json",
            "h": 500,
        }
        try:
            resp = requests.get(DBLP_BASE, params=params, headers={"User-Agent": UA},
                                timeout=TIMEOUT, verify=False)
            if resp.status_code != 200:
                logger.warning(f"DBLP {conf['name']} {y}: HTTP {resp.status_code}")
                continue

            data = resp.json()
            hits = data.get("result", {}).get("hits", {}).get("hit", [])
            for hit in hits:
                info = hit.get("info", {})
                title = (info.get("title") or "").strip()
                if not title:
                    continue

                doi = info.get("doi")
                paper_key = _make_paper_key(doi, None, title)

                authors_raw = info.get("authors", {}).get("author", [])
                if isinstance(authors_raw, dict):
                    authors_raw = [authors_raw]
                authors = [a.get("text", a) if isinstance(a, dict) else str(a) for a in authors_raw]

                ee = info.get("ee")
                if isinstance(ee, list):
                    ee = ee[0] if ee else None

                all_papers.append(ConferencePaper(
                    paper_key=paper_key,
                    title=title,
                    authors=authors,
                    abstract=None,
                    keywords="",
                    paper_type="",
                    venue=conf["name"],
                    venue_full_name=conf.get("full_name", ""),
                    rank=conf["rank"],
                    category=conf.get("category", ""),
                    year=y,
                    publication_date=f"{y}",
                    doi=doi,
                    url=ee or (f"https://doi.org/{doi}" if doi else None),
                    pdf_url=None,
                    citation_count=0,
                    tldr=None,
                    source="dblp",
                ))
            logger.info(f"DBLP {conf['name']} {y}: {len(hits)} papers")
        except Exception as e:
            logger.warning(f"DBLP error for {conf['name']} {y}: {e}")

    logger.info(f"DBLP {conf['name']} total: {len(all_papers)} papers")
    return all_papers


# ── Merge + Orchestrate ────────────────────────────────────────────────────

def merge_sources(pc_papers: list[ConferencePaper],
                  dblp_papers: list[ConferencePaper]) -> list[ConferencePaper]:
    """Merge papers.cool + DBLP results. papers.cool preferred (has abstracts)."""
    seen: dict[str, ConferencePaper] = {}
    for p in pc_papers:
        seen[p.paper_key] = p
    for p in dblp_papers:
        if p.paper_key not in seen:
            seen[p.paper_key] = p
    logger.info(f"Merge: papers.cool={len(pc_papers)}, DBLP={len(dblp_papers)}, unique={len(seen)}")
    return list(seen.values())


def filter_by_topics(papers: list[ConferencePaper], topics: list[str]) -> list[ConferencePaper]:
    """Filter papers by keyword matching against title + abstract + keywords."""
    if not topics:
        return papers
    topics_lower = [t.lower() for t in topics]
    matched = []
    for p in papers:
        text = f"{p.title} {p.abstract or ''} {p.tldr or ''} {p.keywords}".lower()
        if any(t in text for t in topics_lower):
            matched.append(p)
    return matched


def fetch_all_conferences(conferences: list[dict], settings) -> list[ConferencePaper]:
    """Fetch papers from all conferences using papers.cool (primary) + DBLP (fallback)."""
    max_per_venue = getattr(settings, "conference_max_papers_per_venue", 50)
    topics = getattr(settings, "conference_topics", [])
    current_year = datetime.now().year

    all_pc: list[ConferencePaper] = []
    all_dblp: list[ConferencePaper] = []

    # Phase 1: papers.cool (primary, rich data) — current year only
    for conf in conferences:
        pc_papers = fetch_papers_cool(conf, year=current_year, max_papers=max_per_venue * 10)
        all_pc.extend(pc_papers)
        time.sleep(0.3)

    # Phase 2: DBLP (fallback, for conferences not covered by papers.cool)
    pc_venues = {p.venue for p in all_pc}
    for i, conf in enumerate(conferences):
        if conf["name"] in pc_venues and all_pc:
            continue  # already have papers.cool data
        dblp_papers = fetch_dblp(conf, year=current_year)
        all_dblp.extend(dblp_papers)
        if i < len(conferences) - 1:
            time.sleep(0.5)

    merged = merge_sources(all_pc, all_dblp)
    filtered = filter_by_topics(merged, topics)
    logger.info(f"Conference papers: {len(merged)} total → {len(filtered)} after topic filter")

    max_total = getattr(settings, "conference_max_total", 100)
    return filtered[:max_total]
