import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { forget } from "../program/remember/index.mjs";
import {
  buildChatSentence,
  createWebServer,
  fetchWebModels,
  filterPublicTools,
  renderAssistantMarkdown,
  validateMediaJobRequest
} from "../command/pyash_web_server.mjs";

test("assistant markdown renders common structure without raw HTML", () => {
  const html = renderAssistantMarkdown("## Result\n\n- **Ready**\n- `safe`\n\n<script>alert(1)</script>");
  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<strong>Ready<\/strong>/);
  assert.match(html, /<code>safe<\/code>/);
  assert.doesNotMatch(html, /<script>/);
});

test("web gateway exposes only read/search-oriented tools", () => {
  const tools = filterPublicTools([
    { name: "be_search" },
    { name: "be_download" },
    { name: "be_read_markdown" },
    { name: "be_write" },
    { name: "be_compile" },
    { name: "be_repair" }
  ]);
  assert.deepEqual(tools.map((tool) => tool.name), ["be_search", "be_download", "be_read_markdown"]);
});

test("chat sentence uses a stable assistant house and session name", () => {
  const sentence = buildChatSentence({
    root: "/tmp/pyash",
    message: "find the latest meeting report",
    agentHouse: "/tmp/pyash/world/house/web-assistant",
    session: "research notes",
    model: "qwen3.8:27b"
  });
  assert.equal(sentence.be, "write");
  assert.equal(sentence.for.name, "web assistant");
  assert.equal(sentence.with.name, "agent tools");
  assert.equal(sentence.fromtext.name, "session name research-notes");
  assert.equal(sentence.ob.model, "qwen3.8:27b");
  assert.equal(sentence.at.filename, "/tmp/pyash/world/house/web-assistant");
});

test("chat sentence carries an explicit Strata backend and endpoint", () => {
  const sentence = buildChatSentence({
    root: "/tmp/pyash",
    message: "check runtime",
    agentHouse: "/tmp/pyash/world/house/web-assistant",
    backend: "strata",
    host: "http://swac:8081",
    model: "qwen3.8:27b"
  });
  assert.equal(sentence.fromstate.text, "strata");
  assert.equal(sentence.from.text, "http://swac:8081");
  assert.equal(sentence.ob.model, "qwen3.8:27b");
});

test("web model discovery keeps separate Strata hosts for advertised models", async () => {
  const originalFetch = globalThis.fetch;
  const originalHosts = process.env.PYA_WEB_STRATA_HOSTS;
  delete process.env.PYA_WEB_STRATA_HOST;
  delete process.env.STRATA_HOST;
  process.env.PYA_WEB_STRATA_HOSTS = "http://host:18082,http://host:18083";
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/tags")) {
      return { ok: true, async json() { return { models: [{ name: "qwen3.5:9b" }] }; } };
    }
    if (target === "http://host:18082/v1/models") {
      return { ok: true, async json() { return { data: [{ id: "qwen3.8-flash-next-iq2_xs" }] }; } };
    }
    if (target === "http://host:18083/v1/models") {
      return { ok: true, async json() { return { data: [{ id: "qwen3.8-flash-next-coder-iq1_m" }] }; } };
    }
    throw new Error(`unexpected model discovery URL: ${target}`);
  };
  try {
    const catalog = await fetchWebModels("qwen3.5:9b");
    assert.deepEqual(catalog.modelOptions.map(({ value, host }) => ({ value, host })), [
      { value: "qwen3.5:9b", host: "http://localhost:11434" },
      { value: "strata::qwen3.8-flash-next-iq2_xs", host: "http://host:18082" },
      { value: "strata::qwen3.8-flash-next-coder-iq1_m", host: "http://host:18083" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHosts === undefined) delete process.env.PYA_WEB_STRATA_HOSTS;
    else process.env.PYA_WEB_STRATA_HOSTS = originalHosts;
  }
});

test("configured Strata targets remain visible while one runtime is initializing", async () => {
  const originalFetch = globalThis.fetch;
  const originalHosts = process.env.PYA_WEB_STRATA_HOSTS;
  const originalTargets = process.env.PYA_WEB_STRATA_TARGETS;
  process.env.PYA_WEB_STRATA_HOSTS = "http://host:18082,http://host:18083";
  process.env.PYA_WEB_STRATA_TARGETS =
    "qwen3.8-flash-next-iq2_xs@http://host:18082,qwen3.8-flash-next-coder-iq1_m@http://host:18083";
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/tags")) {
      return { ok: true, async json() { return { models: [] }; } };
    }
    if (target === "http://host:18082/v1/models") {
      return { ok: false, status: 503, async json() { return {}; } };
    }
    if (target === "http://host:18083/v1/models") {
      return { ok: true, async json() { return { data: [{ id: "qwen3.8-flash-next-coder-iq1_m" }] }; } };
    }
    throw new Error(`unexpected model discovery URL: ${target}`);
  };
  try {
    const catalog = await fetchWebModels("", "strata");
    assert.deepEqual(catalog.modelOptions.map(({ value, available }) => ({ value, available })), [
      { value: "strata::qwen3.8-flash-next-iq2_xs", available: false },
      { value: "strata::qwen3.8-flash-next-coder-iq1_m", available: true }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHosts === undefined) delete process.env.PYA_WEB_STRATA_HOSTS;
    else process.env.PYA_WEB_STRATA_HOSTS = originalHosts;
    if (originalTargets === undefined) delete process.env.PYA_WEB_STRATA_TARGETS;
    else process.env.PYA_WEB_STRATA_TARGETS = originalTargets;
  }
});

test("media jobs accept only the existing safe GPU kinds", () => {
  const valid = validateMediaJobRequest({
    intent: "draw",
    profileName: "default",
    jobSpec: { kind: "comfyui-draw", prompt: {} }
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.expectedKind, "comfyui-draw");

  const wrongKind = validateMediaJobRequest({
    intent: "draw",
    jobSpec: { kind: "ollama-generate" }
  });
  assert.equal(wrongKind.ok, false);

  const unsafe = validateMediaJobRequest({
    intent: "hear",
    jobSpec: { kind: "comfyui-hear", command: "rm -rf /" }
  });
  assert.equal(unsafe.ok, false);
});

test("web routes use injected runtime without starting a model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-"));
  let chatSentence = null;
  let queuedSentence = null;
  const { server, workspaceDir } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: {
      tools: [
        { name: "be_search", description: "search", inputSchema: { type: "object" } },
        { name: "be_write", description: "write", inputSchema: { type: "object" } }
      ]
    },
    mindFn: async (sentence) => {
      chatSentence = sentence;
      return { mood: "ya", su: { name: "text" }, be: "text", ob: { text: "search complete" } };
    },
    interpretFn: async (sentence) => {
      queuedSentence = sentence;
      return {
        mood: "ya",
        su: { name: sentence.su.name },
        be: "duty",
        ob: { text: "queued" }
      };
    },
    queueDepthFn: async () => ({ input: 1, runtime: 0, produceWaiting: 0, total: 1 }),
    readStatusFn: async () => null,
    modelsFn: async (defaultModel) => ({
      available: true,
      models: [defaultModel, "qwen3.8:27b"],
      error: null
    })
  });
  await fs.access(workspaceDir);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await fs.writeFile(
      path.join(root, "world", "house", "web-assistant", "session", "20261012-research-notes.pya"),
      'su name 20261012-research-notes since date 2026-10-12 be series def\n' +
      'su name user ob text "hello" ya\n' +
      'su name agent ob text "## ready" ya\n',
      "utf8"
    );
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const tools = await fetch(`${base}/api/tools`);
    assert.deepEqual((await tools.json()).tools.map((tool) => tool.name), ["be_search"]);

    const models = await fetch(`${base}/api/models`);
    assert.deepEqual((await models.json()).models, ["qwen3.5:9b", "qwen3.8:27b"]);

    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "search for a report", session: "research notes", model: "qwen3.8:27b" })
    });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).text, "search complete");
    assert.equal(chatSentence.at.filename, path.join(root, "world", "house", "web-assistant"));
    assert.equal(chatSentence.fromtext.name, "session name research-notes");
    assert.equal(chatSentence.ob.model, "qwen3.8:27b");

    const sessions = await fetch(`${base}/api/sessions`);
    const sessionData = await sessions.json();
    assert.equal(sessionData.ok, true);
    assert.equal(sessionData.sessions[0].id, "research-notes");

    const session = await fetch(`${base}/api/sessions/research-notes`);
    const sessionPayload = await session.json();
    assert.equal(sessionPayload.session.messages.length, 2);
    assert.match(sessionPayload.session.messages[1].html, /<h2>ready<\/h2>/);

    const job = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "draw",
        profileName: "default",
        jobSpec: { kind: "comfyui-draw", prompt: {} }
      })
    });
    assert.equal(job.status, 202);
    assert.equal(queuedSentence.be, "gpu draw");
    assert.equal(queuedSentence.vyah.ve.values[0], "start");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});

test("web model catalogue routes a selected Strata model through the Strata mind", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-strata-"));
  let chatSentence = null;
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    modelsFn: async () => ({
      available: true,
      models: ["qwen3.5:9b", "strata::qwen3.8:27b"],
      modelOptions: [
        { value: "qwen3.5:9b", backend: "ollama", model: "qwen3.5:9b", host: "http://mriczo:11434" },
        { value: "strata::qwen3.8:27b", backend: "strata", model: "qwen3.8:27b", host: "http://swac:8081" }
      ]
    }),
    mindFn: async (sentence) => {
      chatSentence = sentence;
      return { ob: { text: "strata reply" } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const models = await fetch(`${base}/api/models`);
    const modelPayload = await models.json();
    assert.equal(modelPayload.modelOptions[1].label, "Strata: qwen3.8:27b");
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "check runtime",
        session: "strata",
        model: "strata::qwen3.8:27b"
      })
    });
    assert.equal(chat.status, 200);
    assert.equal(chatSentence.fromstate.text, "strata");
    assert.equal(chatSentence.from.text, "http://swac:8081");
    assert.equal(chatSentence.ob.model, "qwen3.8:27b");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});
