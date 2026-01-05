import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("piper say fixture records audio and metadata artifacts", async () => {
  forget();
  const records = [];
  setExchangeRecorder({
    runRoot: process.cwd(),
    record: (sentence) => records.push(sentence)
  });
  process.env.PYA_PIPER_FIXTURE = "fixture-audio";
  process.env.PYA_SAY_SILENT = "1";
  try {
    await interpret(parse('su name voice ob text "hello" be piper say do'));
    const stored = remember("voice");
    assert.equal(stored?.be, "say");
    assert.ok(stored?.ob?.name, "returns artifact name");
    const audio = records.find(s => s.be === "artifact" && s.as?.name === "say");
    const metadata = records.find(s => s.be === "artifact" && s.as?.name === "metadata");
    assert.ok(audio, "records audio artifact");
    assert.ok(metadata, "records metadata artifact");
  } finally {
    delete process.env.PYA_PIPER_FIXTURE;
    delete process.env.PYA_SAY_SILENT;
    clearExchangeRecorder();
  }
});
