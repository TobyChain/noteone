/**
 * Agent loop: multi-turn LLM tool-calling with doom-loop detection,
 * tool concurrency scheduling, and abort support.
 */
import { apiEndpoint, getDefaultLLMConfig, llmFetch, LLMConfig, assertConfigured } from "../llm.js";
import { randomUUID } from "node:crypto";
import { sanitizeToolMessageGroups } from "../context-manager.js";

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
  cacheScope?: string;
}

/** Only explicitly read-only tools may run concurrently or use the result cache. */
const READ_ONLY_TOOLS = new Set([
  "read_note", "search_notes", "web_fetch", "discover_feed", "search_web",
  "get_ascan_preferences", "list_ascan_reports", "get_ascan_report", "get_ascan_status",
  "list_wechat_mps", "search_wechat_mp", "list_blog_sources", "get_ascan_config",
  "get_study_report_status", "list_scheduled_tasks", "search_files",
  "list_files", "read_file",
]);

function isReadOnly(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
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

function dedupKey(scope: string, name: string, args: Record<string, any>): string {
  return `${scope}:${name}:${JSON.stringify(args)}`;
}

function tryDedup(scope: string, name: string, args: Record<string, any>): string | null {
  if (!isReadOnly(name)) return null;
  const key = dedupKey(scope, name, args);
  const entry = dedupCache.get(key);
  if (entry && Date.now() - entry.ts < DEDUP_TTL) return entry.result;
  return null;
}

function recordDedup(scope: string, name: string, args: Record<string, any>, result: string): void {
  if (!isReadOnly(name)) return;
  dedupCache.set(dedupKey(scope, name, args), { result, ts: Date.now() });
}

function invalidateDedupScope(scope: string): void {
  const prefix = `${scope}:`;
  for (const key of dedupCache.keys()) {
    if (key.startsWith(prefix)) dedupCache.delete(key);
  }
}

interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

/** Remove any DSML markup blocks from content, keeping the surrounding text. */
function stripDSMLBlock(content: string): string {
  const P = "[\\uFF5C|]";
  let r = content.replace(new RegExp(`<${P}+DSML${P}+tool_calls>[\\s\\S]*?</${P}+DSML${P}+tool_calls>`, "g"), "");
  r = r.replace(new RegExp(`<${P}+DSML${P}+[^>]*>[\\s\\S]*?</${P}+DSML${P}+[^>]*>`, "g"), "");
  r = r.replace(new RegExp(`<${P}+DSML${P}+[^>]*/?>`, "g"), "");
  return r.trim();
}

/**
 * Parse DSML tool-call markup that some models (e.g. DeepSeek) emit in the
 * content field instead of the OpenAI tool_calls field. The markup looks like:
 *   <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="web_fetch">
 *       <｜｜DSML｜｜parameter name="url" string="true">https://…</｜｜DSML｜｜parameter>
 *     </｜｜DSML｜｜invoke>
 *   </｜｜DSML｜｜tool_calls>
 * Returns OpenAI-format tool_calls array, or null if no DSML tool calls found.
 * The pipe char may be fullwidth (｜ U+FF5C) or regular (|); both are matched.
 */
function parseDSMLToolCalls(content: string): any[] | null {
  if (!content || !content.includes("DSML")) return null;
  const P = "[\\uFF5C|]";
  const blockMatch = content.match(new RegExp(`<${P}+DSML${P}+tool_calls>([\\s\\S]*?)</${P}+DSML${P}+tool_calls>`));
  if (!blockMatch) return null;
  const block = blockMatch[1];
  const calls: any[] = [];
  const invokeRegex = new RegExp(`<${P}+DSML${P}+invoke name="([^"]+)">([\\s\\S]*?)</${P}+DSML${P}+invoke>`, "g");
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = invokeRegex.exec(block)) !== null) {
    const name = m[1];
    const body = m[2];
    const args: Record<string, any> = {};
    const paramRegex = new RegExp(`<${P}+DSML${P}+parameter name="([^"]+)"[^>]*>([\\s\\S]*?)</${P}+DSML${P}+parameter>`, "g");
    let p: RegExpExecArray | null;
    while ((p = paramRegex.exec(body)) !== null) {
      args[p[1]] = p[2].trim();
    }
    calls.push({
      id: `call_dsml_${randomUUID()}_${idx++}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
  }
  return calls.length > 0 ? calls : null;
}

function normalizeToolCalls(toolCalls: any[]): any[] {
  const seen = new Set<string>();
  return toolCalls.map((call, index) => {
    let id = typeof call?.id === "string" && call.id ? call.id : `call_${randomUUID()}_${index}`;
    if (seen.has(id)) id = `call_${randomUUID()}_${index}`;
    seen.add(id);
    const args = call?.function?.arguments;
    return {
      id,
      type: "function",
      function: {
        name: String(call?.function?.name || ""),
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    };
  });
}

export async function runAgentLoop(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }>,
  tools: ToolDefinition[],
  toolHandlers: Record<string, ToolHandler>,
  optsOrConfig?: AgentLoopOptions | LLMConfig,
  // A generous hard ceiling protects against varying-call runaway loops that
  // fingerprint-based doom detection cannot catch.
  maxIterations = 32,
  onIntermediateMessage?: (msg: IntermediateMessage) => void,
): Promise<string> {
  // Support both old positional signature and new options-object signature
  let opts: AgentLoopOptions;
  if (!optsOrConfig) {
    opts = { maxIterations, onIntermediateMessage };
  } else if ("apiKey" in optsOrConfig) {
    opts = { llmConfig: optsOrConfig as LLMConfig | undefined, maxIterations, onIntermediateMessage };
  } else {
    opts = optsOrConfig as AgentLoopOptions;
  }
  const cfg = opts.llmConfig ?? getDefaultLLMConfig();
  assertConfigured(cfg);
  const signal = opts.signal;
  const maxIter = opts.maxIterations ?? maxIterations;
  const emit = opts.onIntermediateMessage;
  const cacheScope = opts.cacheScope ?? "default";

  const conversationMessages = sanitizeToolMessageGroups(messages);
  const totalStart = Date.now();
  let toolCallCount = 0;
  const recentFingerprints: string[] = [];
  const DOOM_WINDOW = 4;
  const DOOM_REPEAT_THRESHOLD = 3;

  for (let i = 0; i < maxIter; i++) {
    if (signal?.aborted) return "请求已取消。";

    const iterStart = Date.now();
    const data = await llmFetch(apiEndpoint(cfg.baseUrl, "chat/completions"), cfg, {
      model: cfg.model, messages: conversationMessages, tools, temperature: 0.3,
    }, signal);
    if (!Array.isArray(data?.choices) || !data.choices[0]?.message) {
      const detail = data?.error?.message || data?.message || "missing choices[0].message";
      throw new Error(`LLM API returned an invalid chat response: ${detail}`);
    }
    const choice = data.choices[0];
    {
      const contentPreview = (choice.message.content ?? "").slice(0, 120);
      const hasDSML = (choice.message.content ?? "").includes("DSML");
      console.log(`[llm] iter=${i} model=${cfg.model} dur=${Date.now() - iterStart}ms tool_calls=${choice.message.tool_calls?.length ?? 0} hasDSML=${hasDSML} content="${contentPreview.replace(/\n/g, "\\n")}"`);
    }

    // Some models (e.g. DeepSeek) return tool calls as DSML markup in the content
    // field instead of the OpenAI tool_calls field. Parse + convert so the agent
    // executes them rather than leaking the raw markup as the reply.
    if ((!choice.message.tool_calls || choice.message.tool_calls.length === 0) && choice.message.content) {
      const dsmlCalls = parseDSMLToolCalls(choice.message.content);
      if (dsmlCalls) {
        choice.message.tool_calls = dsmlCalls;
        // Keep any text the model wrote before the DSML block ("我先看看页面源码…")
        // so mid-replies survive instead of being discarded wholesale.
        const residual = stripDSMLBlock(choice.message.content);
        choice.message.content = residual.length > 0 ? residual : null;
        console.log(`[llm] DSML tool_calls parsed from content: ${dsmlCalls.length} call(s), residualText=${residual.length} chars`);
      }
    }
    if (choice.message.tool_calls?.length) {
      choice.message.tool_calls = normalizeToolCalls(choice.message.tool_calls);
    }

    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      const replyPreview = (choice.message.content ?? "").slice(0, 120).replace(/\n/g, "\\n");
      console.log(`[llm] FINAL-REPLY iter=${i} content="${replyPreview}" hasDSML=${(choice.message.content ?? "").includes("DSML")}`);
      // A final reply may still contain DSML markup the parser rejected (malformed);
      // strip it so the UI never renders raw markup.
      return stripDSMLBlock(choice.message.content ?? "");
    }

    conversationMessages.push(choice.message);
    // Emit with content intact: intermediate text ("我先看看…") is a visible
    // mid-reply, and tool_calls consumers read the tool_calls field anyway.
    console.log(`[llm] emit iter=${i} role=assistant content="${(choice.message.content ?? "").slice(0, 80).replace(/\n/g, "\\n")}" tool_calls=${choice.message.tool_calls?.length ?? 0}`);
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

    const results: Array<{ id: string; name: string; result: string }> = [];
    const executeOne = async (p: PendingToolCall) => {
      if (signal?.aborted) return { id: p.id, name: p.name, result: "请求已取消。" };
      opts.onToolStart?.(p.name, p.args);
      const fnStart = Date.now();
      let result: string;
      const cached = tryDedup(cacheScope, p.name, p.args);
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
        recordDedup(cacheScope, p.name, p.args, result);
      }
      const dur = Date.now() - fnStart;
      console.log(`[llm] tool-exec name=${p.name} duration=${dur}ms args=${JSON.stringify(p.args).slice(0, 80)} result="${result.slice(0, 120).replace(/\n/g, "\\n")}"`);
      opts.onToolEnd?.(p.name, result, dur);
      toolCallCount++;
      return { id: p.id, name: p.name, result };
    };

    // Preserve model-declared order. Consecutive read-only calls may run as one
    // parallel batch; every state-changing call is an ordering barrier.
    let readBatch: PendingToolCall[] = [];
    const flushReadBatch = async () => {
      if (readBatch.length === 0) return;
      const sharedResults = await Promise.all(
        readBatch.map(executeOne),
      );
      results.push(...sharedResults);
      readBatch = [];
    };
    for (const p of pending) {
      if (isReadOnly(p.name)) {
        readBatch.push(p);
      } else {
        await flushReadBatch();
        invalidateDedupScope(cacheScope);
        results.push(await executeOne(p));
      }
    }
    await flushReadBatch();

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

  // Iteration budget exhausted mid-task. A bare follow-up call lets the model
  // trail off mid-sentence ("让我看看…：") because it can no longer call tools.
  // Force an explicit wrap-up instead: summarize progress and remaining steps.
  console.log(`[llm] iteration-budget-exhausted maxIter=${maxIter} toolCalls=${toolCallCount}`);
  conversationMessages.push({
    role: "system",
    content: `本轮工具调用已达上限（${maxIter} 次）。请不要再调用工具，基于已获得的信息向用户总结：目前完成了什么、拿到了哪些结果、还剩什么没做。`,
  });
  const finalData = await llmFetch(apiEndpoint(cfg.baseUrl, "chat/completions"), cfg, {
    model: cfg.model, messages: conversationMessages, temperature: 0.3,
  }, signal);
  if (!Array.isArray(finalData?.choices) || !finalData.choices[0]?.message) {
    const detail = finalData?.error?.message || finalData?.message || "missing choices[0].message";
    throw new Error(`LLM API returned an invalid chat response: ${detail}`);
  }
  const finalReply = stripDSMLBlock(finalData.choices[0].message.content ?? "");
  return finalReply || "本轮工具调用已达上限，我先停在这里。可以继续对话，我会接着处理剩余步骤。";
}
