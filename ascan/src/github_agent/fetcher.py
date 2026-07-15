"""
GitHub data fetcher: Trending page scrape + Search API + README fetch.
"""
from __future__ import annotations

import re
import time
from typing import Optional
import requests
from bs4 import BeautifulSoup
from loguru import logger

from src.github_agent.models import RepoInfo


TRENDING_URL = "https://github.com/trending"
API_BASE = "https://api.github.com"
HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

# AI/Agent 相关关键词，用于从 Trending 中过滤
AI_KEYWORDS = {
    "agent", "llm", "gpt", "ai", "rag", "mcp", "langchain", "autogen",
    "copilot", "assistant", "chatbot", "reasoning", "prompt", "embedding",
    "vector", "inference", "fine-tune", "finetune", "multimodal", "vision",
    "openai", "anthropic", "gemini", "claude", "mistral", "ollama",
    "memory", "tool", "workflow", "pipeline", "orchestrat",
}


class GitHubFetcher:
    """Fetches repos from GitHub Trending and Search API."""

    def __init__(self, token: Optional[str] = None):
        self.headers = dict(HEADERS_BASE)
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    # ── Trending ─────────────────────────────────────────────────────────────

    def fetch_trending(self, language: str = "", since: str = "daily") -> list[RepoInfo]:
        """
        Scrape github.com/trending for AI-adjacent repos.
        since: "daily" | "weekly" | "monthly"
        Returns up to 25 RepoInfo objects (GitHub shows 25 per page).
        """
        url = f"{TRENDING_URL}?since={since}"
        if language:
            url += f"&l={language}"
        try:
            resp = self.session.get(url, timeout=20)
            resp.raise_for_status()
        except Exception as e:
            logger.warning(f"Trending fetch failed: {e}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        repos: list[RepoInfo] = []
        for article in soup.select("article.Box-row"):
            try:
                # full_name
                h2 = article.select_one("h2 a")
                if not h2:
                    continue
                full_name = h2["href"].strip("/")   # "owner/repo"
                parts = full_name.split("/")
                if len(parts) != 2:
                    continue
                owner, name = parts

                # description
                p = article.select_one("p")
                description = p.get_text(strip=True) if p else None

                # language
                lang_span = article.select_one("[itemprop=programmingLanguage]")
                language_val = lang_span.get_text(strip=True) if lang_span else None

                # stars total — try multiple selectors
                stars = 0
                for selector in ["a[href$='/stargazers']", "a.Link--muted"]:
                    star_link = article.select_one(selector)
                    if star_link:
                        text = star_link.get_text(strip=True).replace(",", "").replace("k", "000")
                        try:
                            stars = int(re.sub(r"[^\d]", "", text))
                            break
                        except ValueError:
                            pass

                # stars today
                stars_today = None
                for span in article.select("span"):
                    text = span.get_text(strip=True)
                    m = re.search(r"([\d,]+)\s+stars\s+today", text, re.IGNORECASE)
                    if m:
                        stars_today = int(m.group(1).replace(",", ""))
                        break

                repos.append(RepoInfo(
                    full_name=full_name,
                    owner=owner,
                    name=name,
                    description=description,
                    stars=stars,
                    stars_today=stars_today,
                    language=language_val,
                    url=f"https://github.com/{full_name}",
                ))
            except Exception as e:
                logger.debug(f"Skipping trending article: {e}")
                continue

        logger.info(f"Trending ({since}): scraped {len(repos)} repos")
        return repos

    def fetch_trending_ai(self, since: str = "daily") -> list[RepoInfo]:
        """
        Fetch trending repos and keep only AI/Agent related ones.
        Filters by description/name keyword matching.
        """
        all_repos = self.fetch_trending(since=since)
        filtered = []
        for repo in all_repos:
            text = f"{repo.name} {repo.description or ''}".lower()
            if any(kw in text for kw in AI_KEYWORDS):
                filtered.append(repo)
        logger.info(f"Trending AI filter: {len(all_repos)} → {len(filtered)} repos")
        return filtered

    # ── Search API ───────────────────────────────────────────────────────────

    def search_by_topic(
        self,
        topic: str,
        min_stars: int = 500,
        max_results: int = 10,
        sort: str = "updated",
        page: int = 1,
    ) -> list[RepoInfo]:
        """
        Search repos by GitHub topic label.
        sort: "stars" | "updated" | "help-wanted-issues"
        page: 1-based page number for pagination
        """
        query = f"topic:{topic} stars:>={min_stars}"
        params = {
            "q": query,
            "sort": sort,
            "order": "desc",
            "per_page": min(max_results, 30),
            "page": page,
        }
        try:
            resp = self.session.get(
                f"{API_BASE}/search/repositories",
                params=params,
                timeout=20,
            )
            if resp.status_code == 403:
                logger.warning(f"GitHub API rate limited for topic={topic}")
                return []
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Search topic={topic} failed: {e}")
            return []

        repos = [self._item_to_repo(item) for item in data.get("items", [])]
        # Respect rate limit: Search API = 30 req/min authenticated
        time.sleep(2)
        return repos

    def search_by_topic_skip_known(
        self,
        topic: str,
        skip_names: set[str],
        min_stars: int = 500,
        want: int = 10,
        sort: str = "updated",
        max_pages: int = 5,
    ) -> list[RepoInfo]:
        """
        Search by topic, skipping repos whose full_name is in skip_names.
        Keeps fetching additional pages until `want` fresh repos are collected
        or max_pages is exhausted.
        """
        results: list[RepoInfo] = []
        for page in range(1, max_pages + 1):
            batch = self.search_by_topic(
                topic=topic,
                min_stars=min_stars,
                max_results=30,
                sort=sort,
                page=page,
            )
            if not batch:
                break
            fresh = [r for r in batch if r.full_name not in skip_names]
            results.extend(fresh)
            if len(results) >= want:
                break
            # If the whole page was known repos and there might be more, keep going
            if len(batch) < 30:
                # Last page reached
                break
        return results[:want]

    # ── README + file tree ───────────────────────────────────────────────────

    def fetch_readme(self, full_name: str, max_chars: int = 3000) -> Optional[str]:
        """Return first max_chars of decoded README, or None."""
        try:
            resp = self.session.get(
                f"{API_BASE}/repos/{full_name}/readme",
                headers={**self.headers, "Accept": "application/vnd.github.raw"},
                timeout=20,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text[:max_chars]
        except Exception as e:
            logger.debug(f"README fetch failed for {full_name}: {e}")
            return None

    def fetch_top_files(self, full_name: str) -> list[str]:
        """Return list of top-level source file/dir paths from the default branch."""
        try:
            resp = self.session.get(
                f"{API_BASE}/repos/{full_name}/contents",
                timeout=15,
            )
            if resp.status_code != 200:
                return []
            items = resp.json()
            if not isinstance(items, list):
                return []
            names = [item["name"] for item in items[:30] if item.get("type") in ("file", "dir")]
            return names[:20]
        except Exception as e:
            logger.debug(f"File tree fetch failed for {full_name}: {e}")
            return []

    def enrich_repo(self, repo: RepoInfo) -> RepoInfo:
        """Fetch README + top files and attach to RepoInfo."""
        repo.readme_summary = self.fetch_readme(repo.full_name)
        repo.top_files = self.fetch_top_files(repo.full_name)
        time.sleep(0.5)   # avoid secondary rate limit
        return repo

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _item_to_repo(self, item: dict) -> RepoInfo:
        return RepoInfo(
            full_name=item["full_name"],
            owner=item["owner"]["login"],
            name=item["name"],
            description=item.get("description"),
            stars=item.get("stargazers_count", 0),
            forks=item.get("forks_count", 0),
            language=item.get("language"),
            topics=item.get("topics", []),
            url=item["html_url"],
            homepage=item.get("homepage"),
            pushed_at=item.get("pushed_at"),
            created_at=item.get("created_at"),
        )

    def deduplicate(self, repos: list[RepoInfo]) -> list[RepoInfo]:
        """Remove duplicates by full_name, keep highest-stars copy."""
        seen: dict[str, RepoInfo] = {}
        for r in repos:
            if r.full_name not in seen or r.stars > seen[r.full_name].stars:
                seen[r.full_name] = r
        return list(seen.values())

    def filter_ai_relevant(self, repos: list[RepoInfo], min_stars: int = 500) -> list[RepoInfo]:
        """Keep repos with min_stars."""
        return [r for r in repos if r.stars >= min_stars]
