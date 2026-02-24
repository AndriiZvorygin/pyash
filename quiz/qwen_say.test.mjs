import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { qwenSay, splitQwenSayTextChunks } from "../program/verbs/qwen_say.mjs";

test("qwen say fixture records audio and metadata artifacts", async () => {
  forget();
  const records = [];
  setExchangeRecorder({
    runRoot: process.cwd(),
    record: (sentence) => records.push(sentence)
  });
  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://localhost:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow root" }, ob: { text: "./say/" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow default" }, ob: { text: "andrii_voice_qwen3_TTS" }, be: "default" });
  process.env.PYA_SAY_COMFYUI_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    await interpret(parse('su name voice ob text "hello from qwen say" be qwen say do'));
    const stored = remember("voice");
    assert.equal(stored?.be, "say");
    assert.ok(stored?.ob?.name, "returns artifact name");
    const audio = records.find(s => s.be === "artifact" && s.as?.name === "say");
    const metadata = records.find(s => s.be === "artifact" && s.as?.name === "metadata");
    assert.ok(audio, "records audio artifact");
    assert.ok(metadata, "records metadata artifact");
  } finally {
    delete process.env.PYA_SAY_COMFYUI_FIXTURE_FILE;
    clearExchangeRecorder();
  }
});

test("qwen say fails fast when text path is unresolved", async () => {
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-"));
  const workflowRoot = path.join(tmp, "say");
  const backendRoot = path.join(workflowRoot, "comfyui");
  await fs.mkdir(backendRoot, { recursive: true });
  const workflow = {
    nodes: [
      {
        id: 1,
        type: "NodeWithoutText",
        inputs: [{ name: "seed", type: "INT", widget: { name: "seed" }, link: null }],
        widgets_values: [1]
      }
    ],
    links: []
  };
  await fs.writeFile(path.join(backendRoot, "missing_text.json"), JSON.stringify(workflow), "utf8");

  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://localhost:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow root" }, ob: { text: workflowRoot }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow default" }, ob: { text: "missing_text" }, be: "default" });

  await assert.rejects(
    async () => interpret(parse('ob text "hello" be qwen say do')),
    /text path unresolved/
  );
});

test("splitQwenSayTextChunks keeps short text as one chunk", () => {
  const chunks = splitQwenSayTextChunks("One short paragraph with a couple sentences. Nothing too long.");
  assert.equal(chunks.length, 1);
});

test("qwenSay chunks long text and concatenates chunk outputs", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-chunk-out-"));
  const output = path.join(outDir, "out.wav");
  const longText = [
    "Sentence one with enough words to count as meaningful.",
    "Sentence two continues the same thought with a bit more detail.",
    "Sentence three adds context and pacing for the narration.",
    "Sentence four keeps the flow moving with more substance.",
    "Sentence five brings another concrete example to the script.",
    "Sentence six closes the paragraph while staying clear."
  ].join(" ").repeat(8);

  const chunkInputs = [];
  let concatCalled = 0;
  const runSayFn = async ({ text, output: chunkFile }) => {
    chunkInputs.push(String(text));
    await fs.writeFile(chunkFile, Buffer.from(`RIFF_chunk_${chunkInputs.length}`));
  };
  const concatAudioFn = async ({ inputs, output: outFile }) => {
    concatCalled += 1;
    assert.ok(Array.isArray(inputs));
    assert.ok(inputs.length > 1);
    await fs.writeFile(outFile, Buffer.from("RIFF_concat_out"));
  };

  try {
    const result = await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: longText },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn }
    );
    assert.equal(result?.be, "say");
    assert.equal(concatCalled, 1);
    assert.ok(chunkInputs.length > 1);
    assert.ok(chunkInputs.every((entry) => entry.trim().length > 0));
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay keeps short text in a single synthesis call", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-short-out-"));
  const output = path.join(outDir, "out.wav");
  let runCalls = 0;
  let concatCalls = 0;
  const runSayFn = async ({ output: chunkFile }) => {
    runCalls += 1;
    await fs.writeFile(chunkFile, Buffer.from("RIFF_short"));
  };
  const concatAudioFn = async () => {
    concatCalls += 1;
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "Short text only." },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn }
    );
    assert.equal(runCalls, 1);
    assert.equal(concatCalls, 0);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
