import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { forget } from "../program/remember/index.mjs";
import { workTaskStatusPath } from "../program/runtime/work/status.mjs";
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
    if (target === "http://host:18082/health" || target === "http://host:18083/health") {
      return { ok: true, async json() { return { status: "ok", loaded: true }; } };
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
    if (target === "http://host:18082/health") {
      return { ok: true, async json() { return { status: "loading", loaded: false, etaSeconds: 42 }; } };
    }
    if (target === "http://host:18083/health") {
      return { ok: true, async json() { return { status: "ok", loaded: true }; } };
    }
    throw new Error(`unexpected model discovery URL: ${target}`);
  };
  try {
    const catalog = await fetchWebModels("", "strata");
    assert.deepEqual(catalog.modelOptions.map(({ value, available, status, etaSeconds }) => ({ value, available, status, etaSeconds })), [
      { value: "strata::qwen3.8-flash-next-iq2_xs", available: false, status: "loading", etaSeconds: 42 },
      { value: "strata::qwen3.8-flash-next-coder-iq1_m", available: true, status: "ready", etaSeconds: 0 }
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

test("web chat refuses a Strata request until the runtime is ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-strata-loading-"));
  let mindCalls = 0;
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    modelsFn: async () => ({
      available: false,
      modelOptions: [{
        value: "strata::qwen3.8:27b",
        backend: "strata",
        model: "qwen3.8:27b",
        host: "http://swac:8081",
        ready: false,
        status: "loading",
        etaSeconds: 37
      }]
    }),
    mindFn: async () => {
      mindCalls += 1;
      return { ob: { text: "must not run" } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", model: "strata::qwen3.8:27b" })
    });
    const body = await chat.json();
    assert.equal(chat.status, 409);
    assert.equal(body.error.code, "model_loading");
    assert.equal(body.error.etaSeconds, 37);
    assert.equal(mindCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});

test("coding duties persist on the hub and only assigned authenticated workers can claim them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-duty-"));
  const priorTokens = process.env.PYA_DUTY_WORKER_TOKENS;
  process.env.PYA_DUTY_WORKER_TOKENS = "worker-a=worker-secret";
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    modelsFn: async () => ({
      available: true,
      modelOptions: [{
        value: "qwen3.5:9b",
        backend: "ollama",
        model: "qwen3.5:9b",
        host: "http://ollama.test",
        ready: true
      }]
    })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const workerHeaders = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  try {
    const unauthenticated = await fetch(`${base}/api/duty-workers/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "worker-a", repositories: [{ id: "pyash", root: "/srv/pyash" }] })
    });
    assert.equal(unauthenticated.status, 401);

    const heartbeat = await fetch(`${base}/api/duty-workers/heartbeat`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        workerId: "worker-a",
        label: "Development host",
        repositories: [{ id: "pyash", label: "Pyash", root: "/srv/pyash" }]
      })
    });
    assert.equal(heartbeat.status, 200);
    const worker = (await heartbeat.json()).worker;
    assert.equal(worker.repositories[0].id, "pyash");
    assert.equal("root" in worker.repositories[0], false);

    const createdResponse = await fetch(`${base}/api/duties`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        repositoryId: "pyash",
        title: "Inspect the saddle",
        initialMessage: "Inspect the existing implementation and summarize it.",
        model: "qwen3.5:9b"
      })
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).duty;
    assert.equal(created.status, "implementing");
    const id = created.id;
    await fs.access(await workTaskStatusPath(path.join(root, "world"), id, { readOnly: true }));

    const claim = await fetch(`${base}/api/duty-workers/claim`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ workerId: "worker-a" })
    });
    assert.equal(claim.status, 200, JSON.stringify(await claim.clone().json()));
    const assignment = (await claim.json()).assignment;
    assert.equal(assignment.duty.id, id);
    assert.match(assignment.sessionText, /coding saddle/u);

    const result = await fetch(`${base}/api/duty-workers/result`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        workerId: "worker-a",
        dutyId: id,
        messageId: assignment.message.id,
        claimId: assignment.claimId,
        text: "The existing saddle is persisted on the hub.",
        sessionText: assignment.sessionText
      })
    });
    assert.equal(result.status, 200);
    const completed = (await result.json()).duty;
    assert.equal(completed.messages.at(-1).parentId, assignment.message.id);
    assert.match(completed.messages.at(-1).html, /persisted on the hub/u);

    const accepted = await fetch(`${base}/api/duties/${encodeURIComponent(id)}/accept`, { method: "POST" });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).duty.status, "accepted");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    if (priorTokens === undefined) delete process.env.PYA_DUTY_WORKER_TOKENS;
    else process.env.PYA_DUTY_WORKER_TOKENS = priorTokens;
    forget();
  }
});
