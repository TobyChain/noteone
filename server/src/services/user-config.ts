import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { LLMConfig, getDefaultLLMConfig } from "./llm.js";

export interface UserLLMSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Resolve the chat-completion LLM config for a user, falling back to the global default.
 * NOTE: embeddings intentionally stay on the default provider (see generateEmbedding) so the
 * stored vector space stays consistent regardless of a user's custom chat provider.
 */
export async function getUserChatConfig(userId: string): Promise<LLMConfig> {
  const def = getDefaultLLMConfig();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { settings: true },
  });
  const llm = ((user?.settings as any)?.llm ?? {}) as UserLLMSettings;
  return {
    apiKey: pickString(llm.apiKey) ?? def.apiKey,
    baseUrl: pickString(llm.baseUrl) ?? def.baseUrl,
    model: pickString(llm.model) ?? def.model,
  };
}

/**
 * Read the user's UI language preference from settings.
 * Returns "en" if explicitly set; otherwise defaults to "zh".
 */
export async function getUserLanguage(userId: string): Promise<"zh" | "en"> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { settings: true },
  });
  return (user?.settings as any)?.language === "en" ? "en" : "zh";
}
