import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import {
  CodexAppServerError,
  JsonlRpcClient,
  runCodexTurn
} from "../../program/runtime/codex/app_server.mjs";

function makeFakeChild({ mode = "success" } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  let nextThread = 0;
  let nextTurn = 0;
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      const message = JSON.parse(String(chunk, encoding));
      const reply = (result, id = message.id) => child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
      if (message.method === "initialize") {
        reply({ server: "fake" });
      } else if (message.method === "thread/start") {
        nextThread += 1;
        reply({ thread: { id: `thread-${nextThread}` } });
      } else if (message.method === "thread/resume") {
        reply({ thread: { id: message.params.threadId } });
      } else if (message.method === "turn/start") {
        nextTurn += 1;
        const turnId = `turn-${nextTurn}`;
        if (mode === "server-error") {
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "turn rejected" } })}\n`);
        } else if (mode === "malformed") {
          reply({ turn: { id: turnId, status: "inProgress" } });
          child.stdout.write("not json\n");
        } else if (mode === "exit") {
          reply({ turn: { id: turnId, status: "inProgress" } });
          child.exitCode = 1;
          child.emit("exit", 1, null);
        } else {
          reply({ turn: { id: turnId, status: "inProgress" } });
          child.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: { threadId: message.params.threadId, turnId, delta: "hello " }
          })}\n`);
          child.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "item/fileChange/patchUpdated",
            params: { threadId: message.params.threadId, turnId, changes: [{ path: "hello.txt", kind: "update", diff: "+hello" }] }
          })}\n`);
          child.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "turn/diff/updated",
            params: { threadId: message.params.threadId, turnId, diff: "diff --git a/hello.txt b/hello.txt" }
          })}\n`);
          child.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: { threadId: message.params.threadId, turnId, delta: "world" }
          })}\n`);
          child.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: { threadId: message.params.threadId, turn: { id: turnId, status: "completed" } }
          })}\n`);
        }
      }
      callback();
    }
  });
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
  };
  return child;
}

async function makeClient(options) {
  const child = makeFakeChild(options);
  const client = new JsonlRpcClient(child, { requestTimeoutMs: 1000 });
  await client.request("initialize", { clientInfo: { name: "test" } }, { id: 0 });
  client.notify("initialized", {});
  return client;
}

test("app server adapter initializes, resumes, streams output, and captures diffs", async () => {
  const client = await makeClient();
  const started = await client.request("thread/start", { cwd: "/tmp/work" });
  assert.equal(started.thread.id, "thread-1");
  const resumed = await client.request("thread/resume", { threadId: started.thread.id });
  assert.equal(resumed.thread.id, "thread-1");
  const turn = await runCodexTurn(client, {
    threadId: started.thread.id,
    input: "say hello",
    cwd: "/tmp/work",
    model: "gpt-test",
    reasoningEffort: "low"
  });
  assert.equal(turn.text, "hello world");
  assert.equal(turn.turnId, "turn-1");
  assert.match(turn.diff, /diff --git/);
  assert.equal(turn.fileChanges[0].path, "hello.txt");
  await client.close();
});

test("app server adapter surfaces server errors, malformed events, and process exit", async () => {
  for (const mode of ["server-error", "malformed", "exit"]) {
    const client = await makeClient({ mode });
    const started = await client.request("thread/start", {});
    await assert.rejects(
      runCodexTurn(client, { threadId: started.thread.id, input: "work" }),
      (err) => err instanceof CodexAppServerError
    );
    await client.close();
  }
});
