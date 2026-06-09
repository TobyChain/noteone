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
    model: "qwen-turbo",
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
      model: "text-embedding-v2",
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
