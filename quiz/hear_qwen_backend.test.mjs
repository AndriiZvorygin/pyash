import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import hear from "../program/verbs/hear.mjs";
import { forget } from "../program/remember/index.mjs";
import { parseQwenTimestampSegments, segmentsToSrt } from "../program/verbs/hear/qwen_comfyui.mjs";
import { mergeQwenChunkSegments, planChunkWindows, transcribeWithQwenComfyuiChunked } from "../program/verbs/hear/qwen_chunked.mjs";

test("qwen timestamp parser handles json segments and renders srt", () => {
  const raw = JSON.stringify([
    { start: 0.12, end: 1.8, text: "hello world" },
    { start: 1.9, end: 3.4, text: "next line" }
  ]);
  const segments = parseQwenTimestampSegments(raw, "");
  assert.equal(segments.length, 2);
  const srt = segmentsToSrt(segments, "");
  assert.match(srt, /00:00:00,120 --> 00:00:01,800/u);
  assert.match(srt, /hello world/u);
});

test("qwen timestamp parser fills missing text from transcript lines", () => {
  const raw = "[0.00,1.00]\n[1.00,2.50]";
  const segments = parseQwenTimestampSegments(raw, "first line\nsecond line");
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "first line");
  assert.equal(segments[1].text, "second line");
});

test("qwen timestamp parser reads inline timestamp transcript lines", () => {
  const transcript = "0.32-0.56: And\n0.64-0.96: so";
  const segments = parseQwenTimestampSegments("", transcript);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "And");
  const srt = segmentsToSrt(segments, transcript);
  assert.match(srt, /00:00:00,320 --> 00:00:00,560/u);
});

test("hear backend qwen writes srt output from chunked payload", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hear-qwen-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.srt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");

  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "qwen" } };
    if (name === "hear qwen host") return { ob: { text: "http://localhost:8188" } };
    if (name === "hear workflow root") return { ob: { text: "./hear/" } };
    if (name === "hear workflow default") return { ob: { text: "qwen3-asr-timestamps-attn2" } };
    if (name === "hear language") return { ob: { text: "English" } };
    return null;
  };

  const result = await hear({
    mood: "do",
    be: "hear",
    from: { filename: inputPath },
    to: { filename: outputPath },
    become: { wo: "srt" }
  }, {
    remember,
    transcribeQwenFn: async () => {
      throw new Error("direct qwen path should not run for srt");
    },
    transcribeQwenChunkedFn: async () => ({
      transcript: "hello world",
      timestampsRaw: '[{"start":0,"end":1.25,"text":"hello world"}]',
      srt: "1\n00:00:00,000 --> 00:00:01,250\nhello world\n",
      chunkCount: 1
    })
  });

  assert.equal(result?.be, "hear");
  assert.equal(result?.ob?.filename, outputPath);
  const srt = await fs.readFile(outputPath, "utf8");
  assert.match(srt, /00:00:01,250/u);
  assert.match(srt, /hello world/u);
});

test("qwen chunk window planner uses overlap and full coverage", () => {
  const windows = planChunkWindows(1000, { maxChunkSeconds: 300, overlapSeconds: 2 });
  assert.equal(windows[0].startSeconds, 0);
  assert.ok(windows.length >= 4);
  assert.equal(windows[windows.length - 1].endSeconds, 1000);
  assert.ok(windows[1].startSeconds < windows[0].endSeconds);
});

test("qwen chunk segment merge removes overlap duplicates", () => {
  const merged = mergeQwenChunkSegments([
    {
      startSeconds: 0,
      segments: [
        { start: 0, end: 4, text: "hello there" },
        { start: 4, end: 8, text: "general kenobi" }
      ]
    },
    {
      startSeconds: 7,
      segments: [
        { start: 0, end: 3, text: "general kenobi" },
        { start: 3, end: 6, text: "you are a bold one" }
      ]
    }
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].text, "hello there");
  assert.equal(merged[1].text, "general kenobi");
  assert.equal(merged[2].text, "you are a bold one");
  assert.ok(merged[2].start >= merged[1].end);
});

test("hear backend qwen uses chunked path for srt output", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hear-qwen-chunk-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.srt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");

  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "qwen" } };
    if (name === "hear qwen host") return { ob: { text: "http://localhost:8188" } };
    if (name === "hear workflow root") return { ob: { text: "./hear/" } };
    if (name === "hear workflow default") return { ob: { text: "qwen3-asr-timestamps-attn2" } };
    if (name === "hear language") return { ob: { text: "English" } };
    if (name === "hear qwen chunk max seconds") return { ob: { num: 240 } };
    if (name === "hear qwen chunk overlap seconds") return { ob: { num: 1.5 } };
    return null;
  };

  let chunkedCalled = false;
  let directCalled = false;
  const result = await hear({
    mood: "do",
    be: "hear",
    from: { filename: inputPath },
    to: { filename: outputPath },
    become: { wo: "srt" }
  }, {
    remember,
    transcribeQwenFn: async () => {
      directCalled = true;
      throw new Error("direct qwen path should not run for srt");
    },
    transcribeQwenChunkedFn: async () => {
      chunkedCalled = true;
      return {
        transcript: "hello\nworld",
        timestampsRaw: '[{"start":0,"end":1.2,"text":"hello"},{"start":1.2,"end":2.4,"text":"world"}]',
        srt: "1\n00:00:00,000 --> 00:00:01,200\nhello\n\n2\n00:00:01,200 --> 00:00:02,400\nworld\n",
        chunkCount: 2
      };
    }
  });

  assert.equal(chunkedCalled, true);
  assert.equal(directCalled, false);
  assert.equal(result?.be, "hear");
  assert.equal(result?.ob?.filename, outputPath);
  const srt = await fs.readFile(outputPath, "utf8");
  assert.match(srt, /00:00:02,400/u);
  assert.match(srt, /world/u);
});

test("qwen chunked transcribe reports each chunk via callback", async () => {
  const chunks = [];
  const result = await transcribeWithQwenComfyuiChunked({
    inputPath: "/tmp/fake.wav",
    host: "http://localhost:8188",
    workflowRoot: "./hear/",
    workflowName: "qwen3-asr-timestamps-attn2",
    maxChunkSeconds: 4,
    overlapSeconds: 1,
    probeDurationFn: async () => 10,
    renderChunkFn: async () => {},
    transcribeFn: async ({ inputPath }) => ({
      transcript: `piece:${inputPath}`,
      segments: [{ start: 0, end: 1, text: "piece" }]
    }),
    onChunk: (row) => chunks.push(row)
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[2].index, 2);
  assert.equal(chunks[2].total, 3);
  assert.equal(result.chunkCount, 3);
});

test("hear backend qwen chunk fallback keeps plain transcript for text output", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hear-qwen-chunk-text-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.txt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");

  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "qwen" } };
    if (name === "hear qwen host") return { ob: { text: "http://localhost:8188" } };
    if (name === "hear workflow root") return { ob: { text: "./hear/" } };
    if (name === "hear workflow default") return { ob: { text: "qwen3-asr-timestamps-attn2" } };
    return null;
  };

  const result = await hear({
    mood: "do",
    be: "hear",
    from: { filename: inputPath },
    to: { filename: outputPath }
  }, {
    remember,
    transcribeQwenFn: async () => {
      throw new Error("Qwen3ASRTranscribe: Allocation on device 0 would exceed allowed memory. (out of memory)");
    },
    transcribeQwenChunkedFn: async ({ returnTimestamps, useSegmentsForTranscript }) => {
      assert.equal(returnTimestamps, true);
      assert.equal(useSegmentsForTranscript, false);
      return {
        transcript: "first sentence\nsecond sentence",
        timestampsRaw: "",
        srt: "",
        chunkCount: 2
      };
    }
  });

  assert.equal(result?.be, "hear");
  assert.equal(result?.ob?.text, "first sentence\nsecond sentence");
  const text = await fs.readFile(outputPath, "utf8");
  assert.equal(text, "first sentence\nsecond sentence");
});

test("qwen chunked plain transcript strips inline timestamp tokens", async () => {
  const result = await transcribeWithQwenComfyuiChunked({
    inputPath: "/tmp/fake.wav",
    host: "http://localhost:8188",
    workflowRoot: "./hear/",
    workflowName: "qwen3-asr-timestamps-attn2",
    maxChunkSeconds: 4,
    overlapSeconds: 1,
    probeDurationFn: async () => 10,
    renderChunkFn: async () => {},
    transcribeFn: async () => ({
      transcript: "0.10-0.40: Hello 0.40-0.80: world",
      segments: [{ start: 0.1, end: 0.8, text: "Hello world" }]
    }),
    useSegmentsForTranscript: false
  });
  assert.equal(result.transcript, "Hello world");
});

test("qwen chunked text mode uses plain transcript pass when timestamped transcript is returned", async () => {
  const calls = [];
  const result = await transcribeWithQwenComfyuiChunked({
    inputPath: "/tmp/fake.wav",
    host: "http://localhost:8188",
    workflowRoot: "./hear/",
    workflowName: "qwen3-asr-timestamps-attn2",
    maxChunkSeconds: 4,
    overlapSeconds: 1,
    probeDurationFn: async () => 10,
    renderChunkFn: async () => {},
    transcribeFn: async ({ returnTimestamps, inputPath }) => {
      calls.push({ returnTimestamps, inputPath });
      if (returnTimestamps) {
        return {
          transcript: "0.10-0.40: Hello 0.40-0.80: world",
          timestampsRaw: '[{"start":0.1,"end":0.8,"text":"Hello world"}]',
          segments: [{ start: 0.1, end: 0.8, text: "Hello world" }]
        };
      }
      return {
        transcript: "Hello world",
        timestampsRaw: "",
        segments: []
      };
    },
    useSegmentsForTranscript: false
  });

  const plainCalls = calls.filter(call => call.returnTimestamps === false);
  const timedCalls = calls.filter(call => call.returnTimestamps === true);
  assert.equal(timedCalls.length, 3);
  assert.equal(plainCalls.length, 3);
  assert.equal(result.transcript, "Hello world");
});
