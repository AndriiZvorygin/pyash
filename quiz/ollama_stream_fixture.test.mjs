import test from "node:test";
import assert from "node:assert/strict";

import { generateStream } from "../program/motor/ollama.mjs";

const host = process.env.OLLAMA_HOST ?? "";
const model = process.env.OLLAMA_TEST_MODEL ?? "";

test("ollama generateStream yields chunked responses", { skip: !model }, async () => {
  const prompt = "Write 5 short sentences about rain. No bullet points.";
  const result = await generateStream({ model, prompt });
  assert.ok(result.text.length > 0, "expected non-empty text");
  assert.ok(result.chunks.length > 0, "expected at least one chunk");
  assert.equal(result.chunks.join(""), result.text, "chunks should join to final text");
  const last = result.payloads.at(-1);
  assert.ok(last && last.done, "expected final payload with done");
});
