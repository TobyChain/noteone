/**
 * Shared types for the TS ascan pipeline (ported from the Python pipeline).
 */
import type { AscanConfig } from "../config.js";
import type { PipelineLLM } from "./llm.js";

export interface ModuleResult {
  html: string;
  md: string;
  /** items fetched this run (after dedup), for logging/progress */
  count: number;
}

export interface ModuleContext {
  /** YYYY-MM-DD */
  date: string;
  /** YYYYMMDD */
  dateCompact: string;
  config: AscanConfig;
  llm: PipelineLLM;
  log: (msg: string) => void;
  /** User's daily mining preferences (focus topics, display order, etc.) */
  preferences?: AscanPreferences;
  /** UI language preference — controls LLM prompt language and report labels */
  language: "zh" | "en";
}

export interface AscanPreferences {
  /** 今日挖取重点，如 "AI Agent, 多模态模型" */
  focus?: string;
  /** 长期兴趣主题，如 "LLM, Agent, Web3" */
  topics?: string;
  /** 模块显示顺序，默认 official→blog→github→arxiv→conference→wechat */
  moduleOrder?: AscanModuleName[];
}

export type ModuleRunner = (ctx: ModuleContext) => Promise<ModuleResult>;

export type AscanModuleName = "arxiv" | "github" | "official" | "blog" | "conference" | "wechat";

export const MODULE_LABELS_ZH: Record<AscanModuleName, string> = {
  official: "官方动态跟踪",
  blog: "独立博客订阅",
  github: "GitHub 项目挖掘",
  arxiv: "arXiv 论文精选",
  conference: "会议论文追踪",
  wechat: "微信公众号",
};

export const MODULE_LABELS_EN: Record<AscanModuleName, string> = {
  official: "Official Updates",
  blog: "Independent Blogs",
  github: "GitHub Projects",
  arxiv: "arXiv Papers",
  conference: "Conference Papers",
  wechat: "WeChat Articles",
};

/** Default (Chinese) module labels — kept for backward compatibility. */
export const MODULE_LABELS = MODULE_LABELS_ZH;

/** Return the label map for the given language. */
export function getModuleLabels(language: "zh" | "en"): Record<AscanModuleName, string> {
  return language === "en" ? MODULE_LABELS_EN : MODULE_LABELS_ZH;
}
