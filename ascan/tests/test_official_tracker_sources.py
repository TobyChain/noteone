import asyncio

from src.official_tracker.stages import FetchOfficialStage
from src.pipeline.core import PipelineContext


class _Repo:
    def get_all_known_slugs(self):
        return {}

    def upsert_batch(self, items, today):
        return []

    def get_all_analyzed_slugs(self):
        return set()


class _Fetcher:
    openai_called = False

    def __init__(self, github_token=None):
        pass

    def fetch_anthropic_sitemap(self, sitemap_url):
        return []

    def fetch_openai_sitemap(self, sitemap_url):
        type(self).openai_called = True
        return [{
            "slug": "openai:should-not-be-fetched",
            "url": "https://openai.com/index/should-not-be-fetched/",
            "lastmod": "2026-07-10",
        }]

    def fetch_deepmind_sitemap(self):
        return []


class _Settings:
    github_token = None
    anthropic_sitemap_url = "https://anthropic.example/sitemap.xml"
    openai_research_sitemap_url = "https://openai.example/sitemap.xml"
    official_max_per_source = 3


def test_fetch_official_stage_does_not_fetch_openai(monkeypatch):
    import src.official_tracker.stages as stages

    _Fetcher.openai_called = False
    monkeypatch.setattr(stages, "get_settings", lambda: _Settings())
    monkeypatch.setattr(stages, "OfficialFetcher", _Fetcher)
    monkeypatch.setattr(stages, "get_db_session", lambda: object())
    monkeypatch.setattr(stages, "OfficialItemRepository", lambda db: _Repo())

    context = PipelineContext(date="2026-07-10", subjects=[])

    assert asyncio.run(FetchOfficialStage().execute(context))
    assert _Fetcher.openai_called is False
    assert all(item.source != "openai" for item in context.official_items)
