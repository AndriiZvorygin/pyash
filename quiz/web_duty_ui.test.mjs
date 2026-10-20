import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

import { createWebServer } from "../command/pyash_web_server.mjs";
import { forget } from "../program/remember/index.mjs";

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
    modelsFn: async () => ({
      available: true,
      modelOptions: [{ value: "qwen3.5:9b", backend: "ollama", model: "qwen3.5:9b", host: "http://ollama.test", ready: true }]
    }),
    queueDepthFn: async () => ({ total: 0, input: 0, runtime: 0 })
  });
  let dom;
  const errors = [];
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
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error.message));
    dom = await JSDOM.fromURL(base, {
      resources: "usable",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        window.fetch = (url, options) => fetch(new URL(url, base), options);
        window.localStorage.setItem("pyash-mode", "duty");
      }
    });
    await waitFor(
      () => dom.window.document.querySelector("#duty-worker")?.value === "ui-worker",
      3000,
      () => `${dom.window.document.querySelector("#duty-state")?.textContent}; ${dom.window.document.querySelector("#duty-worker")?.innerHTML}`
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
    await waitFor(() => document.querySelector("#chat-state").textContent === "Instruction queued");
    const duties = await fetch(`${base}/api/duties`).then((response) => response.json());
    assert.equal(duties.duties.length, 1);
    assert.equal(duties.duties[0].title, "UI smoke duty");
    assert.equal(duties.duties[0].messages.filter((message) => message.role === "user").length, 2);
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
