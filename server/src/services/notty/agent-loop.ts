/**
 * Agent loop: multi-turn LLM tool-calling with doom-loop detection,
 * tool concurrency scheduling, and abort support.
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

export interface AgentLoopOptions {
  llmConfig?: LLMConfig;
  maxIterations?: number;
  signal?: AbortSignal;
  onIntermediateMessage?: (msg: IntermediateMessage) => void;
  onToolStart?: (name: string, args: Record<string, any>) => void;
  onToolEnd?: (name: string, result: string, durationMs: number) => void;
}

/** Tools that only read data can run concurrently; side-effecting tools run serially. */
const EXCLUSIVE_TOOLS = new Set([
  "run_command", "schedule_task", "cancel_scheduled_task",
  "run_ascan_module", "merge_ascan_report",
]);

function isExclusive(name: string): boolean {
  return EXCLUSIVE_TOOLS.has(name);
}

// ── Tool result compression ───────────────────────────────────────────
const MAX_TOOL_RESULT = 5000;
const KEEP_HEAD = 4000;
const KEEP_TAIL = 500;

function compressToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT) return text;
  // Skip structured data (JSON, YAML) — truncating mid-structure breaks parsing
  const trimmed = text.trimStart();
  if (trimmed[0] === "{" || trimmed[0] === "[") return text;
  return `${text.slice(0, KEEP_HEAD)}\n\n[... 已截断，共 ${text.length} 字符。如需完整内容请缩小查询范围或使用 offset/limit 分段读取 ...]\n${text.slice(-KEEP_TAIL)}`;
}

// Dedup cache: identical read-only tool+args → cached result (5 min TTL)
const dedupCache = new Map<string, { result: string; ts: number }>();
const DEDUP_TTL = 5 * 60 * 1000;

function dedupKey(name: string, args: Record<string, any>): string {
  return `${name}:${JSON.stringify(args)}`;
}

function tryDedup(name: string, args: Record<string, any>): string | null {
  if (isExclusive(name)) return null; // only cache read-only tools
  const key = dedupKey(name, args);
  const entry = dedupCache.get(key);
  if (entry && Date.now() - entry.ts < DEDUP_TTL) return entry.result;
  return null;
}

function recordDedup(name: string, args: Record<string, any>, result: string): void {
  if (isExclusive(name)) return;
  dedupCache.set(dedupKey(name, args), { result, ts: Date.now() });
}

interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export async function runAgentLoop(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }>,
  tools: ToolDefinition[],
  toolHandlers: Record<string, ToolHandler>,
  optsOrConfig?: AgentLoopOptions | LLMConfig,
  maxIterations = 3,
  onIntermediateMessage?: (msg: IntermediateMessage) => void,
): Promise<string> {
  // Support both old positional signature and new options-object signature
  let opts: AgentLoopOptions;
  if (optsOrConfig && ("apiKey" in optsOrConfig || optsOrConfig === undefined)) {
    opts = { llmConfig: optsOrConfig as LLMConfig | undefined, maxIterations, onIntermediateMessage };
  } else {
    opts = optsOrConfig as AgentLoopOptions;
  }
  const cfg = opts.llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const signal = opts.signal;
  const maxIter = opts.maxIterations ?? maxIterations;
  const emit = opts.onIntermediateMessage;

  const conversationMessages = [...messages];
  const totalStart = Date.now();
  let toolCallCount = 0;
  const recentFingerprints: string[] = [];
  const DOOM_WINDOW = 4;
  const DOOM_REPEAT_THRESHOLD = 3;

  for (let i = 0; i < maxIter; i++) {
    if (signal?.aborted) return "请求已取消。";

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
    emit?.(choice.message);

    // Parse all tool calls first
    const pending: PendingToolCall[] = [];
    for (const toolCall of choice.message.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, any>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        const errMsg = {
          role: "tool",
          content: `Error: malformed arguments for tool "${fnName}". Please provide valid JSON.`,
          tool_call_id: toolCall.id,
        };
        conversationMessages.push(errMsg);
        emit?.(errMsg);
        continue;
      }
      pending.push({ id: toolCall.id, name: fnName, args: fnArgs });
    }

    // Doom-loop detection on this turn's tool calls
    for (const p of pending) {
      const fingerprint = `${p.name}:${JSON.stringify(p.args)}`;
      recentFingerprints.push(fingerprint);
      if (recentFingerprints.length > DOOM_WINDOW) recentFingerprints.shift();

      // Check N-identical repeat (e.g. 3× same call)
      if (
        recentFingerprints.length >= DOOM_REPEAT_THRESHOLD &&
        recentFingerprints.slice(-DOOM_REPEAT_THRESHOLD).every((f) => f === fingerprint)
      ) {
        console.warn(`[llm] doom-loop detected: ${p.name} called ${DOOM_REPEAT_THRESHOLD}× with identical args, aborting`);
        return `检测到重复工具调用（${p.name}），已自动中止。请尝试换一种方式提问。`;
      }

      // Check A→B→A→B alternation (window of 4)
      if (recentFingerprints.length >= 4) {
        const [a, b, c, d] = recentFingerprints.slice(-4);
        if (a === c && b === d && a !== b) {
          console.warn(`[llm] doom-loop detected: alternating ${p.name} pattern, aborting`);
          return `检测到交替重复工具调用，已自动中止。请尝试换一种方式提问。`;
        }
      }
    }

    // Execute tools with concurrency scheduling:
    // shared (read-only) tools run concurrently, exclusive tools serialize after all shared.
    const shared: PendingToolCall[] = [];
    const exclusive: PendingToolCall[] = [];
    for (const p of pending) {
      (isExclusive(p.name) ? exclusive : shared).push(p);
    }

    const results: Array<{ id: string; name: string; result: string }> = [];

    // Run shared tools concurrently
    if (shared.length > 0) {
      const sharedResults = await Promise.all(
        shared.map(async (p) => {
          if (signal?.aborted) return { id: p.id, name: p.name, result: "请求已取消。" };
          opts.onToolStart?.(p.name, p.args);
          const fnStart = Date.now();
          let result: string;
          const cached = tryDedup(p.name, p.args);
          if (cached) {
            result = cached;
            console.log(`[llm] tool-dedup-hit name=${p.name}`);
          } else {
            const handler = toolHandlers[p.name];
            if (handler) {
              try {
                result = await handler(p.args);
              } catch (err) {
                result = `Error executing tool "${p.name}": ${err instanceof Error ? err.message : String(err)}`;
                console.error(`[llm] tool-exec-error name=${p.name} error=${result}`);
              }
            } else {
              result = `Error: unknown tool "${p.name}"`;
            }
            result = compressToolResult(result);
            recordDedup(p.name, p.args, result);
          }
          const dur = Date.now() - fnStart;
          console.log(`[llm] tool-exec name=${p.name} duration=${dur}ms`);
          opts.onToolEnd?.(p.name, result, dur);
          toolCallCount++;
          return { id: p.id, name: p.name, result };
        }),
      );
      results.push(...sharedResults);
    }

    // Run exclusive tools serially (after all shared complete)
    for (const p of exclusive) {
      if (signal?.aborted) {
        results.push({ id: p.id, name: p.name, result: "请求已取消。" });
        continue;
      }
      opts.onToolStart?.(p.name, p.args);
      const fnStart = Date.now();
      const handler = toolHandlers[p.name];
      let result: string;
      if (handler) {
        try {
          result = await handler(p.args);
        } catch (err) {
          result = `Error executing tool "${p.name}": ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[llm] tool-exec-error name=${p.name} error=${result}`);
        }
      } else {
        result = `Error: unknown tool "${p.name}"`;
      }
      result = compressToolResult(result);
      const dur = Date.now() - fnStart;
      console.log(`[llm] tool-exec name=${p.name} duration=${dur}ms`);
      opts.onToolEnd?.(p.name, result, dur);
      toolCallCount++;
      results.push({ id: p.id, name: p.name, result });
    }

    // Push results in original order
    const resultMap = new Map(results.map((r) => [r.id, r]));
    for (const p of pending) {
      const r = resultMap.get(p.id)!;
      const toolResult = { role: "tool", content: r.result, tool_call_id: p.id };
      conversationMessages.push(toolResult);
      emit?.(toolResult);
    }
  }

  if (signal?.aborted) return "请求已取消。";

  const finalData = await llmFetch(`${cfg.baseUrl}/chat/completions`, cfg, {
    model: cfg.model, messages: conversationMessages, temperature: 0.3,
  });
  return finalData.choices[0].message.content ?? "";
}
