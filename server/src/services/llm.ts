import { config } from "../config.js";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class LLMNotConfiguredError extends Error {
  constructor() {
    super("LLM not configured: set apiKey + baseUrl + model in user settings or QWEN_* env vars");
    this.name = "LLMNotConfiguredError";
  }
}

export function isLLMConfigured(cfg: LLMConfig): boolean {
  return cfg.apiKey.trim() !== "" && cfg.baseUrl.trim() !== "" && cfg.model.trim() !== "";
}

export function assertConfigured(cfg: LLMConfig): void {
  if (!isLLMConfigured(cfg)) throw new LLMNotConfiguredError();
}

const LLM_FETCH_TIMEOUT = 120_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_LLM_ATTEMPTS = 3;

export function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
  }
  return Math.min(8_000, 1_000 * 2 ** attempt);
}

async function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

export async function llmFetch(
  url: string,
  cfg: LLMConfig,
  body: Record<string, any>,
  externalSignal?: AbortSignal,
): Promise<any> {
  for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT);
    const signal = externalSignal
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 2_000);
        if (RETRYABLE_STATUS.has(res.status) && attempt + 1 < MAX_LLM_ATTEMPTS) {
          await waitForRetry(retryDelayMs(res, attempt), externalSignal);
          continue;
        }
        throw new Error(`LLM API error: ${res.status} ${text}`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`LLM API returned non-JSON response: ${text.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("LLM API retry budget exhausted");
}

export function getDefaultLLMConfig(): LLMConfig {
  return {
    apiKey: config.qwen.apiKey,
    baseUrl: config.qwen.baseUrl,
    model: config.qwen.model,
  };
}

export async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  llmConfig?: LLMConfig,
): Promise<string> {
  const cfg = llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const start = Date.now();
  const data = await llmFetch(apiEndpoint(cfg.baseUrl, "chat/completions"), cfg, { model: cfg.model, messages, temperature: 0.3 });
  if (!Array.isArray(data?.choices) || !data.choices[0]?.message) {
    const detail = data?.error?.message || data?.message || "missing choices[0].message";
    throw new Error(`LLM API returned an invalid chat response: ${detail}`);
  }
  const usage = data.usage;
  console.log(`[llm] chat-completion model=${cfg.model} duration=${Date.now() - start}ms tokens=${usage?.total_tokens ?? "?"}`);
  return data.choices[0].message.content;
}

export async function generateEmbedding(
  text: string,
  llmConfig?: LLMConfig,
): Promise<number[]> {
  const cfg = llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const start = Date.now();
  const data = await llmFetch(apiEndpoint(cfg.baseUrl, "embeddings"), cfg, {
    model: "text-embedding-3-small", input: text, dimensions: 1536,
  });
  if (!Array.isArray(data?.data) || !Array.isArray(data.data[0]?.embedding)) {
    const detail = data?.error?.message || data?.message || "missing data[0].embedding";
    throw new Error(`Embedding API returned an invalid response: ${detail}`);
  }
  console.log(`[llm] embedding duration=${Date.now() - start}ms inputLen=${text.length}`);
  return data.data[0].embedding;
}
