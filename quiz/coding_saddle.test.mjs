import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { forget, remember } from "../program/remember/index.mjs";
import {
  buildSaddleMindSentence,
  createSaddleInputDecoder,
  discoverSaddleModels,
  formatSaddleModelPicker,
  formatSaddleStatus,
  resolveSaddleModelOption,
  resolveSaddleModelSelection
} from "../program/agent/coding_saddle.mjs";
import { prepareSaddle, runSaddleTurn } from "../command/pyash_saddle.mjs";

test("coding saddle submits Enter and keeps newline input separate", async () => {
  const submitted = [];
  const decoder = createSaddleInputDecoder({
    onSubmit: async (value) => submitted.push(value)
  });

  decoder.feed("one");
  decoder.feed("\u001b[13;2u");
  decoder.feed("two\r");

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submitted, ["one\ntwo"]);
  assert.equal(decoder.getState().value, "");
});

test("coding saddle supports cursor editing and control actions", () => {
  const events = [];
  const decoder = createSaddleInputDecoder({
    onCancel: () => events.push("cancel"),
    onExit: () => events.push("exit")
  });

  decoder.feed("abc\u001b[D\u001b[D\u007f");
  assert.equal(decoder.getState().value, "bc");
  assert.equal(decoder.getState().cursor, 0);
  decoder.feed("\u0003\u0004");
  assert.deepEqual(events, ["cancel", "exit"]);
});

test("coding saddle builds a Pyash mind call with backend and session context", () => {
  const sentence = buildSaddleMindSentence({
    input: "inspect the current file",
    model: "qwen3.8:27b",
    backend: "ollama",
    host: "http://mriczo:11434",
    sessionName: "coding"
  });

  assert.equal(sentence.be, "write");
  assert.equal(sentence.for.name, "coding saddle");
  assert.equal(sentence.with.name, "saddle tools");
  assert.equal(sentence.fromstate.text, "ollama");
  assert.equal(sentence.from.text, "http://mriczo:11434");
  assert.equal(sentence.fromtext.name, "session name coding");
});

test("coding saddle delegates turns to the existing mind engine", async () => {
  let observed = null;
  const result = await runSaddleTurn({
    input: "run the focused test",
    model: "qwen3.5:9b",
    backend: "ollama",
    host: "http://localhost:11434",
    mindFn: async (sentence, options) => {
      observed = { sentence, options };
      return { mood: "ya", be: "text", ob: { text: "done" } };
    }
  });

  assert.equal(result.ob.text, "done");
  assert.equal(observed.sentence.ob.text, "run the focused test");
  assert.equal(observed.sentence.fromstate.text, "ollama");
  assert.equal(observed.options.sessionUserContent, "run the focused test");
});

test("duty saddle keeps runtime root separate from its persistent world root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-roots-"));
  const cwd = path.join(root, "project");
  const worldRoot = path.join(root, "state", "world");
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await fs.mkdir(cwd, { recursive: true });
  try {
    await prepareSaddle({
      cwd,
      runtimeRoot,
      worldRoot,
      model: "qwen3.5:9b",
      backend: "ollama",
      host: "http://localhost:11434"
    });
    assert.equal(remember("run root")?.ob?.filename, runtimeRoot);
    assert.equal(remember("world root")?.ob?.filename, worldRoot);
  } finally {
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle status exposes provider and queue state", () => {
  const status = formatSaddleStatus({
    model: "qwen3.8:27b",
    backend: "strata",
    host: "http://swac:8090",
    cwd: "/tmp/project",
    queue: { total: 3 },
    busy: true
  });

  assert.match(status, /model: qwen3\.8:27b/);
  assert.match(status, /backend: strata/);
  assert.match(status, /gpu queue: 3/);
  assert.match(status, /state: running/);
});

test("coding saddle discovers and selects models from the active backend", async () => {
  const ollama = await discoverSaddleModels({
    backend: "ollama",
    host: "http://mriczo:11434",
    currentModel: "qwen3.5:9b",
    fetchFn: async (url) => {
      assert.equal(url, "http://mriczo:11434/api/tags");
      return { ok: true, async json() { return { models: [{ name: "qwen3.5:9b" }, { name: "qwen3.8:27b" }] }; } };
    }
  });

  assert.deepEqual(ollama.models, ["qwen3.5:9b", "qwen3.8:27b"]);
  assert.equal(resolveSaddleModelSelection("2", ollama.models), "qwen3.8:27b");
  assert.match(formatSaddleModelPicker({ models: ollama.models, currentModel: ollama.models[0] }), /1\. qwen3\.5:9b \(current\)/);
});

test("coding saddle preserves the current model when catalogue discovery fails", async () => {
  const result = await discoverSaddleModels({
    backend: "strata",
    host: "http://swac:8081",
    currentModel: "qwen3.8:27b",
    fetchFn: async () => { throw new Error("connection refused"); }
  });

  assert.deepEqual(result.models, ["qwen3.8:27b"]);
  assert.equal(result.available, false);
  assert.equal(resolveSaddleModelSelection("qwen3.8:27b", result.models), "qwen3.8:27b");
});

test("coding saddle picker keeps Strata targets distinct from Ollama models", () => {
  const options = [
    { value: "qwen3.5:9b", model: "qwen3.5:9b", backend: "ollama" },
    { value: "strata::qwen3.8-flash-next-coder-iq1_m", model: "qwen3.8-flash-next-coder-iq1_m", backend: "strata", host: "http://swac:8081", label: "Strata: qwen3.8-flash-next-coder-iq1_m" }
  ];
  const picker = formatSaddleModelPicker({ models: options, currentModel: "qwen3.5:9b", currentBackend: "ollama" });
  assert.match(picker, /2\. Strata: qwen3\.8-flash-next-coder-iq1_m @ http:\/\/swac:8081/);
  assert.deepEqual(resolveSaddleModelOption("2", options), options[1]);
});
