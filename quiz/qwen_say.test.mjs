import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { normalizeQwenSayChunkText, qwenSay, sanitizeQwenSayScriptText, splitQwenSayTextChunks } from "../program/verbs/qwen_say.mjs";

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
    const promptSeriesPath = path.resolve("artifacts/say/section-say-prompts.series.pya");
    const promptSeriesText = await fs.readFile(promptSeriesPath, "utf8");
    assert.match(promptSeriesText, /su name section say prompts be series def/u);
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

test("qwen say fails fast for hollow input", async () => {
  forget();
  await assert.rejects(
    async () => interpret(parse("ob hollow be qwen say do")),
    /qwen say input hollow error/u
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

test("splitQwenSayTextChunks does not emit quote-only chunk from closing quote punctuation", () => {
  const text = "Instead of restoring land and dignity, they claimed “Canadians won’t enlist.”";
  const chunks = splitQwenSayTextChunks(text, { forceSentenceChunks: true });
  assert.equal(chunks.length, 1);
  assert.match(String(chunks[0] ?? ""), /won.t enlist/u);
  assert.doesNotMatch(String(chunks[0] ?? ""), /^["'“”’)\].,!?\s]+$/u);
});

test("normalizeQwenSayChunkText appends an extra terminal period", () => {
  assert.equal(normalizeQwenSayChunkText("No final marker"), "No final marker..");
  assert.equal(normalizeQwenSayChunkText("Already complete."), "Already complete..");
  assert.equal(normalizeQwenSayChunkText("Question?"), "Question?.");
});

test("sanitizeQwenSayScriptText rewrites numeric colons used in citations", () => {
  assert.equal(
    sanitizeQwenSayScriptText("God is love (1st John 4:8)."),
    "God is love (first John four point eight)."
  );
  assert.equal(
    sanitizeQwenSayScriptText("Matthew 5 : 16 and Mark 11:26"),
    "Matthew five point sixteen and Mark eleven point twenty six"
  );
  assert.equal(sanitizeQwenSayScriptText("God’s 50% promise"), "God's fifty percent promise");
  assert.match(sanitizeQwenSayScriptText("don't remove apostrophes"), /don't/u);
  assert.equal(sanitizeQwenSayScriptText("In 2026 we compare 1975 and 476."), "In twenty-twenty-six we compare nineteen-seventy-five and four-seventy-six.");
  assert.equal(sanitizeQwenSayScriptText("Budget is 65,000 now."), "Budget is sixty-five-thousand now.");
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
    const promptSeriesPath = path.join(outDir, "section-say-prompts.series.pya");
    const promptSeriesText = await fs.readFile(promptSeriesPath, "utf8");
    assert.match(promptSeriesText, /su name section say prompts be series def/u);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay appends sentence end marker for chunked text without punctuation", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-punc-out-"));
  const output = path.join(outDir, "out.wav");
  const longNoPunctuation = ("this chunk has no punctuation and keeps going ").repeat(70).trim();
  const seenTexts = [];
  const runSayFn = async ({ text, output: chunkFile }) => {
    seenTexts.push(String(text ?? ""));
    await fs.writeFile(chunkFile, Buffer.from("RIFF_punc_chunk"));
  };
  const concatAudioFn = async ({ output: outFile }) => {
    await fs.writeFile(outFile, Buffer.from("RIFF_punc_concat"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: longNoPunctuation },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn }
    );
    assert.ok(seenTexts.length > 1);
    assert.ok(seenTexts.every((value) => value.trim().endsWith(".")));
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

test("qwenSay sanitizes numeric citation colons before synthesis", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-citation-sanitize-out-"));
  const output = path.join(outDir, "out.wav");
  const seenTexts = [];
  const runSayFn = async ({ text, output: chunkFile }) => {
    seenTexts.push(String(text ?? ""));
    await fs.writeFile(chunkFile, Buffer.from("RIFF_citation"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: "God is love (1st John 4:8). Let your light shine (Matthew 5:16)." },
        to: { filename: output }
      },
      { runSayFn }
    );
    assert.equal(seenTexts.length, 1);
    assert.match(seenTexts[0], /four point eight/u);
    assert.match(seenTexts[0], /five point sixteen/u);
    assert.match(seenTexts[0], /\.\.$/u);
    assert.doesNotMatch(seenTexts[0], /\d:\d/u);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("sanitizeQwenSayScriptText uses map overrides when provided", () => {
  const text = sanitizeQwenSayScriptText("1st John 4:8 is 50%", {
    ordinal1st: "First",
    pointWord: "dot",
    percent: "pct"
  });
  assert.equal(text, "First John four dot eight is fifty pct");
});

test("splitQwenSayTextChunks does not split chapter verse references into numeric fragments", () => {
  const source = [
    "God is love 1st John 4.8.",
    "The unveiling of God is Christ in you Colossians 1.27, the true light John 1.9, revealing love.",
    "You are God's temple 1st Corinthians 3.16, light of the world Matthew 5.14, salt of the earth Matthew 5.13."
  ].join(" ").repeat(6);
  const chunks = splitQwenSayTextChunks(source);
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].startsWith("God is love"), true);
  assert.equal(chunks.some((chunk) => /^\d+[.,]?\s*$/.test(chunk.trim())), false);
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

test("qwenSay applies planner instructs when chunked synthesis is used", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone strategy" }, ob: { text: "heuristic" }, be: "default" });
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
    const longText = Array.from({ length: 170 }, (_, idx) => `word${idx + 1}`).join(" ");
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: longText },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn, planChunkInstructsFn }
    );
    assert.ok(seenChunks.length >= 2);
    assert.equal(seenInstructs[0], "tone 1");
    assert.equal(seenInstructs[1], "tone 2");
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("qwenSay falls back to heuristic instructs when planner returns empty", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone strategy" }, ob: { text: "heuristic" }, be: "default" });
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
    const longText = Array.from({ length: 180 }, (_, idx) => `line${idx + 1}`).join(" ");
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        ob: { text: longText },
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

test("qwenSay uses tone manifest instructs from from filename", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say post process" }, ob: { boolean: false }, be: "default" });
  doRemember({ mood: "ya", su: { name: "qwen say tone strategy" }, ob: { text: "heuristic" }, be: "default" });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-tone-manifest-out-"));
  const output = path.join(outDir, "out.wav");
  const manifest = path.join(outDir, "section-tone-prompts.series.pya");
  await fs.writeFile(
    manifest,
    [
      "su name section tone prompts be series def",
      "su name cut 001 since num 0.000 until num 1.000 ob text \"Warm teacher, moderate pace, crisp articulation, brief pauses, gentle emphasis.\" ya",
      "su name cut 002 since num 1.000 until num 2.000 ob text \"Serious teacher, steady pace, clear articulation, brief pauses, stronger emphasis on warning terms.\" ya",
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );
  const seenInstructs = [];
  const runSayFn = async ({ instruct, output: chunkFile }) => {
    seenInstructs.push(String(instruct ?? ""));
    await fs.writeFile(chunkFile, Buffer.from("RIFF_tone_manifest"));
  };
  const concatAudioFn = async ({ output: outFile }) => {
    await fs.writeFile(outFile, Buffer.from("RIFF_tone_manifest_concat"));
  };
  try {
    await qwenSay(
      {
        mood: "do",
        be: "qwen say",
        su: { name: "voice" },
        from: { filename: manifest },
        ob: { text: "Sentence one. Sentence two." },
        to: { filename: output }
      },
      { runSayFn, concatAudioFn }
    );
    assert.equal(seenInstructs.length, 2);
    assert.match(seenInstructs[0], /Warm teacher/u);
    assert.match(seenInstructs[1], /Serious teacher/u);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
