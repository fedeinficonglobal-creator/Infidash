-- The Gemini-generated insights table is dead: nothing reads or writes it any more
-- (insights are deterministic rules computed on read). Idempotent by design.
DROP TABLE IF EXISTS ai_insights;
