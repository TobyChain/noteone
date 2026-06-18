import { chatCompletion, LLMConfig } from "./llm.js";
import { db } from "../db/client.js";
import { tags, noteTags } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

interface TagResult {
  dimension: "format" | "topic" | "domain" | "module";
  name: string;
  confidence: number;
}

const VALID_DIMENSIONS = ["format", "topic", "domain", "module"] as const;

export async function tagNote(
  noteId: string,
  userId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<TagResult[]> {
  const start = Date.now();
  const prompt = `分析以下内容，返回 JSON 数组格式的多维度标签。

每个标签需包含：
- dimension: "format"（格式）| "topic"（主题）| "domain"（领域）| "module"（模块）
- name: 标签名（中文）
- confidence: 置信度 0-1

规则：
1. format 标签基于内容类型：文本/图片/视频/链接/混合
2. topic 标签是大类：科技/财经/教育/文化/生活等
3. domain 标签是 topic 下的细分领域
4. module 标签是 domain 下的具体模块/技术点

内容类型: ${contentType}
内容: ${content.slice(0, 2000)}

仅返回 JSON 数组，不要其他文字：`;

  const result = await chatCompletion(
    [{ role: "user", content: prompt }],
    llmConfig,
  );

  const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    console.error(`[tagging] model returned non-JSON for note ${noteId}`);
    return [];
  }

  // Defensively validate model output before trusting it (avoids enum violations / junk tags).
  const parsed: TagResult[] = (Array.isArray(raw) ? raw : []).filter(
    (t): t is TagResult =>
      !!t &&
      typeof t.name === "string" &&
      t.name.trim().length > 0 &&
      VALID_DIMENSIONS.includes(t.dimension),
  );

  for (const tagResult of parsed) {
    // tags are tenant-scoped: dedup within the owning user only
    let existingTag = await db.query.tags.findFirst({
      where: and(
        eq(tags.userId, userId),
        eq(tags.name, tagResult.name),
        eq(tags.dimension, tagResult.dimension),
      ),
    });

    if (!existingTag) {
      const [created] = await db.insert(tags).values({
        userId,
        name: tagResult.name,
        dimension: tagResult.dimension,
      }).returning();
      existingTag = created;
    }

    await db.insert(noteTags).values({
      noteId,
      tagId: existingTag.id,
      confidence: typeof tagResult.confidence === "number" ? tagResult.confidence : null,
      isManual: false,
    }).onConflictDoNothing();
  }

  console.log(`[tagging] noteId=${noteId} duration=${Date.now() - start}ms parsedTags=${parsed.length}`);
  return parsed;
}
