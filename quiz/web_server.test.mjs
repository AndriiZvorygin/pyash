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
  assertWebBindSecurity,
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

test("public web binds require reverse-proxy identity while loopback development stays local", () => {
  assert.doesNotThrow(() => assertWebBindSecurity("127.0.0.1", ""));
  assert.doesNotThrow(() => assertWebBindSecurity("::1", ""));
  assert.doesNotThrow(() => assertWebBindSecurity("0.0.0.0", "proxy-secret"));
  assert.throws(() => assertWebBindSecurity("0.0.0.0", ""), /PYA_WEB_PROXY_TOKEN is required/u);
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

test("web model availability comes from the GPU Housekeeper catalogs", async () => {
  const originalFetch = globalThis.fetch;
  const originalManager = process.env.PYA_GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_HOUSEKEEPER_URL = "http://housekeeper:8090";
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === "http://housekeeper:8090/runtime/ollama/models") {
      return { ok: true, async json() { return { available: true, models: [{ name: "qwen3.5:9b" }] }; } };
    }
    if (target === "http://housekeeper:8090/runtime/strata/models") {
      return { ok: true, async json() { return {
        available: true,
        models: [{ name: "qwen3.8-flash-next-coder-iq1_m" }],
        runtime: { status: "running", loaded: false }
      }; } };
    }
    throw new Error(`unexpected model availability URL: ${target}`);
  };
  try {
    const catalog = await fetchWebModels("qwen3.5:9b");
    assert.deepEqual(catalog.modelOptions.map(({ value, host }) => ({ value, host })), [
      { value: "qwen3.5:9b", host: "http://localhost:11434" },
      { value: "strata::qwen3.8-flash-next-coder-iq1_m", host: "" }
    ]);
    assert.equal(catalog.modelOptions[1].ready, true);
    assert.match(catalog.modelOptions[1].statusMessage, /GPU Housekeeper queue/u);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalManager === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = originalManager;
  }
});

test("web does not advertise Strata models absent from the Housekeeper catalog", async () => {
  const originalFetch = globalThis.fetch;
  const originalManager = process.env.PYA_GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_HOUSEKEEPER_URL = "http://housekeeper:8090";
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === "http://housekeeper:8090/runtime/ollama/models") {
      return { ok: true, async json() { return { available: true, models: [] }; } };
    }
    if (target === "http://housekeeper:8090/runtime/strata/models") {
      return { ok: true, async json() { return {
        available: false,
        models: [],
        runtime: { status: "starting", loaded: false, message: "warming" },
        error: "warming"
      }; } };
    }
    throw new Error(`unexpected model availability URL: ${target}`);
  };
  try {
    const catalog = await fetchWebModels("", "strata");
    assert.deepEqual(catalog.modelOptions, []);
    assert.equal(catalog.errors.strata, "warming");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalManager === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = originalManager;
  }
});

test("web model discovery contacts only GPU Housekeeper catalog endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const originalManager = process.env.PYA_GPU_HOUSEKEEPER_URL;
  process.env.PYA_GPU_HOUSEKEEPER_URL = "http://housekeeper:8090";
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "http://housekeeper:8090/runtime/ollama/models") {
      return { ok: true, async json() { return { available: true, models: [{ name: "qwen3.5:9b" }] }; } };
    }
    if (String(url) === "http://housekeeper:8090/runtime/strata/models") {
      return { ok: true, async json() { return { available: false, models: [], error: "runtime not registered" }; } };
    }
    throw new Error(`unexpected model discovery request: ${url}`);
  };
  try {
    const catalog = await fetchWebModels("qwen3.5:9b");
    assert.deepEqual(catalog.models, ["qwen3.5:9b"]);
    assert.ok(calls.includes("http://housekeeper:8090/runtime/ollama/models"));
    assert.ok(calls.includes("http://housekeeper:8090/runtime/strata/models"));
    assert.equal(calls.some((url) => /:(?:11434|18082|18083)\//u.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalManager === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = originalManager;
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

    const index = await fetch(base);
    assert.equal(index.status, 200);
    const indexSource = await index.text();
    assert.match(indexSource, /id="duty-mode"[^>]*>Duty</u);
    assert.match(indexSource, /aria-label="Duty sessions"/u);
    assert.match(indexSource, /aria-label="Host worker"/u);
    assert.match(indexSource, /aria-label="Folder"/u);
    assert.match(indexSource, /id="duty-create-permission"/u);
    assert.match(indexSource, /id="duty-current-permission"/u);
    assert.match(indexSource, /not an OS jail/u);

    const style = await fetch(`${base}/style.css`);
    assert.equal(style.status, 200);
    assert.match(await style.text(), /workspace\[data-mode="duty"\].*side-panel/su);

    const app = await fetch(`${base}/app.js`);
    assert.equal(app.status, 200);
    const appSource = await app.text();
    assert.ok(appSource.includes('from "/model_recency.js"'));
    assert.ok(appSource.includes('from "/session_name.js"'));
    assert.ok(appSource.includes('workspace.dataset.mode = conversationMode'));
    const modelRecency = await fetch(`${base}/model_recency.js`);
    assert.equal(modelRecency.status, 200);
    assert.match(modelRecency.headers.get("content-type"), /javascript/u);
    const sessionNames = await fetch(`${base}/session_name.js`);
    assert.equal(sessionNames.status, 200);
    assert.match(sessionNames.headers.get("content-type"), /javascript/u);

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

test("web chat fails closed when the Housekeeper has no matching model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-no-housekeeper-model-"));
  let mindCalls = 0;
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    modelsFn: async () => ({ available: false, models: [], modelOptions: [] }),
    mindFn: async () => {
      mindCalls += 1;
      return { ob: { text: "must not call a provider directly" } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", model: "strata::unknown-model" })
    });
    const body = await chat.json();
    assert.equal(chat.status, 400);
    assert.equal(body.error.code, "model_unavailable");
    assert.equal(mindCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});

test("coding duties persist on the hub and only assigned authenticated workers can claim them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-duty-"));
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    proxyToken: "proxy-secret",
    webUsers: "pyash=htaf;alice=alice",
    workerTokens: "worker-a=worker-secret",
    workerUsers: "worker-a=htaf",
    workerHomeAccess: "worker-a",
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
  const userHeaders = { "x-pyash-user": "pyash", "x-pyash-proxy-token": "proxy-secret" };
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
    assert.deepEqual(worker.permissionScopes, ["project", "home"]);
    assert.equal("root" in worker.repositories[0], false);

    const forgedIdentity = await fetch(`${base}/api/duties`, {
      headers: { "x-pyash-user": "pyash" }
    });
    assert.equal(forgedIdentity.status, 401);

    const createdResponse = await fetch(`${base}/api/duties`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
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
    assert.equal(created.permissionScope, "project");
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

    const ownDuties = await fetch(`${base}/api/duties`, { headers: userHeaders });
    assert.equal((await ownDuties.json()).duties.length, 1);
    const otherUserHeaders = { "x-pyash-user": "alice", "x-pyash-proxy-token": "proxy-secret" };
    const otherDuties = await fetch(`${base}/api/duties`, { headers: otherUserHeaders });
    assert.equal((await otherDuties.json()).duties.length, 0);
    const otherWorkers = await fetch(`${base}/api/duty-workers`, { headers: otherUserHeaders });
    assert.equal((await otherWorkers.json()).workers.length, 0);
    const privateDuty = await fetch(`${base}/api/duties/${encodeURIComponent(id)}`, { headers: otherUserHeaders });
    assert.equal(privateDuty.status, 404);
    const privateMessage = await fetch(`${base}/api/duties/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { ...otherUserHeaders, "content-type": "application/json" },
      body: JSON.stringify({ message: "unauthorized" })
    });
    assert.equal(privateMessage.status, 404);

    const permission = await fetch(`${base}/api/duties/${encodeURIComponent(id)}/permissions`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ permissionScope: "home" })
    });
    assert.equal(permission.status, 200, JSON.stringify(await permission.clone().json()));
    assert.equal((await permission.json()).duty.permissionScope, "home");

    const accepted = await fetch(`${base}/api/duties/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      headers: userHeaders
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).duty.status, "accepted");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});

test("authenticated web users receive separate private chat histories and working roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-web-users-"));
  let lastSentence = null;
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    proxyToken: "proxy-secret",
    webUsers: "pyash=htaf;alice=alice",
    defaultWebUser: "htaf",
    modelsFn: async () => ({ available: true, models: ["qwen3.5:9b"], modelOptions: [{
      value: "qwen3.5:9b", backend: "ollama", model: "qwen3.5:9b", ready: true
    }] }),
    mindFn: async (sentence) => {
      lastSentence = sentence;
      return { ob: { text: "private response" } };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headersFor = (user) => ({ "x-pyash-proxy-token": "proxy-secret", "x-pyash-user": user });
  try {
    const filename = path.join(root, "world", "house", "web-assistant", "session", "20261020-private.pya");
    await fs.writeFile(filename, 'su name 20261020-private since date 2026-10-20 be series def\nsu name user ob text "htaf secret" ya\n', "utf8");
    const untrusted = await fetch(`${base}/api/sessions`, { headers: { "x-pyash-user": "pyash" } });
    assert.equal(untrusted.status, 401);

    const ownerSessions = await fetch(`${base}/api/sessions`, { headers: headersFor("pyash") });
    assert.equal((await ownerSessions.json()).sessions[0].id, "private");
    const otherSessions = await fetch(`${base}/api/sessions`, { headers: headersFor("alice") });
    assert.equal((await otherSessions.json()).sessions.length, 0);

    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { ...headersFor("alice"), "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", session: "alice-session", model: "qwen3.5:9b" })
    });
    assert.equal(chat.status, 200);
    assert.equal(lastSentence.at.filename, path.join(root, "world", "house", "web-assistant", "users", "alice"));
    await fs.access(path.join(lastSentence.at.filename, "workspace"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    forget();
  }
});
