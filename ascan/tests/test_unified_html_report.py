from src.github_agent.models import RepoAnalysis, RepoInfo
from src.github_agent.report import repos_to_daily_html
from src.tools.report2md import papers_to_html
from src.tools.unified_report import build_unified_html


def test_build_unified_html_wraps_arxiv_and_github_sections():
    arxiv_html = papers_to_html(
        "2026-05-28",
        [
            {
                "title": "Intent Understanding for E-Commerce",
                "authors": ["Alice", "Bob"],
                "abs_url": "https://arxiv.org/abs/1234.5678",
                "pdf_url": "https://arxiv.org/pdf/1234.5678.pdf",
                "keywords": ["intent understanding", "e-commerce"],
                "one_liner": "面向电商场景识别用户真实意图。",
                "core_recommendation": "可用于客服和推荐链路的意图识别。",
                "trans_abs": "本文研究电商用户意图理解。",
            }
        ],
    )
    github_html = repos_to_daily_html(
        repos=[
            RepoInfo(
                full_name="example/agent-framework",
                owner="example",
                name="agent-framework",
                url="https://github.com/example/agent-framework",
                description="Agent framework",
                stars=1200,
                language="Python",
                topics=["ai-agent", "tool-calling"],
            )
        ],
        analyses={
            "example/agent-framework": RepoAnalysis(
                one_liner="面向工具调用的智能体框架。",
                positioning="智能体编排框架",
                core_tech="工具调用、任务分解",
                use_cases="电商客服自动化",
                comparison="更轻量",
                watch_reason="适合快速实验",
                relevance="高度相关",
            )
        },
        report_date="20260528",
    )

    unified_html = build_unified_html("20260528", arxiv_html, github_html)

    assert "<!doctype html>" in unified_html.lower()
    assert "Ascan-20260528" in unified_html
    assert "arXiv 论文精选" in unified_html
    assert "GitHub 项目挖掘" in unified_html
    assert "Intent Understanding for E-Commerce" in unified_html
    assert "example/agent-framework" in unified_html
    assert "```" not in unified_html
