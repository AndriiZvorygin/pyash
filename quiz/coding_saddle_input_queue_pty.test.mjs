import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { stripTerminalControlSequences } from "../program/agent/coding_saddle_tui.mjs";
import { resolveSaddleProjectWorldRoot } from "../command/pyash_saddle.mjs";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = "qwen3.5:9b";
const planToolName = "be_write_fromstate_text_ob_text";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function waitFor(predicate, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForOutput(getOutput, needle, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      if (output.includes(needle)) {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForSaddleTurn(getOutput, finalText, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      const statuses = [...output.matchAll(/state: (running|ready)/gu)];
      if (output.includes(finalText) && statuses.at(-1)?.[1] === "ready") {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for turn completion after ${JSON.stringify(finalText)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function getUserTexts(payload) {
  return (Array.isArray(payload?.messages) ? payload.messages : [])
    .filter((message) => message?.role === "user")
    .map((message) => String(message.content ?? ""));
}

function makePlanToolResponse(id) {
  return {
    status: "success",
    result: {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id,
          type: "function",
          function: {
            name: planToolName,
            arguments: JSON.stringify({
              ob: JSON.stringify({
                action: "create",
                objective: "Exercise saddle input timing",
                steps: [{ title: "Complete the queued input scenario" }]
              })
            })
          }
        }]
      }
    }
  };
}

function makeFinalResponse(content) {
  return { status: "success", result: { message: { role: "assistant", content } } };
}

test("saddle PTY sends Enter input after the next tool result and Tab input after the turn", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-input-queue-pty-"));
  const projectRoot = path.join(tempRoot, "project");
  const projectWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectRoot });
  const usageDir = path.join(tempRoot, "usage");
  const sessionName = `pty-input-queue-${process.pid}-${Date.now()}`;
  const submissions = [];
  const jobs = new Map();
  const heldMarkers = new Set();
  let nextJobId = 0;

  const housekeeper = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : null;
    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/snapshot") {
      res.end(JSON.stringify({ hostId: "pty-input-test", queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/queue") {
      res.end(JSON.stringify({ available: true, queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/runtime/ollama/models") {
      res.end(JSON.stringify({ models: [{ name: model }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      const remoteJobId = `pty-input-job-${++nextJobId}`;
      const payload = body?.jobSpec?.payload ?? {};
      const userTexts = getUserTexts(payload);
      const heldMarker = ["start enter scenario", "start tab scenario", "start no-tool enter scenario"]
        .find((marker) => userTexts.includes(marker) && !heldMarkers.has(marker));
      const heldResponse = heldMarker ? deferred() : null;
      if (heldMarker) heldMarkers.add(heldMarker);
      submissions.push(payload);
      jobs.set(remoteJobId, {
        payload,
        response: heldResponse,
        heldMarker
      });
      res.end(JSON.stringify({ remoteJobId }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/job/pty-input-job-")) {
      const remoteJobId = decodeURIComponent(req.url.slice("/job/".length));
      const job = jobs.get(remoteJobId);
      if (!job) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "job not found" }));
        return;
      }
      let result;
      if (job.response) {
        result = await job.response.promise;
      } else if (job.heldMarker === "start enter scenario") {
        result = makePlanToolResponse("enter-plan-call");
      } else if (job.heldMarker === "start tab scenario") {
        result = makePlanToolResponse("tab-plan-call");
      } else if (getUserTexts(job.payload).includes("start tab scenario")
        && job.payload.messages?.some((message) => message?.role === "tool")) {
        result = { status: "success", result: { message: { role: "assistant", content: "Tab message stayed queued until this turn completed." } } };
      } else if (getUserTexts(job.payload).includes("deliver after no tool")) {
        result = makeFinalResponse("Enter input survived a turn without a tool call.");
      } else if (getUserTexts(job.payload).includes("deliver after turn end")) {
        result = { status: "success", result: { message: { role: "assistant", content: "Tab queued message was sent in its own turn." } } };
      } else if (getUserTexts(job.payload).includes("deliver after tool result")) {
        result = { status: "success", result: { message: { role: "assistant", content: "Enter message followed the tool result." } } };
      } else {
        result = { status: "success", result: { message: { role: "assistant", content: "Context summary recorded." } } };
      }
      res.end(JSON.stringify(result));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await new Promise((resolve) => housekeeper.listen(0, "127.0.0.1", resolve));
  const address = housekeeper.address();
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    PYA_SADDLE_CWD: projectRoot,
    PYA_SADDLE_SESSION_NAME: sessionName,
    PYA_SADDLE_MIND: "mind",
    PYA_SADDLE_MODEL: model,
    PYA_SADDLE_HOST: "http://127.0.0.1:1",
    PYA_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${address.port}`,
    PYA_GPU_MANAGER_REQUIRED: "true",
    PYA_GPU_MANAGER_POLL_MS: "1",
    PYA_GPU_MANAGER_TIMEOUT_MS: "30000",
    PYA_OLLAMA_USAGE_DIR: usageDir,
    PYA_WORLD_ROOT: path.join(tempRoot, "gpu-world"),
    PYA_NEWSPAPER: "false",
    PYA_NEWSPAPER_MIND_AUTO: "false"
  };
  for (const key of ["PYA_MIND_RESPONSE", "PYA_COMMAND_RESPONSE", "PYA_HEAR_FIXTURE", "PYA_PIPER_FIXTURE"]) {
    delete env[key];
  }

  let transcript = "";
  let child = null;
  let childExit = null;
  let resolveChildExit;
  const exited = new Promise((resolve) => { resolveChildExit = resolve; });
  try {
    child = pty.spawn(process.execPath, [path.join(runtimeRoot, "command", "pyash.mjs"), "saddle"], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: projectRoot,
      env
    });
    child.onData((data) => { transcript += data; });
    child.onExit((event) => {
      childExit = event;
      resolveChildExit(event);
    });

    await waitForOutput(() => transcript, `session: ${sessionName} | restored 0 saved messages`, 90000);
    child.write("start enter scenario\r");
    await waitFor(() => submissions.length === 1, "first held provider request");
    child.write("deliver after tool result\r");
    await waitFor(() => {
      const output = stripTerminalControlSequences(transcript);
      return output.includes("[queued 1] you> deliver after tool result")
        || output.includes("[after next tool result] you> deliver after tool result");
    }, "Enter input to be accepted while the first model call is in flight");
    const firstHeldJob = [...jobs.values()].find((job) => job.heldMarker === "start enter scenario");
    assert.ok(firstHeldJob?.response, "first model response must be held while Enter is pressed");
    firstHeldJob.response.resolve(makePlanToolResponse("enter-plan-call"));
    await waitForSaddleTurn(() => transcript, "Enter message followed the tool result.");

    const firstFollowup = submissions.find((payload) => getUserTexts(payload).includes("deliver after tool result"));
    assert.ok(firstFollowup, "Enter follow-up request must reach the model");
    const enterTexts = getUserTexts(firstFollowup);
    const toolMessageIndex = firstFollowup.messages.findIndex((message) => message?.role === "tool");
    const enterMessageIndex = firstFollowup.messages.findIndex((message) => message?.role === "user" && message.content === "deliver after tool result");
    assert.ok(enterTexts.includes("deliver after tool result"), "Enter should inject its message into the model continuation");
    assert.ok(enterMessageIndex > toolMessageIndex, "Enter input should follow the completed tool result in model context");

    child.write("start tab scenario\r");
    await waitFor(() => submissions.some((payload) => getUserTexts(payload).includes("start tab scenario")), "second held provider request");
    child.write("deliver after turn end\t");
    await waitForOutput(() => transcript, "queued until the current turn finishes");
    const secondHeldJob = [...jobs.values()].find((job) => job.heldMarker === "start tab scenario");
    assert.ok(secondHeldJob?.response,
      `second model response must be held while Tab is pressed; held=${JSON.stringify([...heldMarkers])}; users=${JSON.stringify(submissions.map(getUserTexts))}`);
    secondHeldJob.response.resolve(makePlanToolResponse("tab-plan-call"));
    await waitForSaddleTurn(() => transcript, "Tab message stayed queued until this turn completed.");
    await waitFor(() => submissions.some((payload) => getUserTexts(payload).includes("deliver after turn end")), "queued Tab message to start after the turn");

    const tabContinuation = submissions.find((payload) => getUserTexts(payload).includes("start tab scenario")
      && payload.messages?.some((message) => message?.role === "tool"));
    assert.ok(tabContinuation, "Tab test turn must continue after its tool result");
    assert.equal(getUserTexts(tabContinuation).includes("deliver after turn end"), false,
      "Tab input must not be added to the model continuation before the turn ends");
    const queuedTurn = submissions.find((payload) => getUserTexts(payload).includes("deliver after turn end"));
    assert.ok(queuedTurn,
      "Tab input should be submitted as the next turn after the current answer completes");
    await waitForOutput(() => transcript, "Tab queued message was sent in its own turn.");

    child.write("start no-tool enter scenario\r");
    await waitFor(() => submissions.some((payload) => getUserTexts(payload).includes("start no-tool enter scenario")), "no-tool provider request");
    child.write("deliver after no tool\r");
    await waitForOutput(() => transcript, "[after next tool result] you> deliver after no tool");
    const noToolHeldJob = [...jobs.values()].find((job) => job.heldMarker === "start no-tool enter scenario");
    assert.ok(noToolHeldJob?.response, "no-tool response must be held while Enter is pressed");
    noToolHeldJob.response.resolve(makeFinalResponse("Current turn completed without a tool call."));
    await waitForSaddleTurn(() => transcript, "Current turn completed without a tool call.");
    await waitFor(() => submissions.some((payload) => getUserTexts(payload).includes("deliver after no tool")), "Enter fallback turn after a no-tool response");
    await waitForOutput(() => transcript, "Enter input survived a turn without a tool call.");

    assert.doesNotMatch(stripTerminalControlSequences(transcript), /EPIPE|missing request payload|command defective: status=1/u);
    assert.equal(childExit, null, "saddle should remain open after both queue paths complete");
  } finally {
    if (child && !childExit) {
      child.write("\u0004");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (!childExit) child.kill();
    }
    await new Promise((resolve) => housekeeper.close(resolve));
    await fs.rm(projectWorldRoot, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
