import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { allRemember, forget, remember } from "../program/remember/index.mjs";
import {
  buildSaddleMindSentence,
  createSaddleInputDecoder,
  discoverSaddleModels,
  formatSaddleModelPicker,
  formatSaddleStatus,
  listSaddleMindNames,
  parseSaddleMindCommand,
  resolveSaddleModelOption,
  resolveSaddleModelSelection,
  resolveSaddleMindProfile
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
    contextWindow: 131072,
    sessionName: "coding"
  });

  assert.equal(sentence.be, "write");
  assert.equal(sentence.for.name, "coding saddle");
  assert.equal(sentence.with.name, "saddle tools");
  assert.equal(sentence.fromstate.text, "ollama");
  assert.equal(sentence.from.text, "http://mriczo:11434");
  assert.equal(sentence.contextWindow, 131072);
  assert.equal(sentence.fromtext.name, "session name coding");
});

test("coding saddle delegates turns to the existing mind engine", async () => {
  let observed = null;
  let observedUsage = null;
  const result = await runSaddleTurn({
    input: "run the focused test",
    model: "qwen3.5:9b",
    backend: "ollama",
    host: "http://localhost:11434",
    contextWindow: 65536,
    onUsage: (usage) => {
      observedUsage = usage;
      return usage;
    },
    mindFn: async (sentence, options) => {
      observed = { sentence, options };
      await options.onUsage?.({
        input_tokens: 10,
        output_tokens: 4,
        cached_input_tokens: 2
      });
      return { mood: "ya", be: "text", ob: { text: "done" } };
    }
  });

  assert.equal(result.ob.text, "done");
  assert.equal(observed.sentence.ob.text, "run the focused test");
  assert.equal(observed.sentence.fromstate.text, "ollama");
  assert.equal(observed.sentence.contextWindow, 65536);
  assert.equal(observed.options.sessionUserContent, "run the focused test");
  assert.equal(typeof observed.options.onUsage, "function");
  assert.deepEqual(observedUsage, {
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 0,
    outputTokens: 4,
    reasoningOutputTokens: 0,
    totalTokens: 14
  });
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

test("coding saddle selects named Pyash minds without changing global defaults", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-zai-"));
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const worldRoot = path.join(root, "world");
  try {
    const defaultMind = await prepareSaddle({ cwd: root, runtimeRoot, worldRoot });
    assert.equal(defaultMind.mindName, "mind");
    assert.equal(defaultMind.backend, "ollama");
    assert.equal(defaultMind.model, "qwen3.5:9b");

    const zai = await prepareSaddle({
      cwd: root,
      runtimeRoot,
      worldRoot,
      mindName: "zai"
    });
    assert.equal(zai.mindName, "zai");
    assert.equal(zai.backend, "zai");
    assert.equal(zai.model, "glm-5.3-flash");
    assert.equal(zai.host, "https://api.z.ai/api/v1");
    assert.equal(remember("coding saddle")?.fromstate?.text, "zai");
    assert.equal(remember("coding saddle")?.as?.name, "glm-5.3-flash");
    const zaiCall = await runSaddleTurn({
      input: "test selected Z.AI mind",
      model: zai.model,
      backend: zai.backend,
      host: zai.host,
      mindFn: async (sentence) => sentence
    });
    assert.equal(zaiCall.for.name, "coding saddle");
    assert.equal(zaiCall.fromstate.text, "zai");

    const openai = await prepareSaddle({
      cwd: root,
      runtimeRoot,
      worldRoot,
      mindName: "openai"
    });
    assert.equal(openai.mindName, "openai");
    assert.equal(openai.backend, "openai");
    assert.equal(openai.model, "gpt-5.3-codex");
    assert.equal(openai.host, "https://api.openai.com");
    assert.equal(remember("coding saddle")?.fromstate?.text, "openai");
    assert.equal(remember("coding saddle")?.as?.name, "gpt-5.3-codex");
    const openaiCall = await runSaddleTurn({
      input: "test selected OpenAI mind",
      model: openai.model,
      backend: openai.backend,
      host: openai.host,
      mindFn: async (sentence) => sentence
    });
    assert.equal(openaiCall.fromstate.text, "openai");

    assert.deepEqual(listSaddleMindNames({ minds: allRemember() }), ["mind", "openai", "zai"]);
    await assert.rejects(prepareSaddle({ cwd: root, runtimeRoot, worldRoot, mindName: "missing" }), /Pyash mind not found: missing/);
  } finally {
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle status exposes selected Pyash mind and queue state", () => {
  const status = formatSaddleStatus({
    mindName: "stratahelper",
    model: "qwen3.8:27b",
    host: "http://swac:8090",
    cwd: "/tmp/project",
    queue: { total: 3 },
    busy: true
  });

  assert.match(status, /mind: stratahelper/);
  assert.match(status, /model: qwen3\.8:27b/);
  assert.doesNotMatch(status, /backend:/);
  assert.match(status, /gpu queue: 3/);
  assert.match(status, /state: running/);
});

test("coding saddle resolves Pyash mind cases and rejects non-mind facts", () => {
  assert.deepEqual(resolveSaddleMindProfile({
    mindName: "zai",
    profile: {
      be: "mind",
      fromstate: { name: "zai" },
      from: { name: "https://api.z.ai/api/v1" },
      as: { name: "glm-5.3-flash" }
    }
  }), {
    mindName: "zai",
    backend: "zai",
    model: "glm-5.3-flash",
    host: "https://api.z.ai/api/v1"
  });
  assert.throws(() => resolveSaddleMindProfile({ mindName: "ordinary fact", profile: { be: "text" } }), /Pyash mind not found/);
});

test("coding saddle recognizes /mind list and selection commands, not provider commands", () => {
  assert.deepEqual(parseSaddleMindCommand("/mind"), { type: "list" });
  assert.deepEqual(parseSaddleMindCommand("/mind ZAI"), { type: "select", mindName: "ZAI" });
  assert.equal(parseSaddleMindCommand("/backend zai"), null);
  assert.equal(parseSaddleMindCommand("ordinary prompt mentioning /mind zai"), null);
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

test("coding saddle discovers all account-enabled Z.AI models for the model picker", async () => {
  const result = await discoverSaddleModels({
    backend: "zai",
    host: "https://api.z.ai/api/v1",
    currentModel: "glm-5.3-flash",
    apiKey: "test-coding-key",
    fetchFn: async (url, options) => {
      assert.equal(url, "https://api.z.ai/api/coding/paas/v4/models");
      assert.equal(options.headers.authorization, "Bearer test-coding-key");
      return {
        ok: true,
        async json() {
          return { data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }, { id: "glm-5.3-flashx" }] };
        }
      };
    }
  });

  assert.deepEqual(result.models, ["glm-5.3-flash", "glm-5.3", "glm-5.3-flashx"]);
  assert.deepEqual(result.catalogModels, ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"]);
  assert.equal(result.available, true);
  assert.equal(resolveSaddleModelSelection("3", result.models), "glm-5.3-flashx");
  const contextChoices = [
    { model: "204800", value: "200K", label: "200K", tokens: 204800 },
    { model: "1048576", value: "1M", label: "1M", tokens: 1048576 }
  ];
  assert.equal(resolveSaddleModelOption("200K", contextChoices)?.tokens, 204800);
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
