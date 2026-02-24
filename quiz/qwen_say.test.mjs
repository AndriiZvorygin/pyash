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
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
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

test("splitQwenSayTextChunks splits long input sentence by sentence", () => {
  const longText = [
    "First sentence gives setup.",
    "Second sentence adds detail.",
    "Third sentence escalates stakes.",
    "Fourth sentence gives context.",
    "Fifth sentence closes the point."
  ].join(" ").repeat(8);
  const chunks = splitQwenSayTextChunks(longText);
  assert.ok(chunks.length > 8);
  assert.ok(chunks.every((chunk) => chunk.trim().length > 0));
});

test("qwenSay chunks long text and concatenates chunk outputs", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
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
  let seenGap = null;
  const runSayFn = async ({ text, output: chunkFile }) => {
    chunkInputs.push(String(text));
    await fs.writeFile(chunkFile, Buffer.from(`RIFF_chunk_${chunkInputs.length}`));
  };
  const concatAudioFn = async ({ inputs, output: outFile, gapSeconds }) => {
    concatCalled += 1;
    seenGap = gapSeconds;
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
    assert.equal(seenGap, 0.06);
    assert.ok(chunkInputs.length > 1);
    assert.ok(chunkInputs.every((entry) => entry.trim().length > 0));
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay uses configured inter-chunk silence gap", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say concat gap seconds" }, ob: { num: 0.12 }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-gap-out-"));
  const output = path.join(outDir, "out.wav");
  const longText = [
    "Sentence one with enough words to count as meaningful.",
    "Sentence two continues the same thought with a bit more detail.",
    "Sentence three adds context and pacing for the narration.",
    "Sentence four keeps the flow moving with more substance.",
    "Sentence five brings another concrete example to the script.",
    "Sentence six closes the paragraph while staying clear."
  ].join(" ").repeat(8);
  let seenGap = null;
  const runSayFn = async ({ output: chunkFile }) => {
    await fs.writeFile(chunkFile, Buffer.from("RIFF_gap_chunk"));
  };
  const concatAudioFn = async ({ output: outFile, gapSeconds }) => {
    seenGap = gapSeconds;
    await fs.writeFile(outFile, Buffer.from("RIFF_gap_concat"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: longText },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn }
    );
    assert.equal(seenGap, 0.12);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay keeps short text in a single synthesis call", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
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

test("qwenSay treats as text as tone override when it is not a workflow name", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-tone-out-"));
  const output = path.join(outDir, "out.wav");
  let seenInstruct = "";
  let seenWorkflow = "";
  const runSayFn = async ({ instruct, workflowName, output: chunkFile }) => {
    seenInstruct = String(instruct ?? "");
    seenWorkflow = String(workflowName ?? "");
    await fs.writeFile(chunkFile, Buffer.from("RIFF_tone"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        as: { text: "professional tone" },
        ob: { text: "This line should sound steady and clear." },
        to: { filename: output }
      },
      {
        runSayFn,
        pathExistsFn: async () => false
      }
    );
    assert.equal(seenInstruct, "professional tone");
    assert.equal(seenWorkflow, "andrii_teaching_voice_qwen3_TTS");
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay keeps as text workflow override when workflow exists", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-workflow-out-"));
  const output = path.join(outDir, "out.wav");
  let seenInstruct = "";
  let seenWorkflow = "";
  const runSayFn = async ({ instruct, workflowName, output: chunkFile }) => {
    seenInstruct = String(instruct ?? "");
    seenWorkflow = String(workflowName ?? "");
    await fs.writeFile(chunkFile, Buffer.from("RIFF_workflow"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        as: { text: "andrii_voice_qwen3_TTS" },
        ob: { text: "A short line for workflow check." },
        to: { filename: output }
      },
      {
        runSayFn,
        pathExistsFn: async () => true
      }
    );
    assert.equal(seenWorkflow, "andrii_voice_qwen3_TTS");
    assert.notEqual(seenInstruct, "andrii_voice_qwen3_TTS");
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay post-processes audio when enabled", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: true }, be: "default" });
  doRemember({
    mood: "ya",
    su: { name: "qwen say post process filter" },
    ob: { text: "highpass=f=60,acompressor=threshold=-20dB:ratio=3,alimiter=limit=-2dB" },
    be: "default"
  });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-postprocess-out-"));
  const output = path.join(outDir, "out.wav");
  let postProcessCalls = 0;
  let seenFilter = "";
  const runSayFn = async ({ output: chunkFile }) => {
    await fs.writeFile(chunkFile, Buffer.from("RIFF_postprocess_src"));
  };
  const postProcessFn = async ({ input, output: cleaned, filter }) => {
    postProcessCalls += 1;
    seenFilter = String(filter ?? "");
    await fs.copyFile(input, cleaned);
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "Short text for post process check." },
        to: { filename: output }
      },
      { runSayFn, postProcessFn }
    );
    assert.equal(postProcessCalls, 1);
    assert.equal(seenFilter, "highpass=f=60,acompressor=threshold=-20dB:ratio=3,alimiter=limit=-2dB");
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay skips post-processing when disabled", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-no-postprocess-out-"));
  const output = path.join(outDir, "out.wav");
  let postProcessCalls = 0;
  const runSayFn = async ({ output: chunkFile }) => {
    await fs.writeFile(chunkFile, Buffer.from("RIFF_no_postprocess_src"));
  };
  const postProcessFn = async () => {
    postProcessCalls += 1;
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "Short text for no post process check." },
        to: { filename: output }
      },
      { runSayFn, postProcessFn }
    );
    assert.equal(postProcessCalls, 0);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay promptify tone strategy plans per-sentence instructs on short text", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone strategy" }, ob: { text: "promptify" }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-tone-promptify-out-"));
  const output = path.join(outDir, "out.wav");
  const seenChunks = [];
  const seenInstructs = [];
  const runSayFn = async ({ text, instruct, output: chunkFile }) => {
    seenChunks.push(String(text ?? ""));
    seenInstructs.push(String(instruct ?? ""));
    await fs.writeFile(chunkFile, Buffer.from(`RIFF_promptify_${seenChunks.length}`));
  };
  const concatAudioFn = async ({ output: outFile }) => {
    await fs.writeFile(outFile, Buffer.from("RIFF_promptify_concat"));
  };
  const planChunkInstructsFn = async (chunks) => ({
    instructs: chunks.map((_, idx) => `tone ${idx + 1}`),
    strategy: "promptify"
  });
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "Sentence one. Sentence two? Sentence three." },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn, planChunkInstructsFn }
    );
    assert.ok(seenChunks.length >= 3);
    assert.deepEqual(seenInstructs.slice(0, 3), ["tone 1", "tone 2", "tone 3"]);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay promptify tone strategy falls back to compassionate teacher when planner fails", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone strategy" }, ob: { text: "promptify" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone default" }, ob: { text: "speak as a compassionate teacher" }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-tone-fallback-out-"));
  const output = path.join(outDir, "out.wav");
  const seenInstructs = [];
  const runSayFn = async ({ instruct, output: chunkFile }) => {
    seenInstructs.push(String(instruct ?? ""));
    await fs.writeFile(chunkFile, Buffer.from("RIFF_tone_fallback"));
  };
  const concatAudioFn = async ({ output: outFile }) => {
    await fs.writeFile(outFile, Buffer.from("RIFF_tone_fallback_concat"));
  };
  const planChunkInstructsFn = async () => ({
    instructs: [],
    strategy: "default-fallback"
  });
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "First line. Second line." },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn, planChunkInstructsFn }
    );
    assert.ok(seenInstructs.length >= 2);
    assert.ok(seenInstructs.every((value) => value === "speak as a compassionate teacher"));
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
