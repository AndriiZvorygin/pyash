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
const alternateModel = "llama3.2:3b";
const planToolName = "be_write_fromstate_text_ob_text";

function deferred() {
  let resolve;
  let settled = false;
  const promise = new Promise((done) => {
    resolve = (value) => {
      settled = true;
      done(value);
    };
  });
  return { promise, resolve, get settled() { return settled; } };
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

test("saddle PTY steers on Enter, queues on Tab, and continues after switching Ollama models", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-input-queue-pty-"));
  const projectRoot = path.join(tempRoot, "project");
  const projectWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectRoot });
  const usageDir = path.join(tempRoot, "usage");
  const sessionName = `pty-input-queue-${process.pid}-${Date.now()}`;
  const submissions = [];
  const jobs = new Map();
  const heldMarkers = new Set();
  const cancellations = [];
  const cancellationCompletions = [];
  let replacementSubmittedBeforeCancellation = false;
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
      res.end(JSON.stringify({ models: [{ name: model }, { name: alternateModel }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      const remoteJobId = `pty-input-job-${++nextJobId}`;
      const payload = body?.jobSpec?.payload ?? {};
      const userTexts = getUserTexts(payload);
      if (userTexts.some((text) => text.includes("add the first detail"))) {
        const activeSteerJob = [...jobs.values()].find((job) => job.heldMarker === "start steer scenario");
        if (!activeSteerJob?.cancellationConfirmed) replacementSubmittedBeforeCancellation = true;
      }
      const heldMarker = ["start steer scenario", "start tab scenario"]
        .find((marker) => userTexts.includes(marker) && !heldMarkers.has(marker));
      const heldResponse = heldMarker ? deferred() : null;
      if (heldMarker) heldMarkers.add(heldMarker);
      submissions.push(payload);
      jobs.set(remoteJobId, {
        remoteJobId,
        payload,
        response: heldResponse,
        heldMarker
      });
      res.end(JSON.stringify({ remoteJobId }));
      return;
    }
    if (req.method === "POST" && req.url === "/cancel") {
      const remoteJobId = String(body?.remoteJobId ?? "");
      cancellations.push(remoteJobId);
      const job = jobs.get(remoteJobId);
      if (job) job.cancelRequested = true;
      res.end(JSON.stringify({ accepted: true, cancelled: false, status: "cancelling", remoteJobId }));
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
      if (job.cancelRequested) {
        job.cancellationConfirmed = true;
        cancellationCompletions.push(remoteJobId);
        res.end(JSON.stringify({ status: "cancelled", remoteJobId }));
        return;
      }
      let result;
      if (job.response) {
        result = await job.response.promise;
      } else if (job.heldMarker === "start steer scenario") {
        result = makeFinalResponse("The original request completed without being interrupted.");
      } else if (job.heldMarker === "start tab scenario") {
        result = makePlanToolResponse("tab-plan-call");
      } else if (getUserTexts(job.payload).includes("start tab scenario")
        && job.payload.messages?.some((message) => message?.role === "tool")) {
        result = { status: "success", result: { message: { role: "assistant", content: "Tab message stayed queued until this turn completed." } } };
      } else if (getUserTexts(job.payload).some((text) => text.includes("start steer scenario")
        && text.includes("add the first detail")
        && text.includes("add the second detail"))) {
        result = makeFinalResponse("The restarted turn used the original request and both new details.");
      } else if (getUserTexts(job.payload).includes("model switch scenario")) {
        result = makeFinalResponse("The switched Ollama model completed a new request.");
      } else if (getUserTexts(job.payload).includes("deliver after turn end")) {
        result = { status: "success", result: { message: { role: "assistant", content: "Tab queued message was sent in its own turn." } } };
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
    child.write("start steer scenario\r");
    await waitFor(() => submissions.length === 1, "first held provider request");
    const firstHeldJob = [...jobs.values()].find((job) => job.heldMarker === "start steer scenario");
    assert.ok(firstHeldJob?.response, "first model response must be held while Enter is pressed");
    child.write("add the first detail\radd the second detail\r");
    await waitFor(() => submissions.length === 2, "replacement provider request after Enter steers", 10000);
    await waitFor(() => cancellations.includes(firstHeldJob.remoteJobId), "the active Housekeeper inference job to be cancelled");
    await waitFor(() => cancellationCompletions.includes(firstHeldJob.remoteJobId), "the active Housekeeper inference job to stop");
    assert.equal(replacementSubmittedBeforeCancellation, false,
      "the replacement request must wait until the interrupted Housekeeper job reaches a terminal state");
    assert.equal(firstHeldJob.response.settled, false,
      "Enter must interrupt generation without waiting for the held response or a tool result");
    const steeredRequest = submissions[1];
    const steeredUserMessage = getUserTexts(steeredRequest).find((text) => text.includes("start steer scenario"));
    assert.ok(steeredUserMessage, "the replacement request must retain the original user request");
    assert.ok(steeredUserMessage.includes("add the first detail"), "the first Enter message must reach the replacement request");
    assert.ok(steeredUserMessage.includes("add the second detail"), "the second Enter message must reach the replacement request");
    await waitForSaddleTurn(() => transcript, "The restarted turn used the original request and both new details.");

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

    child.write(`/model ${alternateModel}\r`);
    await waitForOutput(() => transcript, `model: ${alternateModel}`);
    child.write("model switch scenario\r");
    await waitFor(() => submissions.some((payload) => getUserTexts(payload).includes("model switch scenario")),
      "managed request after switching Ollama models");
    const switchedModelRequest = submissions.find((payload) => getUserTexts(payload).includes("model switch scenario"));
    assert.equal(switchedModelRequest.model, alternateModel);
    await waitForSaddleTurn(() => transcript, "The switched Ollama model completed a new request.");

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
