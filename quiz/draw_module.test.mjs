import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(text, { env } = {}) {
  const prevEnv = { ...process.env };
  if (env) Object.assign(process.env, env);
  try {
    const sentence = parse(text);
    return await interpret(sentence);
  } finally {
    process.env = prevEnv;
  }
}

function stubOllamaDischargeFetch() {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const asText = String(url);
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: asText, method, body });
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { models: [] };
        }
      };
    }
    if (asText.endsWith("/api/generate")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { response: "" };
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("draw fromstate wo text become wo image writes requested output", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  const fetchStub = stubOllamaDischargeFetch();
  try {
    await run("from filename \"./module/draw_comfyui.pya\" ob name draw to name draw be import do");
    await run("exists su name draw host ob text \"http://localhost:8188\" be default ya");
    await run("exists su name draw workflow default ob text \"Z-Image-TSV\" be default ya");
    const output = "quiz/sandpit/draw-output.png";
    await run(
      `ob text "a raven in pyash style" fromstate wo text become wo image to filename "${output}" be draw do`,
      { env: { PYA_DRAW_FIXTURE_FILE: "quiz/fixtures/pyash_raven.png" } }
    );
    const written = await fs.readFile(output);
    assert.ok(written.length > 0);
    assert.ok(fetchStub.calls.some(call => call.url.endsWith("/api/ps")));
  } finally {
    fetchStub.restore();
  }
});

test("draw fromstate wo text become wo image without output returns file path", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  const fetchStub = stubOllamaDischargeFetch();
  try {
    await run("from filename \"./module/draw_comfyui.pya\" ob name draw to name draw be import do");
    await run("exists su name draw host ob text \"http://localhost:8188\" be default ya");
    await run("exists su name draw workflow default ob text \"Z-Image-TSV\" be default ya");
    const result = await run(
      "ob text \"an educational schematic\" fromstate wo text become wo image be draw do",
      { env: { PYA_DRAW_FIXTURE_FILE: "quiz/fixtures/pyash_raven.png" } }
    );
    const filename = String(result?.result?.text ?? "").trim();
    assert.match(filename, /artifacts\/draw\/draw-/);
    const stat = await fs.stat(path.resolve(filename));
    assert.ok(stat.size > 0);
    assert.ok(fetchStub.calls.some(call => call.url.endsWith("/api/ps")));
  } finally {
    fetchStub.restore();
  }
});

test("draw supports fromtext system prompt with ob user prompt", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  const fetchStub = stubOllamaDischargeFetch();
  try {
    await run("from filename \"./module/draw_comfyui.pya\" ob name draw to name draw be import do");
    await run("exists su name draw host ob text \"http://localhost:8188\" be default ya");
    await run("exists su name draw workflow default ob text \"Z-Image-TSV\" be default ya");
    const output = "quiz/sandpit/draw-output-system.png";
    await run(
      `ob text "a city at dawn" fromtext text "watercolor style, muted palette" fromstate wo text become wo image to filename "${output}" be draw do`,
      { env: { PYA_DRAW_FIXTURE_FILE: "quiz/fixtures/pyash_raven.png" } }
    );
    const written = await fs.readFile(output);
    assert.ok(written.length > 0);
    assert.ok(fetchStub.calls.some(call => call.url.endsWith("/api/ps")));
  } finally {
    fetchStub.restore();
  }
});
