import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import hear from "../program/verbs/hear.mjs";
import { forget } from "../program/remember/index.mjs";
import { parseQwenTimestampSegments, segmentsToSrt } from "../program/verbs/hear/qwen_comfyui.mjs";

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

test("hear backend qwen writes srt output from qwen payload", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-qwen-"));
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
    transcribeQwenFn: async () => ({
      transcript: "hello world",
      timestampsRaw: "[0.00,1.25] hello world",
      srt: "1\n00:00:00,000 --> 00:00:01,250\nhello world\n"
    })
  });

  assert.equal(result?.be, "hear");
  assert.equal(result?.ob?.filename, outputPath);
  const srt = await fs.readFile(outputPath, "utf8");
  assert.match(srt, /00:00:01,250/u);
  assert.match(srt, /hello world/u);
});
