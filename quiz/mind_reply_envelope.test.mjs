import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, remember, forget } from "../program/remember/index.mjs";
import { appendSessionEntry, ensureSessionFile, readSessionMessages } from "../program/agent/session.mjs";

async function run(line) {
  return interpret(parse(line));
}

async function withOllama(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const previousHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`;
  try {
    return await callback();
  } finally {
    if (previousHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = previousHost;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function configureMind() {
  await run('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do');
  await run("exists su name mind backend be default ob name ollama command mind ya");
  await run("exists su name mind be mind ya");
}

function jsonReply(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

test("mind preserves a complete Ollama reply envelope across answer facts", { concurrency: false }, async () => {
  forget();
  await withOllama((req, res) => {
    assert.equal(req.url, "/api/chat");
    jsonReply(res, {
      model: "loop-model",
      created_at: "2026-08-12T12:00:00.000Z",
      message: { role: "assistant", content: "visible answer", thinking: "private plan" },
      done: true,
      done_reason: "stop",
      total_duration: 12,
      prompt_eval_count: 3,
      eval_count: 4,
      usage: { total_tokens: 7 }
    });
  }, async () => {
    await configureMind();
    await run("su name explicit history be series def");
    await run("prah");
    const result = await run('su name prompt ob text "Hello" accordingto name explicit history for name mind to name text output be write do');
    assert.equal(result.ob.text, "visible answer");
    assert.equal(result.in.text, "private plan");
    assert.equal(result.during.date, "2026-08-12T12:00:00.000Z");
    assert.equal(result.as.name, "loop-model");
    assert.match(result.accordingto.name, /metadata/);
    assert.equal(remember("result").ob.text, "visible answer");
    assert.equal(remember("output").ob.text, "visible answer");
    assert.equal(remember(result.accordingto.name).be, "json map");
    assert.equal(remember(result.accordingto.name).ob.map.total_duration.num, 12);
    assert.equal(remember(result.accordingto.name).ob.map.role.text, "assistant");
    assert.equal(remember(result.accordingto.name).ob.map.done.boolean, true);
    assert.equal(remember(result.accordingto.name).ob.map.done_reason.text, "stop");
    for (const fact of [result, remember("result"), remember("output"), remember("mind mind story answer 1")]) {
      assert.equal(fact.ob.text, "visible answer");
      assert.equal(fact.in.text, "private plan");
      assert.equal(fact.during.date, "2026-08-12T12:00:00.000Z");
      assert.equal(fact.as.name, "loop-model");
      assert.equal(fact.accordingto.name, result.accordingto.name);
    }
    const session = remember("mind story session");
    const assistant = session.ob.series.find((entry) => entry.su?.name === "assistant");
    assert.equal(assistant.ob.text, "visible answer");
    assert.equal(assistant.in.text, "private plan");
    const explicit = remember("explicit history");
    const explicitAssistant = explicit.ob.series.find((entry) => entry.su?.name === "assistant");
    assert.equal(explicitAssistant.ob.text, "visible answer");
    assert.equal(explicitAssistant.in.text, "private plan");
    assert.equal(explicitAssistant.accordingto.name, result.accordingto.name);

    const sessionFile = "/tmp/pyash-mind-envelope-session/session.pya";
    await fs.rm("/tmp/pyash-mind-envelope-session", { recursive: true, force: true });
    await ensureSessionFile({ sessionDir: "/tmp/pyash-mind-envelope-session", sessionName: "session", systemPrompt: "system", model: "loop-model" });
    await appendSessionEntry({
      sessionFile,
      role: "assistant",
      content: "visible answer",
      model: "loop-model",
      replySentence: result,
      replyEnvelope: {
        text: "visible answer",
        thinking: "private plan",
        createdAt: "2026-08-12T12:00:00.000Z",
        model: "loop-model",
        role: "assistant",
        done: true,
        doneReason: "stop",
        metadata: {
          total_duration: 12,
          role: "assistant",
          done: true,
          done_reason: "stop"
        }
      },
      replyMetadataName: result.accordingto.name,
      replyMetadata: {
        total_duration: 12,
        role: "assistant",
        done: true,
        done_reason: "stop"
      }
    });
    const durableText = await fs.readFile(sessionFile, "utf8");
    assert.match(durableText, /in text "private plan"/);
    assert.match(durableText, /done_reason/);
    const reloaded = await readSessionMessages({ sessionFile, historyWindow: 2 });
    assert.equal(reloaded.messages.at(-1).content, "visible answer");
    assert.doesNotMatch(reloaded.messages.at(-1).content, /private plan/);
  });
});

test("mind omits optional envelope fields successfully", { concurrency: false }, async () => {
  forget();
  await withOllama((req, res) => jsonReply(res, { response: "visible only" }), async () => {
    await configureMind();
    const result = await run('su name prompt ob text "Hello" for name mind to name text output be write do');
    assert.equal(result.ob.text, "visible only");
    assert.equal(result.in, undefined);
    assert.equal(result.during, undefined);
    assert.equal(result.as, undefined);
    assert.equal(result.accordingto, undefined);
  });
});

test("mind rejects hollow assistant content", { concurrency: false }, async () => {
  forget();
  await withOllama((req, res) => jsonReply(res, { message: { role: "assistant", content: "" } }), async () => {
    await configureMind();
    await assert.rejects(
      run('su name prompt ob text "Hello" for name mind to name text output be write do'),
      /mind hollow answer/
    );
  });
});

test("mind surfaces backend JSON errors and HTTP failures as errors", { concurrency: false }, async () => {
  forget();
  await withOllama((req, res) => jsonReply(res, { error: "model unavailable" }), async () => {
    await configureMind();
    await assert.rejects(
      run('su name prompt ob text "Hello" for name mind to name text output be write do'),
      /model unavailable/
    );
  });

  forget();
  await withOllama((req, res) => jsonReply(res, { error: "http unavailable" }, 503), async () => {
    await configureMind();
    await assert.rejects(
      run('su name prompt ob text "Hello" for name mind to name text output be write do'),
      /503|request failed|command defective/
    );
  });
});

async function waitFor(predicate, { timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for mind stream");
}

test("mind Ollama streaming is incremental, ordered, and terminal", { concurrency: false }, async () => {
  forget();
  let release;
  const completion = new Promise((resolve) => { release = resolve; });
  const safetyRelease = setTimeout(release, 2000);
  await withOllama(async (req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ model: "stream-model", message: { role: "assistant", content: "first " }, done: false })}\n`);
    await completion;
    res.write(`${JSON.stringify({ model: "stream-model", message: { role: "assistant", content: "last" }, done: true, done_reason: "stop", eval_count: 2 })}\n`);
    res.end();
  }, async () => {
    await configureMind();
    const stream = await run('su name stream-prompt ob text "Hello" for name mind to name text stream-prompt be write vyah stream do');
    assert.equal(stream.be, "stream");
    const filename = stream.ob.filename;
    const first = await run("su name stream-prompt vyah eval be chip do");
    assert.equal(first.ob.text, "first ");
    assert.equal(first.atindex.num, 0);
    assert.equal(allRemember().some((fact) => fact?.be === "answer" && fact?.ob?.text === "first last"), false);
    release();
    clearTimeout(safetyRelease);
    await waitFor(async () => (await fs.readFile(filename, "utf8")).includes("[PYA_STREAM_END]"));
    const second = await run("su name stream-prompt vyah eval be chip do");
    assert.equal(second.ob.text, "last");
    await waitFor(async () => allRemember().some((fact) => fact?.be === "answer" && fact?.ob?.text === "first last"));
    assert.equal(allRemember().find((fact) => fact?.be === "answer" && fact?.ob?.text === "first last")?.as?.name, "stream-model");
  });
});

test("mind hollow terminal stream is an error without answer projections", { concurrency: false }, async () => {
  forget();
  await withOllama(async (req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(`${JSON.stringify({ model: "hollow-model", message: { role: "assistant", content: "" }, done: true, done_reason: "stop" })}\n`);
  }, async () => {
    await configureMind();
    await run("su name hollow history be series def");
    await run("prah");
    const stream = await run('su name hollow-prompt ob text "Hello" for name mind to name text hollow-stream be write vyah stream do');
    const error = await run("su name hollow-stream vyah eval be chip do");
    assert.equal(error.be, "error");
    assert.equal(error.su.name, "mind hollow answer");
    assert.equal(remember("hollow-output"), undefined);
    assert.equal(remember("mind mind answer 1"), undefined);
    assert.equal(remember("hollow history").ob.series.some((entry) => entry?.su?.name === "assistant"), false);
    assert.ok((await fs.readFile(stream.ob.filename, "utf8")).includes("[PYA_STREAM_END]"));
  });
});

test("malformed and truncated streaming data become terminal mind errors", { concurrency: false }, async () => {
  forget();
  await withOllama(async (req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write('{"message":{"content":"partial"}\n');
    res.end();
  }, async () => {
    await configureMind();
    const stream = await run('su name broken-stream ob text "Hello" for name mind to name text broken-stream be write vyah stream do');
    await waitFor(async () => (await fs.readFile(stream.ob.filename, "utf8")).includes("[PYA_STREAM_END]"));
    const error = await run("su name broken-stream vyah eval be chip do");
    assert.equal(error.be, "error");
    assert.match(`${error.su.name} ${error.ob?.text ?? ""}`, /stream|mind|json/i);
  });
});

test("valid but truncated Ollama NDJSON becomes a terminal mind error", { concurrency: false }, async () => {
  forget();
  await withOllama(async (req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ message: { role: "assistant", content: "partial" }, done: false })}\n`);
    res.end();
  }, async () => {
    await configureMind();
    const stream = await run('su name valid-truncated ob text "Hello" for name mind to name text valid-truncated be write vyah stream do');
    await waitFor(async () => (await fs.readFile(stream.ob.filename, "utf8")).includes("[PYA_STREAM_END]"));
    const error = await run("su name valid-truncated vyah eval be chip do");
    assert.equal(error.be, "error");
    assert.match(error.ob?.text ?? "", /stream|mind|terminal/i);
  });
});
