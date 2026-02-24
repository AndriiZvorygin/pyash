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
  assert.match(calls[0], /\[GLOBAL CONTEXT\]/u);
  assert.match(calls[0], /\[NARRATIVE ARC POLICY\]/u);
  assert.match(calls[0], /current_cut:\s*first cut text/u);
  assert.match(calls[0], /next_cut:\s*second cut text/u);
  assert.match(calls[0], /shot_mode:\s*establishing wide shot/u);
  assert.match(calls[0], /triad_positive_required_now:\s*lie/u);
  assert.match(calls[0], /previous_prompt_1:\s*EMPTY/u);
  assert.match(calls[0], /previous_prompt_2:\s*EMPTY/u);
  assert.match(calls[0], /\[SCENE CONSISTENCY\]/u);
  assert.match(calls[0], /scene_mode_hint:\s*neutral/u);
  assert.match(calls[1], /current_cut:\s*second cut text/u);
  assert.match(calls[1], /shot_mode:\s*medium character-driven scene/u);
  assert.match(calls[1], /triad_positive_required_now:\s*truth/u);
  assert.match(calls[1], /triad_target_mode:\s*positive/u);
  assert.match(calls[1], /previous_prompt_1:\s*visual prompt for/u);
  assert.match(calls[1], /previous_prompt_2:\s*EMPTY/u);
  assert.match(calls[1], /previous_prompt:/u);
  const outputText = await fs.readFile(output, "utf8");
  assert.match(outputText, /visual prompt for \[ROLE\]/u);
});

test("itinerary_promptify neighbor context skips duplicate adjacent cuts", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "promptify-"));
  const input = path.join(dir, "cuts.pya");
  const output = path.join(dir, "prompts.pya");
  await fs.writeFile(input, [
    "su name teaching cuts be series def",
    "su name cut 001 since num 0.000 until num 2.000 ob text \"same text\" ya",
    "su name cut 002 since num 2.000 until num 4.000 ob text \"same text\" ya",
    "su name cut 003 since num 4.000 until num 6.000 ob text \"different text\" ya",
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
      json: async () => ({ message: { content: "ok prompt" } })
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

  assert.equal(calls.length, 3);
  assert.match(calls[0], /current_cut:\s*same text/u);
  assert.match(calls[0], /next_cut:\s*different text/u);
  assert.match(calls[0], /previous_cut:\s*EMPTY/u);
  assert.match(calls[0], /shot_mode:\s*establishing wide shot/u);
  assert.match(calls[1], /current_cut:\s*same text/u);
  assert.match(calls[1], /next_cut:\s*different text/u);
  assert.match(calls[1], /previous_cut:\s*EMPTY/u);
  assert.match(calls[1], /shot_mode:\s*medium character-driven scene/u);
  assert.match(calls[2], /triad_positive_required_now:\s*truth/u);
  assert.match(calls[2], /triad_target_mode:\s*positive/u);
});

test("itinerary_promptify emits scene mode hints for negative positive and contrast cuts", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "promptify-"));
  const input = path.join(dir, "cuts.pya");
  const output = path.join(dir, "prompts.pya");
  await fs.writeFile(input, [
    "su name teaching cuts be series def",
    "su name cut 001 since num 0.000 until num 2.000 ob text \"families trapped in ruinous debt and foreclosure\" ya",
    "su name cut 002 since num 2.000 until num 4.000 ob text \"reform restored justice and ownership\" ya",
    "su name cut 003 since num 4.000 until num 6.000 ob text \"juxtaposed before and after conditions\" ya",
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
      json: async () => ({ message: { content: "ok prompt" } })
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

  assert.equal(calls.length, 3);
  assert.match(calls[0], /scene_mode_hint:\s*negative/u);
  assert.match(calls[1], /scene_mode_hint:\s*positive/u);
  assert.match(calls[2], /scene_mode_hint:\s*contrast/u);
  assert.match(calls[1], /solution_reference_hint:\s*truth/u);
  assert.match(calls[1], /triad_target_mode:\s*positive/u);
});
