import { config } from "../config.js";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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
    throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
  }

  const data: any = await res.json();
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
  const conversationMessages = [...messages];

  for (let i = 0; i < maxIterations; i++) {
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
      throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
    }

    const data: any = await res.json();
    const choice = data.choices[0];

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      return choice.message.content ?? "";
    }

    conversationMessages.push(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);
      const handler = toolHandlers[fnName];

      let result: string;
      if (handler) {
        result = await handler(fnArgs);
      } else {
        result = `Error: unknown tool "${fnName}"`;
      }

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
    throw new Error(`Embedding API error: ${res.status} ${await res.text()}`);
  }

  const data: any = await res.json();
  return data.data[0].embedding;
}
