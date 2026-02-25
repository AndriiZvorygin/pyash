import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember, remember } from "../program/remember/index.mjs";

test("promptify converts itinerary cuts into per-cut image prompts", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        { mood: "ya", su: { name: "cut 001" }, since: { num: 0 }, until: { num: 2 }, ob: { text: "pray daily" }, be: "cut" },
        { mood: "ya", su: { name: "cut 002" }, since: { num: 2 }, until: { num: 4 }, ob: { text: "serve others" }, be: "cut" }
      ]
    }
  });

  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const payload = JSON.parse(String(options?.body ?? "{}"));
    const user = Array.isArray(payload?.messages) ? payload.messages.at(-1)?.content ?? "" : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: `prompt:${user}` } })
    };
  };

  try {
    const sentence = parse(
      "su name prompt stage from name itinerary teaching cuts ob text \"Turn this cut into an image prompt.\" for name mind to name itinerary teaching draw prompts be promptify do"
    );
    await interpret(sentence);
    const resultFact = remember("result");
    assert.equal(resultFact?.be, "itinerary");
    const resultFilename = String(resultFact?.ob?.filename ?? "");
    assert.match(resultFilename, /artifacts\/(?:promptify\/[0-9]{14}-[0-9a-f]{6}|[0-9]{8}-[0-9]{3}-.+)\/.+\.series\.pya$/u);
    const manifestText = await fs.readFile(resultFilename, "utf8");
    assert.match(manifestText, /^su name teaching draw prompts be series def$/mu);
    const rows = Array.isArray(resultFact?.ob?.series) ? resultFact.ob.series : [];
    assert.equal(rows.length, 2);
    assert.match(String(rows[0]?.ob?.text ?? ""), /prompt:instruction:\s*Turn this cut into an image prompt\./u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /current_cut:\s*pray daily/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /previous_cut:\s*EMPTY/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /next_cut:\s*serve others/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /full_script:\s*pray daily serve others/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /pray daily/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /current_cut:\s*serve others/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /previous_cut:\s*pray daily/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /next_cut:\s*EMPTY/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /previous_prompt_1:\s*prompt:/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /previous_prompt_2:\s*EMPTY/u);
    assert.equal(Number(rows[0]?.since?.num ?? -1), 0);
    assert.equal(Number(rows[1]?.until?.num ?? -1), 4);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("promptify by num 0 disables prior prompt carryover", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        { mood: "ya", su: { name: "cut 001" }, since: { num: 0 }, until: { num: 2 }, ob: { text: "pray daily" }, be: "cut" },
        { mood: "ya", su: { name: "cut 002" }, since: { num: 2 }, until: { num: 4 }, ob: { text: "serve others" }, be: "cut" }
      ]
    }
  });

  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const payload = JSON.parse(String(options?.body ?? "{}"));
    const user = Array.isArray(payload?.messages) ? payload.messages.at(-1)?.content ?? "" : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: `prompt:${user}` } })
    };
  };

  try {
    const sentence = parse(
      "su name prompt stage from name itinerary teaching cuts ob text \"Turn this cut into an image prompt.\" for name mind to name itinerary teaching draw prompts by num 0 be promptify do"
    );
    await interpret(sentence);
    const resultFact = remember("result");
    const rows = Array.isArray(resultFact?.ob?.series) ? resultFact.ob.series : [];
    assert.equal(rows.length, 2);
    assert.match(String(rows[0]?.ob?.text ?? ""), /previous_prompt_1:\s*EMPTY/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /previous_prompt_2:\s*EMPTY/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /previous_prompt_1:\s*EMPTY/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /previous_prompt_2:\s*EMPTY/u);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("promptify accepts packet template placeholders from ob text", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "teaching cuts" },
    be: "itinerary",
    ob: {
      series: [
        { mood: "ya", su: { name: "cut 001" }, since: { num: 0 }, until: { num: 2 }, ob: { text: "first cut" }, be: "cut" },
        { mood: "ya", su: { name: "cut 002" }, since: { num: 2 }, until: { num: 4 }, ob: { text: "second cut" }, be: "cut" }
      ]
    }
  });

  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const payload = JSON.parse(String(options?.body ?? "{}"));
    const user = Array.isArray(payload?.messages) ? payload.messages.at(-1)?.content ?? "" : "";
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: `prompt:${user}` } })
    };
  };

  try {
    const sentence = parse(
      "su name prompt stage from name itinerary teaching cuts ob text quoted.text.CUR=[[current_cut]]|PREV=[[previous_cut]]|NEXT=[[next_cut]]|P1=[[previous_prompt_1]].text.quoted for name mind to name itinerary teaching draw prompts be promptify do"
    );
    await interpret(sentence);
    const rows = Array.isArray(remember("result")?.ob?.series) ? remember("result").ob.series : [];
    assert.equal(rows.length, 2);
    assert.match(String(rows[0]?.ob?.text ?? ""), /CUR=first cut/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /PREV=EMPTY/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /NEXT=second cut/u);
    assert.match(String(rows[0]?.ob?.text ?? ""), /P1=EMPTY/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /CUR=second cut/u);
    assert.match(String(rows[1]?.ob?.text ?? ""), /P1=prompt:CUR=first cut/u);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
