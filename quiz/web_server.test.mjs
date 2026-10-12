import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { forget } from "../program/remember/index.mjs";
import {
  buildChatSentence,
  createWebServer,
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
    agentHouse: "/tmp/pyash/world/house/web-assistant"
  });
  assert.equal(sentence.be, "write");
  assert.equal(sentence.for.name, "web assistant");
  assert.equal(sentence.with.name, "agent tools");
  assert.equal(sentence.fromtext.name, "session name web");
  assert.equal(sentence.at.filename, "/tmp/pyash/world/house/web-assistant");
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
  const { server } = await createWebServer({
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
    readStatusFn: async () => null
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const tools = await fetch(`${base}/api/tools`);
    assert.deepEqual((await tools.json()).tools.map((tool) => tool.name), ["be_search"]);

    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "search for a report" })
    });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).text, "search complete");
    assert.equal(chatSentence.at.filename, path.join(root, "world", "house", "web-assistant"));

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
