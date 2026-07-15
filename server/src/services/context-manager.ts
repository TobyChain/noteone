/**
 * Context Manager — three-layer context management inspired by ai-agent-april.
 *
 * Layer 1: Token-budget trimming — drop oldest messages when over budget.
 * Layer 2: Progressive summarization — compact old messages into a rolling summary.
 * Layer 3: Protection zone — always preserve the most recent N messages.
 */

export interface ContextMessage {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  isSummary?: boolean;
}

const ESTIMATED_CONTEXT_WINDOW = 128_000;
const RESERVED_OUTPUT_TOKENS = 4_000;
const SYSTEM_PROMPT_BUDGET = 4_000;
const TOKEN_BUDGET = ESTIMATED_CONTEXT_WINDOW - RESERVED_OUTPUT_TOKENS - SYSTEM_PROMPT_BUDGET;
const PROTECTION_ZONE = 8;

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

function messageTokens(msg: ContextMessage): number {
  let total = estimateTokens(msg.content || "");
  if (msg.tool_calls) {
    total += estimateTokens(JSON.stringify(msg.tool_calls));
  }
  return total;
}

function totalTokens(messages: ContextMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

/**
 * Layer 1: Trim messages to fit within the token budget.
 * Drops oldest messages first, but keeps the protection zone.
 * Ensures tool messages aren't orphaned (deletes tool results when their
 * corresponding assistant tool_call message is removed).
 */
export function trimToTokenBudget(messages: ContextMessage[]): ContextMessage[] {
  if (messages.length <= PROTECTION_ZONE) return messages;

  const protectedStart = messages.length - PROTECTION_ZONE;
  let trimmable = messages.slice(0, protectedStart);
  const protectedMessages = messages.slice(protectedStart);
  const protectedTokens = totalTokens(protectedMessages);

  while (totalTokens(trimmable) + protectedTokens > TOKEN_BUDGET && trimmable.length > 0) {
    const removed = trimmable.shift()!;

    if (removed.tool_calls?.length) {
      const callIds = new Set(removed.tool_calls.map((tc: any) => tc.id));
      while (trimmable.length > 0 && trimmable[0].tool_call_id && callIds.has(trimmable[0].tool_call_id!)) {
        trimmable.shift();
      }
    }
  }

  return [...trimmable, ...protectedMessages];
}

/**
 * Check if a session needs compaction.
 * Returns true if the message count exceeds the compaction threshold.
 */
export function needsCompaction(messageCount: number): boolean {
  return messageCount + 2 >= 24;
}

/**
 * Get the protection zone size.
 */
export function getProtectionZone(): number {
  return PROTECTION_ZONE;
}

/**
 * Build the summarization prompt for progressive summarization.
 * If there's an existing summary, instructs the LLM to merge new content into it.
 */
export function buildSummarizationPrompt(
  messagesToCompact: ContextMessage[],
  existingSummary: string | null,
): Array<{ role: string; content: string }> {
  // Skip tool-role messages — they're intermediate results, not conversation
  const conversationText = messagesToCompact
    .filter((m) => m.role !== "tool")
    .map((m) => {
      const role = m.isSummary ? "摘要" : m.role === "user" ? "用户" : "Notty";
      return `${role}: ${m.content || ""}`;
    })
    .join("\n\n");

  const instruction = existingSummary
    ? `以下是之前的对话摘要和新的一段对话历史。请将新对话的内容合并到已有摘要中，保留关键信息、用户偏好、重要结论以及工具调用中获取的关键内容。用中文输出一段连贯的摘要。`
    : `将以下对话历史压缩为一段简洁的摘要，保留关键信息、用户偏好、重要结论以及工具调用中获取的关键内容。用中文输出。`;

  const existing = existingSummary ? `\n\n已有摘要：\n${existingSummary}\n` : "";

  return [
    {
      role: "system",
      content: instruction,
    },
    {
      role: "user",
      content: `${existing}对话历史：\n${conversationText}`,
    },
  ];
}
