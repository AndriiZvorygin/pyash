import test from "node:test";
import assert from "node:assert/strict";

import discharge from "../program/verbs/discharge.mjs";
import { forget } from "../program/remember/index.mjs";

test("discharge as wo hear calls whisperx discharge endpoint", async () => {
  forget();
  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "whisperx" } };
    if (name === "hear host") return { ob: { text: "http://whisperx:8000" } };
    return null;
  };

  let called = false;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/discharge")) called = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    const result = await discharge({
      mood: "do",
      be: "discharge",
      as: { wo: "hear" }
    }, { remember });
    assert.equal(result?.be, "discharge");
    assert.equal(result?.as?.wo, "hear");
    assert.equal(called, true);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
