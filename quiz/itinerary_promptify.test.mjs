import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { main } from "../command/itinerary_promptify.mjs";

test("itinerary_promptify rewrites cut text via mind responses", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "promptify-"));
  const input = path.join(dir, "cuts.pya");
  const output = path.join(dir, "prompts.pya");
  await fs.writeFile(input, [
    "su name teaching cuts be series def",
    "su name cut 001 since num 0.000 until num 2.000 ob text \"first cut text\" ya",
    "su name cut 002 since num 2.000 until num 4.000 ob text \"second cut text\" ya",
    ""
  ].join("\n"), "utf8");

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body ?? "{}"));
    const userText = String(body?.messages?.[1]?.content ?? "");
    calls.push(userText);
    return {
      ok: true,
      json: async () => ({ message: { content: `visual prompt for ${userText}` } })
    };
  };
  try {
    await main([
      "node",
      "command/itinerary_promptify.mjs",
      input,
      output,
      "--host",
      "http://localhost:11434",
      "--model",
      "qwen3-vl:8b-instruct"
    ]);
  } finally {
    globalThis.fetch = priorFetch;
  }

  assert.equal(calls.length, 2);
  const outputText = await fs.readFile(output, "utf8");
  assert.match(outputText, /ob text "visual prompt for first cut text"/u);
  assert.match(outputText, /ob text "visual prompt for second cut text"/u);
});
