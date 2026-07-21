/**
 * Agent loop: multi-turn LLM tool-calling with doom-loop detection.
 * Extracted from llm.ts so that llm.ts stays a thin LLM API client.
 */
import { getDefaultLLMConfig, llmFetch, LLMConfig, assertConfigured } from "../llm.js";

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

export async function runAgentLoop(
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
        const errMsg = {
          role: "tool",
          content: `Error: malformed arguments for tool "${fnName}"`,
          tool_call_id: toolCall.id,
        };
        conversationMessages.push(errMsg);
        onIntermediateMessage?.(errMsg);
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
