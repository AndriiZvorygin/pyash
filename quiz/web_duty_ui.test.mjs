import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

import { createWebServer } from "../command/pyash_web_server.mjs";
import { forget } from "../program/remember/index.mjs";
import { orderModelsByRecency, rememberRecentModel } from "../web/model_recency.js";
import { displaySessionName, normalizeSessionName } from "../web/session_name.js";

function waitFor(predicate, timeoutMs = 3000, describe = () => "") {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        if (predicate()) return resolve();
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timed out waiting for Duty UI state: ${describe()}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("Duty UI discovers workers, creates a durable duty, and renders its instruction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-duty-ui-"));
  const priorTokens = process.env.PYA_DUTY_WORKER_TOKENS;
  process.env.PYA_DUTY_WORKER_TOKENS = "ui-worker=ui-secret";
  const { server } = await createWebServer({
    root,
    assets: path.resolve(process.cwd(), "web"),
    runtime: { tools: [] },
    proxyToken: "ui-proxy-secret",
    webUsers: "ui=ui-user",
    workerUsers: "ui-worker=ui-user",
    modelsFn: async () => ({
      available: true,
      modelOptions: [{ value: "qwen3.5:9b", backend: "ollama", model: "qwen3.5:9b", host: "http://ollama.test", ready: true }]
    }),
    queueDepthFn: async () => ({ total: 0, input: 0, runtime: 0 })
  });
  let dom;
  const errors = [];
  const uiRequests = [];
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const heartbeat = await fetch(`${base}/api/duty-workers/heartbeat`, {
      method: "POST",
      headers: { authorization: "Bearer ui-secret", "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "ui-worker",
        repositories: [{ id: "pyash", label: "Pyash checkout", root }]
      })
    });
    assert.equal(heartbeat.status, 200);
    const catalogResponse = await fetch(`${base}/api/duty-workers`, {
      headers: { "x-pyash-user": "ui", "x-pyash-proxy-token": "ui-proxy-secret" }
    });
    assert.equal(catalogResponse.status, 200, JSON.stringify(await catalogResponse.clone().json()));
    assert.equal((await catalogResponse.json()).workers[0].id, "ui-worker");
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error.message));
    const appSource = (await fs.readFile(path.join(process.cwd(), "web", "app.js"), "utf8"))
      .replace(/^import \{[^}]+\} from "[^"]+";\n/gmu, "");
    dom = await JSDOM.fromURL(base, {
      resources: "usable",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        window.orderModelsByRecency = orderModelsByRecency;
        window.rememberRecentModel = rememberRecentModel;
        window.displaySessionName = displaySessionName;
        window.normalizeSessionName = normalizeSessionName;
        window.fetch = async (url, options = {}) => {
          const headers = new Headers(options.headers || {});
          headers.set("x-pyash-user", "ui");
          headers.set("x-pyash-proxy-token", "ui-proxy-secret");
          const response = await fetch(new URL(url, base), { ...options, headers });
          uiRequests.push({ path: new URL(url, base).pathname, status: response.status });
          return response;
        };
        window.localStorage.setItem("pyash-mode", "duty");
      }
    });
    dom.window.eval(appSource);
    await waitFor(
      () => dom.window.document.querySelector("#duty-worker")?.value === "ui-worker",
      3000,
      () => `${dom.window.document.querySelector("#duty-state")?.textContent}; ${dom.window.document.querySelector("#duty-worker")?.innerHTML}; ${JSON.stringify(uiRequests)}`
    );
    const document = dom.window.document;
    document.querySelector("#duty-title").value = "UI smoke duty";
    document.querySelector("#duty-objective").value = "Inspect this checkout and report its state.";
    document.querySelector("#create-duty").click();
    await waitFor(
      () => document.querySelector("#duty-state").textContent.includes("ollama:qwen3.5:9b"),
      3000,
      () => `${document.querySelector("#duty-state").textContent}; ${document.querySelector("#messages").textContent}`
    );
    assert.match(document.querySelector("#messages").textContent, /Inspect this checkout and report its state/u);
    assert.equal(document.querySelector("#accept-duty").disabled, true);
    document.querySelector("#message").value = "Keep the same checkout and session.";
    document.querySelector("#chat-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(
      () => uiRequests.some((entry) => entry.path.endsWith("/messages") && entry.status === 202),
      3000,
      () => `${document.querySelector("#chat-state").textContent}; ${JSON.stringify(uiRequests)}`
    );
    const duties = await fetch(`${base}/api/duties`, {
      headers: { "x-pyash-user": "ui", "x-pyash-proxy-token": "ui-proxy-secret" }
    }).then((response) => response.json());
    assert.equal(duties.duties.length, 1);
    assert.equal(duties.duties[0].title, "UI smoke duty");
    assert.equal(duties.duties[0].messages.filter((message) => message.role === "user").length, 2);
    assert.ok(uiRequests.some((entry) => entry.path === "/api/duty-workers" && entry.status === 200));
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    if (priorTokens === undefined) delete process.env.PYA_DUTY_WORKER_TOKENS;
    else process.env.PYA_DUTY_WORKER_TOKENS = priorTokens;
    forget();
  }
});
