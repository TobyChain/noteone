import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
const db = new PGlite(process.env.HOME + "/Library/Application Support/NoteOne/db", { extensions: { vector } });
const tables = ["notes","tags","note_tags","chat_sessions","chat_messages","wechat_sessions","scheduled_tasks"];
for (const t of tables) {
  const col = t === "note_tags" ? null : "user_id";
  if (t === "note_tags") {
    const r = await db.query("SELECT n.user_id, count(*) FROM note_tags nt JOIN notes n ON n.id=nt.note_id GROUP BY n.user_id");
    console.log(t, JSON.stringify(r.rows));
  } else if (t === "chat_messages") {
    const r = await db.query("SELECT s.user_id, count(*) FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id GROUP BY s.user_id");
    console.log(t, JSON.stringify(r.rows));
  } else {
    const r = await db.query(`SELECT ${col}, count(*) FROM ${t} GROUP BY ${col}`);
    console.log(t, JSON.stringify(r.rows));
  }
}
// which user has settings (LLM config)?
const s = await db.query("SELECT id, apple_id, settings FROM users WHERE settings::text LIKE '%apiKey%'");
console.log("users with llm config:", s.rows.map(r=>r.apple_id));
await db.close();
