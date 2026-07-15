"""
LLM-based repo analyzer using IdealAb OpenAI-compatible API.
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional
from loguru import logger

from src.github_agent.models import RepoInfo, RepoAnalysis
from src.tools.call_llm import LLMClient, _extract_json


def _build_repo_prompt(repo: RepoInfo) -> str:
    """Build a compact JSON prompt for repo analysis."""
    readme = (repo.readme_summary or "")[:800].replace("\n", " ").replace('"', "'")
    files_str = ", ".join(repo.top_files[:15]) if repo.top_files else "unknown"
    desc = (repo.description or "no description").replace('"', "'")

    return (
        f"分析这个GitHub仓库并仅以JSON格式回复，不要有其他文字，不要markdown代码块。"
        f"仓库: {repo.full_name} | "
        f"描述: {desc} | "
        f"Stars: {repo.stars} | "
        f"语言: {repo.language or 'unknown'} | "
        f"Topics: {', '.join(repo.topics[:8]) if repo.topics else 'none'} | "
        f"主要文件: {files_str} | "
        f"README摘要: {readme} | "
        f"请返回JSON对象，包含以下字段："
        f"one_liner(用大白话一句话说清这个项目能干什么，中文，不超过30字，不要用XX是开头，不要堆术语，像给产品经理介绍一样通俗易懂)，"
        f"positioning(项目定位：解决什么问题、面向什么用户，中文2-3句)，"
        f"core_tech(核心技术亮点或架构特点，中文2-3句)，"
        f"use_cases(典型使用场景，中文1-2句)，"
        f"comparison(与AutoGen/LangGraph/CrewAI等同类项目对比，若无同类写暂无，中文1-2句)，"
        f"watch_reason(为什么值得关注以及star增长原因，中文1-2句)，"
        f"relevance(与大模型及智能体方向（大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿）的相关性，必须是以下四个值之一：高度相关/相关/一般/较低)"
    )


def analyze_repo(repo: RepoInfo, client: Optional[LLMClient] = None) -> Optional[RepoAnalysis]:
    """
    Call LLM to analyze a single repo. Returns RepoAnalysis or None on failure.
    """
    if client is None:
        client = LLMClient()

    prompt = _build_repo_prompt(repo)

    for attempt in range(1, 4):
        try:
            raw = client._call_api([{"role": "user", "content": prompt}])
            if not raw or not raw.strip():
                logger.warning(f"[{repo.full_name}] empty LLM response (attempt {attempt})")
                continue

            json_str = _extract_json(raw)
            if not json_str:
                logger.warning(f"[{repo.full_name}] no JSON found in response (attempt {attempt})")
                continue

            try:
                data = json.loads(json_str)
            except json.JSONDecodeError:
                logger.warning(f"[{repo.full_name}] JSON repair failed (attempt {attempt}), raw: {raw[:300]}")
                continue

            # Normalize relevance field to allowed values
            relevance = data.get("relevance", "一般")
            allowed = {"高度相关", "相关", "一般", "较低"}
            if relevance not in allowed:
                # Try partial match
                for val in ["高度相关", "相关", "较低"]:
                    if val in relevance:
                        relevance = val
                        break
                else:
                    relevance = "一般"
            data["relevance"] = relevance

            analysis = RepoAnalysis(**data)
            logger.info(f"[{repo.full_name}] analyzed: {analysis.one_liner}")
            return analysis

        except json.JSONDecodeError as e:
            logger.warning(f"[{repo.full_name}] JSON parse error attempt {attempt}: {e}")
        except Exception as e:
            logger.warning(f"[{repo.full_name}] analysis error attempt {attempt}: {e}")

    logger.error(f"[{repo.full_name}] analysis failed after 3 attempts")
    return None


async def analyze_repo_async(repo: RepoInfo, client: Optional[LLMClient] = None) -> Optional[RepoAnalysis]:
    """在线程池中运行 analyze_repo，受 LLMClient 的 Semaphore(15) 并发限制。"""
    if client is None:
        client = LLMClient()
    if client._semaphore is None:
        client._semaphore = asyncio.Semaphore(client.max_concurrency)
    loop = asyncio.get_running_loop()
    async with client._semaphore:
        return await loop.run_in_executor(
            client._executor, analyze_repo, repo, client
        )


def analyze_repos_batch(
    repos: list[RepoInfo],
    top_n: int = 8,
    progress_callback=None,
) -> dict[str, Optional[RepoAnalysis]]:
    """
    Analyze top_n repos by star count.
    Returns dict of full_name -> RepoAnalysis (None if failed).
    """
    client = LLMClient()
    sorted_repos = sorted(repos, key=lambda r: r.stars, reverse=True)[:top_n]
    results: dict[str, Optional[RepoAnalysis]] = {}

    for i, repo in enumerate(sorted_repos, 1):
        if progress_callback:
            progress_callback(i, len(sorted_repos), repo.full_name)
        results[repo.full_name] = analyze_repo(repo, client)

    return results
