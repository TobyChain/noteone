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
}

export type ModuleRunner = (ctx: ModuleContext) => Promise<ModuleResult>;

export type AscanModuleName = "arxiv" | "github" | "official" | "blog" | "conference" | "wechat";

export const MODULE_LABELS: Record<AscanModuleName, string> = {
  arxiv: "arXiv 论文精选",
  github: "GitHub 项目挖掘",
  official: "官方动态跟踪",
  blog: "独立博客订阅",
  conference: "会议论文追踪",
  wechat: "微信公众号",
};
