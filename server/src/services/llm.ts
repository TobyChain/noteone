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

function assertConfigured(cfg: LLMConfig): void {
  if (!isLLMConfigured(cfg)) throw new LLMNotConfiguredError();
}

const LLM_FETCH_TIMEOUT = 120_000;

async function llmFetch(url: string, cfg: LLMConfig, body: Record<string, any>): Promise<any> {
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

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export type ToolHandler = (args: Record<string, any>) => Promise<string>;

export interface IntermediateMessage {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export async function chatCompletionWithTools(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }>,
  tools: ToolDefinition[],
  toolHandlers: Record<string, ToolHandler>,
  llmConfig?: LLMConfig,
  maxIterations = 3,
  onIntermediateMessage?: (msg: IntermediateMessage) => void,
): Promise<string> {
  const cfg = llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const conversationMessages = [...messages];
  const totalStart = Date.now();
  let toolCallCount = 0;
  const recentFingerprints: string[] = [];
  const DOOM_LOOP_THRESHOLD = 3;

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();
    const data = await llmFetch(`${cfg.baseUrl}/chat/completions`, cfg, {
      model: cfg.model, messages: conversationMessages, tools, temperature: 0.3,
    });
    const choice = data.choices[0];
    console.log(`[llm] tool-completion iter=${i} model=${cfg.model} duration=${Date.now() - iterStart}ms tools=${choice.message.tool_calls?.length ?? 0}`);

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      console.log(`[llm] tool-completion-done iterations=${i + 1} toolCalls=${toolCallCount} totalDuration=${Date.now() - totalStart}ms`);
      return choice.message.content ?? "";
    }

    conversationMessages.push(choice.message);
    onIntermediateMessage?.(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, any>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        conversationMessages.push({
          role: "tool",
          content: `Error: malformed arguments for tool "${fnName}"`,
          tool_call_id: toolCall.id,
        });
        onIntermediateMessage?.({
          role: "tool",
          content: `Error: malformed arguments for tool "${fnName}"`,
          tool_call_id: toolCall.id,
        });
        continue;
      }

      // Doom-loop detection: fingerprint = tool name + sorted args
      const fingerprint = `${fnName}:${JSON.stringify(fnArgs)}`;
      recentFingerprints.push(fingerprint);
      if (recentFingerprints.length > DOOM_LOOP_THRESHOLD) {
        recentFingerprints.shift();
      }
      if (
        recentFingerprints.length === DOOM_LOOP_THRESHOLD &&
        recentFingerprints.every((f) => f === fingerprint)
      ) {
        console.warn(`[llm] doom-loop detected: ${fnName} called ${DOOM_LOOP_THRESHOLD} times with identical args, aborting`);
        return `检测到重复工具调用（${fnName}），已自动中止。请尝试换一种方式提问。`;
      }

      const handler = toolHandlers[fnName];

      let result: string;
      if (handler) {
        const fnStart = Date.now();
        try {
          result = await handler(fnArgs);
        } catch (err) {
          result = `Error executing tool "${fnName}": ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[llm] tool-exec-error name=${fnName} error=${result}`);
        }
        console.log(`[llm] tool-exec name=${fnName} duration=${Date.now() - fnStart}ms`);
      } else {
        result = `Error: unknown tool "${fnName}"`;
      }
      toolCallCount++;

      const toolResult = {
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
      };
      conversationMessages.push(toolResult);
      onIntermediateMessage?.(toolResult);
    }
  }

  const finalData = await llmFetch(`${cfg.baseUrl}/chat/completions`, cfg, {
    model: cfg.model, messages: conversationMessages, temperature: 0.3,
  });
  return finalData.choices[0].message.content ?? "";
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
