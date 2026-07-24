/**
 * Pipeline LLM client — OpenAI-compatible chat with concurrency limiting,
 * 429 exponential backoff, and truncated-JSON repair.
 * Ported from ascan/src/tools/call_llm.py.
 */
import { sleep } from "./util.js";

// ── truncated-JSON repair (character-level state machines) ────

export function repairTruncatedJson(text: string): string {
  if (!text || !text.trim()) return text;

  let inString = false;
  let escapeNext = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let lastValidPos = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === "\\" && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    if (braceDepth === 0 && bracketDepth === 0 && ch === "}") {
      lastValidPos = i + 1;
    }
  }

  if (lastValidPos > 0) return text.slice(0, lastValidPos);

  let result = text;
  if (inString) result += '"';
  while (bracketDepth > 0) { result += "]"; bracketDepth--; }
  while (braceDepth > 0) { result += "}"; braceDepth--; }
  return result;
}

export function truncateToLastCompleteField(text: string): string | null {
  let lastComma = -1;
  let inString = false;
  let escapeNext = false;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === "\\" && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 1) lastComma = i;
  }

  if (lastComma <= 0) return null;

  const truncated = text.slice(0, lastComma);
  let braceDepth = 0;
  let bracketDepth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of truncated) {
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }

  let result = truncated;
  while (bracketDepth > 0) { result += "]"; bracketDepth--; }
  while (braceDepth > 0) { result += "}"; braceDepth--; }
  return result;
}

function parseable(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

/** Extract a JSON object string from LLM output (strips markdown fences, repairs truncation). */
export function extractJson(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/gm, "").replace(/\s*```$/gm, "");

  const match = t.match(/\{[\s\S]*\}/);
  if (match) {
    const candidate = match[0].trim();
    if (parseable(candidate)) return candidate;
  }

  const start = t.indexOf("{");
  if (start === -1) return t.trim();

  const fragment = t.slice(start);
  const repaired = repairTruncatedJson(fragment);
  if (parseable(repaired)) return repaired;

  const truncated = truncateToLastCompleteField(fragment);
  if (truncated && parseable(truncated)) return truncated;

  return fragment;
}

// ── concurrency-limited client ────────────────────────────────

export interface PipelineLLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxConcurrency?: number;
  maxRetries?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

export class PipelineLLM {
  private cfg: Required<PipelineLLMConfig>;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(cfg: PipelineLLMConfig) {
    this.cfg = {
      maxConcurrency: 5,
      maxRetries: 3,
      timeoutMs: 240_000,
      maxTokens: 8192,
      ...cfg,
    };
  }

  get isConfigured(): boolean {
    return !!(this.cfg.apiKey && this.cfg.baseUrl && this.cfg.model);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.cfg.maxConcurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Single chat completion with 429 exponential backoff. */
  async chat(promptOrMessages: string | Array<{ role: string; content: string }>): Promise<string> {
    if (!this.isConfigured) throw new Error("pipeline LLM not configured");
    const messages = typeof promptOrMessages === "string"
      ? [{ role: "user", content: promptOrMessages }]
      : promptOrMessages;

    await this.acquire();
    try {
      let lastError: unknown;
      for (let attempt = 0; attempt < this.cfg.maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
        try {
          const resp = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.cfg.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: this.cfg.model, messages, stream: false, max_tokens: this.cfg.maxTokens }),
            signal: controller.signal,
          });
          if (resp.status === 429) {
            const wait = (2 ** attempt + 1) * 1000;
            console.warn(`[ascan-llm] 429 rate limited, waiting ${wait}ms (${attempt + 1}/${this.cfg.maxRetries})`);
            await sleep(wait);
            throw new Error("API error 429: rate limited");
          }
          if (!resp.ok) {
            throw new Error(`API error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
          }
          const data: any = await resp.json();
          return data.choices[0].message.content ?? "";
        } catch (err) {
          lastError = err;
          if (!String(err).includes("429")) {
            console.warn(`[ascan-llm] call failed (attempt ${attempt + 1}/${this.cfg.maxRetries}): ${err}`);
          }
        } finally {
          clearTimeout(timer);
        }
      }
      throw new Error(`LLM API failed after ${this.cfg.maxRetries} attempts: ${lastError}`);
    } finally {
      this.release();
    }
  }

  /** chat + JSON extraction/repair + parse. Throws if unparseable. */
  async chatJson<T = any>(promptOrMessages: string | Array<{ role: string; content: string }>): Promise<T> {
    const raw = await this.chat(promptOrMessages);
    return JSON.parse(extractJson(raw)) as T;
  }

  /** chatJson with per-call attempts and an optional result validator. Throws after all attempts fail. */
  async chatJsonRetry<T = any>(
    promptOrMessages: string | Array<{ role: string; content: string }>,
    validate?: (data: T) => boolean,
    attempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const data = await this.chatJson<T>(promptOrMessages);
        if (validate && !validate(data)) {
          throw new Error("validation failed");
        }
        return data;
      } catch (err) {
        lastError = err;
        console.warn(`[ascan-llm] chatJsonRetry attempt ${i + 1}/${attempts} failed: ${err}`);
      }
    }
    throw new Error(`chatJsonRetry failed after ${attempts} attempts: ${lastError}`);
  }

  /** Concurrent map over items (bounded by maxConcurrency via chat()). Errors map to fallback(item). */
  async mapConcurrent<TIn, TOut>(
    items: TIn[],
    fn: (item: TIn) => Promise<TOut>,
    fallback: (item: TIn, err: unknown) => TOut,
    onProgress?: (done: number, total: number) => void,
  ): Promise<TOut[]> {
    let done = 0;
    return Promise.all(items.map(async (item) => {
      let out: TOut;
      try {
        out = await fn(item);
      } catch (err) {
        out = fallback(item, err);
      }
      done++;
      onProgress?.(done, items.length);
      return out;
    }));
  }
}
