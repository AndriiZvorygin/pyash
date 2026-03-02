import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import hear from "../program/verbs/hear.mjs";
import { forget } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";

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
  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body ?? "{}"));
    diarizePayload = body;
    await fs.writeFile(outputPath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");
    return {
      ok: true,
      json: async () => ({ output_srt: outputPath, model: "large-v3", diarize: true, stdout: "whisperx ok", stderr: "" })
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
    assert.ok(exchange.some((s) => s?.be === "hear" && s?.su?.name === "hear request whisperx"));
    assert.ok(exchange.some((s) => s?.be === "hear" && s?.su?.name === "hear result whisperx" && /whisperx ok/u.test(String(s?.totext?.text ?? ""))));
  } finally {
    globalThis.fetch = priorFetch;
    clearExchangeRecorder();
  }
});

test("hear become wo srt uses whisperx even when default backend is whisper", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-whisperx-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.srt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");

  const remember = (name) => {
    if (name === "hear backend default") return { ob: { text: "whisper" } };
    if (name === "hear host") return { ob: { text: "http://whisperx:8000" } };
    if (name === "hear whisperx model") return { ob: { text: "large-v3" } };
    if (name === "hear language") return { ob: { text: "en" } };
    return null;
  };

  let whisperxCalled = false;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, _options = {}) => {
    whisperxCalled = true;
    await fs.writeFile(outputPath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");
    return {
      ok: true,
      json: async () => ({ output_srt: outputPath, model: "large-v3", diarize: false, stdout: "whisperx ok", stderr: "" })
    };
  };
  try {
    const result = await hear({
      mood: "do",
      be: "hear",
      from: { filename: inputPath },
      to: { filename: outputPath },
      become: { wo: "srt" }
    }, { remember });
    assert.equal(result?.be, "hear");
    assert.equal(result?.ob?.filename, outputPath);
    assert.equal(whisperxCalled, true);
  } finally {
    globalThis.fetch = priorFetch;
    clearExchangeRecorder();
  }
});

test("hear whisperx streams progress logs when stream stdout is enabled", async () => {
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
    if (name === "stream stdout") return { ob: { boolean: true } };
    return null;
  };

  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const priorFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async (url, _options = {}) => {
    if (!/\/transcribe_stream$/u.test(String(url))) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    await fs.writeFile(outputPath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");
    const payload = [
      JSON.stringify({ type: "log", text: "Detecting language..." }),
      JSON.stringify({ type: "log", text: "Transcribing chunk 1/4" }),
      JSON.stringify({ type: "result", output_srt: outputPath, model: "large-v3", diarize: false })
    ].join("\n") + "\n";
    const chunks = [encoder.encode(payload)];
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (!chunks.length) return { done: true, value: undefined };
              return { done: false, value: chunks.shift() };
            }
          };
        }
      }
    };
  };
  try {
    const result = await hear({
      mood: "do",
      be: "hear",
      from: { filename: inputPath },
      to: { filename: outputPath },
      become: { wo: "srt" }
    }, { remember });
    assert.equal(result?.be, "hear");
    assert.ok(exchange.some((s) => s?.be === "hear" && s?.su?.name === "hear whisperx log" && /Detecting language/u.test(String(s?.ob?.text ?? ""))));
    assert.ok(exchange.some((s) => s?.be === "hear" && s?.su?.name === "hear whisperx log" && /chunk 1\/4/u.test(String(s?.ob?.text ?? ""))));
  } finally {
    globalThis.fetch = priorFetch;
    clearExchangeRecorder();
  }
});

test("hear vyah stream become wo srt uses whisperx transcribe_stream endpoint", async () => {
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
    if (name === "stream stdout") return { ob: { boolean: false } };
    return null;
  };

  let seenStreamEndpoint = false;
  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const priorFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async (url, _options = {}) => {
    if (/\/transcribe_stream$/u.test(String(url))) {
      seenStreamEndpoint = true;
      await fs.writeFile(outputPath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");
      const payload = [
        JSON.stringify({ type: "log", text: "Detecting language..." }),
        JSON.stringify({ type: "result", output_srt: outputPath, model: "large-v3", diarize: false })
      ].join("\n") + "\n";
      const chunks = [encoder.encode(payload)];
      return {
        ok: true,
        body: {
          getReader() {
            return {
              async read() {
                if (!chunks.length) return { done: true, value: undefined };
                return { done: false, value: chunks.shift() };
              }
            };
          }
        }
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    const result = await hear({
      mood: "do",
      be: "hear",
      from: { filename: inputPath },
      to: { filename: outputPath },
      become: { wo: "srt" },
      vyah: { ve: { type: "name", values: ["stream"] } }
    }, { remember });
    assert.equal(result?.be, "hear");
    assert.equal(result?.ob?.filename, outputPath);
    assert.equal(seenStreamEndpoint, true);
    assert.ok(exchange.some((s) => s?.be === "hear" && s?.su?.name === "hear whisperx log" && /Detecting language/u.test(String(s?.ob?.text ?? ""))));
  } finally {
    globalThis.fetch = priorFetch;
    clearExchangeRecorder();
  }
});
