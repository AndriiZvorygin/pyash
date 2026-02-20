import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import hear from "../program/verbs/hear.mjs";
import { forget } from "../program/remember/index.mjs";

test("hear become wo srt uses whisperx backend and speaker diarize flag", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-whisperx-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.srt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");

  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "whisperx" } };
    if (name === "hear host") return { ob: { text: "http://whisperx:8000" } };
    if (name === "hear whisperx model") return { ob: { text: "large-v3" } };
    if (name === "hear language") return { ob: { text: "en" } };
    return null;
  };

  let diarizePayload = null;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body ?? "{}"));
    diarizePayload = body;
    await fs.writeFile(outputPath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");
    return {
      ok: true,
      json: async () => ({ output_srt: outputPath, model: "large-v3", diarize: true })
    };
  };
  try {
    const result = await hear({
      mood: "do",
      be: "hear",
      from: { filename: inputPath },
      to: { filename: outputPath },
      become: { wo: "srt" },
      as: { wo: "speaker" }
    }, { remember });
    assert.equal(result?.be, "hear");
    assert.equal(result?.ob?.filename, outputPath);
    assert.equal(Boolean(diarizePayload?.diarize), true);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
