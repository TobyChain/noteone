"""
大模型调用工具 - IdealAb OpenAI 兼容 API 版
通过 IdealAb 平台的 OpenAI 兼容接口调用 LLM。
"""

import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Dict, Any, List

import requests

from loguru import logger

from src.config.settings import get_settings
from src.models.schemas import PaperAnalysis


def _repair_truncated_json(text: str) -> str:
    """尝试修复被截断的 JSON 字符串。"""
    if not text or not text.strip():
        return text

    in_string = False
    escape_next = False
    brace_depth = 0
    bracket_depth = 0
    last_valid_pos = 0

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
        elif ch == '[':
            bracket_depth += 1
        elif ch == ']':
            bracket_depth -= 1
        if brace_depth == 0 and bracket_depth == 0 and ch == '}':
            last_valid_pos = i + 1

    if last_valid_pos > 0:
        return text[:last_valid_pos]

    result = text
    if in_string:
        result += '"'
    while bracket_depth > 0:
        result += ']'
        bracket_depth -= 1
    while brace_depth > 0:
        result += '}'
        brace_depth -= 1
    return result


def _truncate_to_last_complete_field(text: str) -> Optional[str]:
    """截断到最后一个完整的 JSON 字段处。"""
    last_comma = -1
    in_string = False
    escape_next = False
    depth = 0

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            depth += 1
        elif ch in ('}', ']'):
            depth -= 1
        elif ch == ',' and depth == 1:
            last_comma = i

    if last_comma <= 0:
        return None

    truncated = text[:last_comma]
    brace_depth = 0
    bracket_depth = 0
    in_str = False
    esc = False
    for ch in truncated:
        if esc:
            esc = False
            continue
        if ch == '\\' and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
        elif ch == '[':
            bracket_depth += 1
        elif ch == ']':
            bracket_depth -= 1

    result = truncated
    while bracket_depth > 0:
        result += ']'
        bracket_depth -= 1
    while brace_depth > 0:
        result += '}'
        brace_depth -= 1
    return result


def _extract_json(text: str) -> str:
    """从 LLM 输出文本中提取 JSON 对象字符串，支持修复被截断的 JSON"""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        candidate = match.group(0).strip()
        try:
            json.loads(candidate)
            return candidate
        except json.JSONDecodeError:
            pass

    start = text.find('{')
    if start == -1:
        return text.strip()

    fragment = text[start:]
    repaired = _repair_truncated_json(fragment)
    try:
        json.loads(repaired)
        return repaired
    except json.JSONDecodeError:
        pass

    repaired = _truncate_to_last_complete_field(fragment)
    if repaired:
        try:
            json.loads(repaired)
            return repaired
        except json.JSONDecodeError:
            pass

    return fragment


class LLMClient:
    """OpenAI 兼容 API LLM 客户端（支持多后端）"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ):
        settings = get_settings()
        self.api_key = api_key or settings.llm_api_key or settings.idealab_api_key
        self.base_url = (base_url or settings.llm_base_url or settings.idealab_base_url).rstrip("/")
        self.model = model or settings.llm_model
        self.timeout = settings.llm_timeout
        self.max_retries = settings.llm_max_retries

        self.max_concurrency = getattr(settings, 'llm_max_concurrency', None) or 5
        self._executor = ThreadPoolExecutor(max_workers=self.max_concurrency + 2)
        self._semaphore: Optional[asyncio.Semaphore] = None

        self.request_count = 0
        self.success_count = 0
        self.error_count = 0

        if not self.api_key:
            raise RuntimeError(
                "未配置 LLM_API_KEY 或 IDEALAB_API_KEY，请在 .env 中设置。"
            )

    def _call_api(self, messages: List[Dict[str, str]]) -> str:
        """调用 OpenAI 兼容 API，返回 LLM 输出文本。"""
        self.request_count += 1
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }

        import time as _time

        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    url, headers=headers, json=payload,
                    timeout=(10, self.timeout),  # (connect_timeout, read_timeout)
                )
                if response.status_code == 429:
                    wait = 2 ** attempt + 1
                    logger.warning(f"LLM 限流 429, 等待 {wait}s 后重试 ({attempt + 1}/{self.max_retries})")
                    _time.sleep(wait)
                    raise RuntimeError(f"API error 429: rate limited")
                if response.status_code != 200:
                    raise RuntimeError(
                        f"API error {response.status_code}: {response.text[:300]}"
                    )
                content = response.json()["choices"][0]["message"]["content"]
                self.success_count += 1
                return content

            except Exception as exc:
                last_error = exc
                if "429" not in str(exc):
                    logger.warning(
                        f"LLM API 调用失败 (尝试 {attempt + 1}/{self.max_retries}): {exc}"
                    )

        self.error_count += 1
        raise RuntimeError(
            f"LLM API 在 {self.max_retries} 次尝试后仍然失败: {last_error}"
        ) from last_error

    def _create_analysis_prompt(self, title: str, abstract: str) -> str:
        """构造论文分析 Prompt。"""
        settings = get_settings()
        high_priority = "/".join(settings.high_priority_keywords[:4])
        top_inst = "/".join(settings.top_institutions[:3])

        title_safe = title.replace('"', "'").replace("\\", "\\\\")
        abstract_safe = abstract.replace('"', "'").replace("\\", "\\\\")
        if len(abstract_safe) > 1500:
            abstract_safe = abstract_safe[:1500] + "..."

        return (
            "Analyze this paper and reply ONLY with a JSON object (no markdown, no explanation). "
            "IMPORTANT: keep trans_abs under 300 Chinese characters to avoid truncation. "
            "JSON fields: trans_abs=Chinese translation of abstract (accurate, concise, MAX 300 chars), "
            "compressed=2-3 sentence Chinese summary of research problem/method/contribution, "
            "one_liner=用大白话一句话说清这篇论文解决了什么问题或提出了什么方法，中文，20-40字，不要堆术语，像给产品经理介绍一样通俗易懂，不要用本文/本研究/该论文开头，"
            "core_recommendation=Chinese explanation of how this paper relates to or inspires LLM/Agent research (大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿) (30-80 chars), "
            "keywords=list of 3-5 Chinese keywords, "
            "sub_topic=research field in Chinese (e.g. 大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿), "
            f"recommendation=one of [极度推荐/很推荐/推荐/一般推荐/不推荐] "
            f"(极度推荐 if related to {high_priority} or from {top_inst}; "
            "很推荐 for strong innovation; 推荐 for good quality; 一般推荐 for routine; 不推荐 for unrelated). "
            f"PAPER TITLE: {title_safe} | ABSTRACT: {abstract_safe}"
        )

    def analyze_paper(self, title: str, abstract: str) -> PaperAnalysis:
        """分析论文并返回结构化结果"""
        prompt = self._create_analysis_prompt(title, abstract)
        messages = [{"role": "user", "content": prompt}]
        raw = ""
        try:
            raw = self._call_api(messages)
            cleaned = _extract_json(raw)
            data = json.loads(cleaned)
            result = PaperAnalysis.model_validate(data)
            if not result.trans_abs or len(result.trans_abs) < 10:
                logger.warning("trans_abs 过短，尝试降级")
                raise ValueError("trans_abs too short after repair")
            return result
        except json.JSONDecodeError as exc:
            self.error_count += 1
            logger.error(f"JSON 解析失败: {exc}\n原始内容: {raw[:500]}")
            return self._create_fallback_analysis(title, abstract)
        except Exception as exc:
            self.error_count += 1
            exc_type = type(exc).__name__
            if "timeout" in str(exc).lower() or "timed out" in str(exc).lower():
                logger.error(f"论文分析超时 ({exc_type}): {exc}")
            else:
                logger.error(f"论文分析失败 ({exc_type}): {exc}")
            return self._create_fallback_analysis(title, abstract)

    def _create_fallback_analysis(self, title: str, abstract: str) -> PaperAnalysis:
        return PaperAnalysis(
            trans_abs=f"【翻译失败】原标题: {title}",
            compressed="分析服务暂时不可用，请稍后重试。",
            keywords=["分析失败", "待重试", "N/A"],
            sub_topic="未知",
            recommendation="一般推荐",
        )

    async def analyze_paper_async(self, title: str, abstract: str) -> PaperAnalysis:
        """在线程池中运行 analyze_paper，受 Semaphore(15) 并发限制。"""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrency)
        loop = asyncio.get_running_loop()
        async with self._semaphore:
            return await loop.run_in_executor(
                self._executor, self.analyze_paper, title, abstract
            )

    async def analyze_paper_batch_concurrent(
        self,
        papers: List[Dict[str, str]],
        progress_callback=None,
    ) -> List[PaperAnalysis]:
        """并发批量分析论文，QPS 上限 = max_concurrency (默认 15)。"""
        completed = 0
        total = len(papers)

        async def _run_one(paper: Dict[str, str]) -> PaperAnalysis:
            nonlocal completed
            try:
                result = await self.analyze_paper_async(
                    paper.get("title", ""),
                    paper.get("abstract", ""),
                )
            except Exception as exc:
                logger.error(f"并发分析失败: {exc}")
                result = self._create_fallback_analysis(
                    paper.get("title", ""),
                    paper.get("abstract", ""),
                )
            completed += 1
            if progress_callback:
                progress_callback(completed, total)
            return result

        tasks = [_run_one(p) for p in papers]
        return await asyncio.gather(*tasks)

    def chat(self, prompt_or_messages, temperature: float = 0.7) -> str:
        """通用聊天接口，支持 string prompt 或 messages list。"""
        if isinstance(prompt_or_messages, str):
            messages = [{"role": "user", "content": prompt_or_messages}]
        else:
            messages = prompt_or_messages
        try:
            return self._call_api(messages)
        except Exception as exc:
            logger.error(f"chat 接口失败: {exc}")
            return ""

    def get_stats(self) -> Dict[str, Any]:
        return {
            "request_count": self.request_count,
            "success_count": self.success_count,
            "error_count": self.error_count,
            "success_rate": (
                self.success_count / self.request_count * 100
                if self.request_count > 0
                else 0
            ),
            "model": self.model,
            "base_url": self.base_url,
        }


