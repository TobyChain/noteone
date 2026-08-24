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

export async function llmFetch(url: string, cfg: LLMConfig, body: Record<string, any>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error: ${res.status} ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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
  const data = await llmFetch(`${cfg.baseUrl}/chat/completions`, cfg, { model: cfg.model, messages, temperature: 0.3 });
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
  const data = await llmFetch(`${cfg.baseUrl}/embeddings`, cfg, {
    model: "text-embedding-3-small", input: text, dimensions: 1536,
  });
  console.log(`[llm] embedding duration=${Date.now() - start}ms inputLen=${text.length}`);
  return data.data[0].embedding;
}
