import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { splitSentencesWithLines } from "../program/library/sentenceSplitter.mjs";
import { state } from "../program/bridge/state.mjs";
import { forget } from "../program/remember/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.join(path.dirname(__filename), ".."));

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

async function loadDefaultConfig() {
  const configPath = path.resolve(repoRoot, "configure", "default.pya");
  const raw = await fs.readFile(configPath, "utf8");
  const lines = splitSentencesWithLines(raw);
  for (const entry of lines) {
    const trimmed = entry.text.trim();
    if (!trimmed) continue;
    state.currentSourceFilename = configPath;
    state.currentSourceLine = entry.line;
    const sentence = parse(trimmed);
    state.currentSourceSentence = sentence;
    await interpret(sentence);
  }
  state.currentSourceFilename = null;
  state.currentSourceLine = null;
  state.currentSourceSentence = null;
}

test("mind stream pulls live Ollama chunks", { skip: !process.env.PYA_OLLAMA_STREAM_TEST }, async () => {
  forget();
  await loadDefaultConfig();

  const originalStreamEnv = process.env.PYA_STREAM_STDOUT;
  process.env.PYA_STREAM_STDOUT = "1";
  const stream = await run('su name mind-stream ob text "Write five short sentences about rain. No bullet points." for name mind to name text mind-stream be write vyah stream do');
  if (originalStreamEnv === undefined) delete process.env.PYA_STREAM_STDOUT;
  else process.env.PYA_STREAM_STDOUT = originalStreamEnv;
  assert.equal(stream?.be, "stream");
  assert.equal(stream?.su?.name, "mind-stream");

  const first = await run("su name mind-stream vyah eval be chip do");
  assert.equal(first?.be, "chip");
  assert.equal(first?.atindex?.num, 0);
  assert.ok(first?.ob?.text?.length, "expected first chunk text");
  const lastIndex = first?.toindex?.num;
  assert.ok(typeof lastIndex === "number", "expected toindex on streamed chunk");

  if (lastIndex > 0) {
    const second = await run("su name mind-stream vyah eval be chip do");
    assert.equal(second?.atindex?.num, 1);
    assert.ok(second?.ob?.text?.length, "expected second chunk text");
  }
});
