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
        child.turnRequestIdentity = message.params.clientUserMessageId || "";
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

function makeTimedTurnClient({ activityMs = 0, completeMs = 0 } = {}) {
  const notifications = new Set();
  const timers = [];
  const emit = (method, params) => {
    for (const listener of notifications) listener(method, params, {});
  };
  return {
    async request(method) {
      if (method !== "turn/start") return {};
      const turnId = "timed-turn";
      if (activityMs > 0) {
        timers.push(setInterval(() => emit("item/agentMessage/delta", {
          threadId: "thread-1",
          turnId,
          delta: "."
        }), activityMs));
      }
      if (completeMs > 0) {
        timers.push(setTimeout(() => emit("turn/completed", {
          threadId: "thread-1",
          turn: { id: turnId, status: "completed" }
        }), completeMs));
      }
      return { turn: { id: turnId, status: "inProgress" } };
    },
    onNotification(listener) {
      notifications.add(listener);
      return () => notifications.delete(listener);
    },
    onError() {
      return () => {};
    },
    async close() {
      for (const timer of timers) {
        clearInterval(timer);
        clearTimeout(timer);
      }
    }
  };
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
    reasoningEffort: "low",
    requestIdentity: "pyash-test-planning-0"
  });
  assert.equal(turn.text, "hello world");
  assert.equal(turn.turnId, "turn-1");
  assert.equal(client.child.turnRequestIdentity, "pyash-test-planning-0");
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

test("active App Server events prevent an inactivity timeout", async () => {
  const client = makeTimedTurnClient({ activityMs: 8, completeMs: 55 });
  try {
    const turn = await runCodexTurn(client, {
      threadId: "thread-1",
      input: "work",
      inactivityTimeoutMs: 20,
      hardTimeoutMs: 150
    });
    assert.equal(turn.status, "completed");
    assert.ok(turn.activity.meaningfulEventCount >= 3);
  } finally {
    await client.close();
  }
});

test("a silent turn reaches the bounded inactivity timeout", async () => {
  const client = makeTimedTurnClient();
  try {
    await assert.rejects(
      runCodexTurn(client, {
        threadId: "thread-1",
        input: "work",
        inactivityTimeoutMs: 25,
        hardTimeoutMs: 200
      }),
      (error) => {
        assert.equal(error.kind, "timeout");
        assert.equal(error.details.timeoutType, "inactivity");
        assert.equal(error.details.timeoutMs, 25);
        assert.equal(error.details.hardTimeoutMs, 200);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});

test("a productive turn still obeys its larger hard maximum", async () => {
  const client = makeTimedTurnClient({ activityMs: 5 });
  try {
    await assert.rejects(
      runCodexTurn(client, {
        threadId: "thread-1",
        input: "work",
        inactivityTimeoutMs: 1000,
        hardTimeoutMs: 35
      }),
      (error) => {
        assert.equal(error.kind, "timeout");
        assert.equal(error.details.timeoutType, "hard");
        assert.equal(error.details.timeoutMs, 35);
        assert.equal(error.details.hardTimeoutMs, 35);
        assert.ok(error.details.meaningfulEventCount > 0);
        return true;
      }
    );
  } finally {
    await client.close();
  }
});
