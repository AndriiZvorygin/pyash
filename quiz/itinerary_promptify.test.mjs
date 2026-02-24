import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { main, buildPromptifyPacket } from "../command/itinerary_promptify.mjs";

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
  assert.match(calls[0], /instruction:\s*Turn this transcript cut into one concise visual image prompt for generation\./u);
  assert.match(calls[0], /previous_cut:\s*EMPTY/u);
  assert.match(calls[0], /current_cut:\s*first cut text/u);
  assert.match(calls[0], /next_cut:\s*second cut text/u);
  assert.match(calls[0], /full_script:\s*first cut text second cut text/u);
  assert.match(calls[0], /previous_prompt_1:\s*EMPTY/u);
  assert.match(calls[0], /previous_prompt_2:\s*EMPTY/u);
  assert.match(calls[1], /current_cut:\s*second cut text/u);
  assert.match(calls[1], /previous_cut:\s*first cut text/u);
  assert.match(calls[1], /next_cut:\s*EMPTY/u);
  assert.match(calls[1], /previous_prompt_1:\s*visual prompt for/u);
  assert.match(calls[1], /previous_prompt_2:\s*EMPTY/u);
  const outputText = await fs.readFile(output, "utf8");
  assert.match(outputText, /visual prompt for instruction:/u);
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
  assert.match(calls[0], /next_cut:\s*same text/u);
  assert.match(calls[0], /previous_cut:\s*EMPTY/u);
  assert.match(calls[1], /current_cut:\s*same text/u);
  assert.match(calls[1], /next_cut:\s*different text/u);
  assert.match(calls[1], /previous_cut:\s*same text/u);
  assert.match(calls[2], /previous_prompt_1:\s*ok prompt/u);
  assert.match(calls[2], /previous_prompt_2:\s*ok prompt/u);
});

test("itinerary_promptify carries raw cut fields for each request", async () => {
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
  assert.match(calls[0], /current_cut:\s*families trapped in ruinous debt and foreclosure/u);
  assert.match(calls[1], /current_cut:\s*reform restored justice and ownership/u);
  assert.match(calls[2], /current_cut:\s*juxtaposed before and after conditions/u);
  assert.match(calls[2], /previous_prompt_1:\s*ok prompt/u);
  assert.match(calls[2], /previous_prompt_2:\s*ok prompt/u);
});

test("buildPromptifyPacket renders caller-provided placeholder template", () => {
  const packet = buildPromptifyPacket({
    cuts: [
      { obText: "first cut" },
      { obText: "second cut" }
    ],
    index: 1,
    instruction: "ignored in this template",
    fullScript: "first cut second cut",
    previousPrompts: ["first prompt"],
    packetTemplate: "CUT=[[current_cut]]|PREV=[[previous_cut]]|NEXT=[[next_cut]]|SCRIPT=[[full_script]]|P1=[[previous_prompt_1]]|P2=[[previous_prompt_2]]"
  });
  assert.equal(
    packet,
    "CUT=second cut|PREV=first cut|NEXT=EMPTY|SCRIPT=first cut second cut|P1=first prompt|P2=EMPTY"
  );
});

test("itinerary_promptify main accepts --packet template override", async () => {
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
      "qwen3-vl:8b-instruct",
      "--packet",
      "CUT:[[current_cut]]|PREV:[[previous_cut]]|NEXT:[[next_cut]]|P1:[[previous_prompt_1]]"
    ]);
  } finally {
    globalThis.fetch = priorFetch;
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0], /CUT:first cut text/u);
  assert.match(calls[0], /PREV:EMPTY/u);
  assert.match(calls[1], /CUT:second cut text/u);
  assert.match(calls[1], /P1:visual prompt for CUT:first cut text/u);
});
