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

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[llm] chat-completion model=${cfg.model} duration=${Date.now() - start}ms status=error code=${res.status}`);
    throw new Error(`LLM API error: ${res.status} ${body}`);
  }

  const data: any = await res.json();
  const duration = Date.now() - start;
  const usage = data.usage;
  console.log(`[llm] chat-completion model=${cfg.model} duration=${duration}ms tokens=${usage?.total_tokens ?? "?"}`);
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

export async function chatCompletionWithTools(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }>,
  tools: ToolDefinition[],
  toolHandlers: Record<string, ToolHandler>,
  llmConfig?: LLMConfig,
  maxIterations = 3,
): Promise<string> {
  const cfg = llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const conversationMessages = [...messages];
  const totalStart = Date.now();
  let toolCallCount = 0;

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: conversationMessages,
        tools,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[llm] tool-completion iter=${i} model=${cfg.model} duration=${Date.now() - iterStart}ms status=error code=${res.status}`);
      throw new Error(`LLM API error: ${res.status} ${body}`);
    }

    const data: any = await res.json();
    const choice = data.choices[0];
    console.log(`[llm] tool-completion iter=${i} model=${cfg.model} duration=${Date.now() - iterStart}ms tools=${choice.message.tool_calls?.length ?? 0}`);

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      console.log(`[llm] tool-completion-done iterations=${i + 1} toolCalls=${toolCallCount} totalDuration=${Date.now() - totalStart}ms`);
      return choice.message.content ?? "";
    }

    conversationMessages.push(choice.message);

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
        continue;
      }
      const handler = toolHandlers[fnName];

      let result: string;
      if (handler) {
        const fnStart = Date.now();
        result = await handler(fnArgs);
        console.log(`[llm] tool-exec name=${fnName} duration=${Date.now() - fnStart}ms`);
      } else {
        result = `Error: unknown tool "${fnName}"`;
      }
      toolCallCount++;

      conversationMessages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
      });
    }
  }

  const finalRes = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: conversationMessages,
      temperature: 0.3,
    }),
  });

  if (!finalRes.ok) {
    throw new Error(`LLM API error: ${finalRes.status} ${await finalRes.text()}`);
  }

  const finalData: any = await finalRes.json();
  return finalData.choices[0].message.content ?? "";
}

export async function generateEmbedding(
  text: string,
  llmConfig?: LLMConfig,
): Promise<number[]> {
  const cfg = llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const start = Date.now();

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[llm] embedding duration=${Date.now() - start}ms status=error code=${res.status}`);
    throw new Error(`Embedding API error: ${res.status} ${body}`);
  }

  const data: any = await res.json();
  console.log(`[llm] embedding duration=${Date.now() - start}ms inputLen=${text.length}`);
  return data.data[0].embedding;
}
