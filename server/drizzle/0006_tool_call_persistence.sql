-- Tool call persistence: store intermediate tool calls and results
ALTER TABLE "chat_messages" ADD COLUMN "tool_calls" jsonb;
ALTER TABLE "chat_messages" ADD COLUMN "tool_call_id" text;
