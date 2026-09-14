import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../../program/understand/index.mjs";
import { deriveSignatureFromCall } from "../../program/bridge/signature.mjs";
import { runCriterion } from "../../program/runtime/criterion/run.mjs";
import { loadSuiteSamples } from "../../program/runtime/criterion/datasets.mjs";
import { ollamaTiming, percentile, rougeScores } from "../../program/runtime/criterion/metrics.mjs";
import { runNightmare, runReverie } from "../../program/runtime/criterion/suites.mjs";
import { runCriterionRefinery } from "../../program/runtime/criterion/refinery.mjs";
import { runOllamaChat } from "../../program/runtime/criterion/ollama.mjs";
import { loadRun } from "../../program/runtime/criterion/report.mjs";

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-test-")); }

function metadataProvider({ model }) {
  return Promise.resolve({ model, modelDigest: `digest-${model}`, quantization: "Q4_K_M", ollamaVersion: "test" });
}

function fakeExecutor({ model, sample }) {
  return Promise.resolve({
    text: `${model} summary for ${sample.id}.`,
    thinking: "private reasoning should not be scored",
    timing: { promptTokens: 20, outputTokens: 7, promptTokensPerSecond: 100, generationTokensPerSecond: 50, totalElapsedMs: 140 },
    finishedAt: new Date().toISOString()
  });
}

async function writeJson(root, name, value) {
  const filepath = path.join(root, name);
  await fs.writeFile(filepath, `${JSON.stringify(value)}\n`, "utf8");
  return filepath;
}

test("criterion metrics calculate ROUGE, percentiles, and Ollama speeds", () => {
  assert.equal(rougeScores("the council approved a budget", "the council approved a budget").rougeL, 1);
  assert.equal(percentile([100, 200, 300], 0.5), 200);
  const timing = ollamaTiming({ prompt_eval_count: 20, prompt_eval_duration: 2e8, eval_count: 10, eval_duration: 5e8, total_duration: 8e8 });
  assert.equal(timing.promptTokensPerSecond, 100);
  assert.equal(timing.generationTokensPerSecond, 20);
  assert.equal(timing.totalElapsedMs, 800);
});

test("Ollama adapter uses one configured profile and keeps thinking out of scored text", async () => {
  let request = null;
  const response = {
    ok: true,
    json: async () => ({ message: { content: "final answer", thinking: "private reasoning" }, prompt_eval_count: 10, prompt_eval_duration: 1e8, eval_count: 3, eval_duration: 1e8, total_duration: 3e8 })
  };
  const result = await runOllamaChat({
    model: "qwen3.5:9b",
    prompt: "hello",
    profile: "reasoning",
    contextLength: 65536,
    baseUrl: "http://example.test",
    fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return response; },
    now: (() => { let value = 0; return () => value += 100; })()
  });
  assert.equal(request.url, "http://example.test/api/chat");
  assert.equal(request.body.think, true);
  assert.equal(request.body.options.num_ctx, 65536);
  assert.equal(result.text, "final answer");
  assert.equal(result.timing.outputTokens, 3);
});

test("criterion language surface is registered as be criterion do", () => {
  const sentence = parse("be criterion do");
  assert.deepEqual(deriveSignatureFromCall(sentence), ["be", "criterion"]);
});

test("criterion run compares models and writes replayable artifacts", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "meetingbank.json", [{ id: "m1", transcript: "The council approved a budget.", summary: "The council approved a budget." }]);
  const events = [];
  const run = await runCriterion({
    benchmark: "meetingbank",
    datasetPath: dataset,
    models: ["qwen3.5:9b", "comparison-model"],
    profile: "summary_direct",
    runId: "comparison-smoke",
    root,
    executor: fakeExecutor,
    metadataProvider,
    onEvent: event => events.push(event)
  });
  assert.equal(run.status, "completed");
  assert.equal(run.results.length, 2);
  assert.equal(run.aggregates.length, 2);
  assert.ok(events.some(event => event.event === "sample-completed"));
  for (const suffix of ["pya", "json", "jsonl", "md", "csv"]) {
    await fs.access(path.join(root, "criterion", "results", `comparison-smoke.${suffix}`));
  }
  await fs.access(path.join(root, "criterion", "review", "comparison-smoke.html"));
  const pya = await fs.readFile(path.join(root, "criterion", "results", "comparison-smoke.pya"), "utf8");
  assert.match(pya, /su name run payload/);
  for (const line of pya.split(/\r?\n/u).filter(line => line && !line.startsWith("#"))) assert.doesNotThrow(() => parse(line));
  assert.match(run.replayCommand, /--resume/);
  assert.equal(run.results[0].pass, null);
});

test("criterion resume reuses completed sample rows without calling the model", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "data.json", [{ id: "m1", transcript: "A", summary: "A" }]);
  await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], runId: "resume", root, executor: fakeExecutor, metadataProvider });
  let calls = 0;
  const resumed = await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], runId: "resume", root, resume: true, executor: async () => { calls += 1; throw new Error("must not call"); }, metadataProvider });
  assert.equal(calls, 0);
  assert.equal(resumed.results.length, 1);
});

test("dataset adapters preserve QMSum spans and skip oversized LongBench context", async () => {
  const root = await tempRoot();
  const qmsumPath = await writeJson(root, "qmsum.json", [{ id: "q1", query: "Who spoke?", meeting: "Alice spoke.", answer: "Alice spoke.", relevant_text_span: [[0, 1]] }]);
  const qmsum = await loadSuiteSamples({ benchmark: "qmsum", datasetPath: qmsumPath });
  assert.deepEqual(qmsum.samples[0].metadata.relevantTextSpan, [[0, 1]]);
  const longPath = await writeJson(root, "long.json", [{ id: "l1", context: "one two three four five", question: "What?", answer: "A" }]);
  const run = await runCriterion({ benchmark: "longbench", datasetPath: longPath, models: ["model"], contextLength: 2, runId: "long-skip", root, executor: async () => { throw new Error("must not call"); }, metadataProvider });
  assert.equal(run.results[0].status, "skipped");
  assert.match(run.results[0].skipReason, /exceeds/);
});

test("HelpOS fixtures score facts and structured provenance separately", async () => {
  const root = await tempRoot();
  const fixture = path.join(root, "case-1");
  await fs.mkdir(fixture, { recursive: true });
  await fs.writeFile(path.join(fixture, "transcript.txt"), "Council approved the budget.", "utf8");
  await fs.writeFile(path.join(fixture, "reference.json"), JSON.stringify({ format: "json", summary: "Council approved the budget.", requiredProvenanceFields: ["transcriptHash"] }), "utf8");
  await fs.writeFile(path.join(fixture, "expected_facts.json"), JSON.stringify(["approved the budget"]), "utf8");
  const run = await runCriterion({ benchmark: "helpos-local", fixtureRoot: root, models: ["model"], runId: "helpos", root, executor: async () => ({ text: JSON.stringify({ summary: "Council approved the budget.", transcriptHash: "abc" }), timing: {} }), metadataProvider });
  assert.equal(run.results[0].scores.schemaValidity, 1);
  assert.equal(run.results[0].scores.factualAccuracy, 1);
  assert.equal(run.results[0].scores.provenanceValidity, 1);
});

test("nightmare repeats controlled runs and reverie supplies simulation responses", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "data.json", [{ id: "m1", transcript: "A", summary: "A" }]);
  const nightmare = await runNightmare({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], repeats: 2, root, executor: fakeExecutor, metadataProvider });
  assert.equal(nightmare.runs.length, 2);
  const reverie = await runReverie({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], root, controlledResponses: { m1: "simulated response" }, metadataProvider });
  assert.equal(reverie.mode, "reverie");
  assert.equal(reverie.results[0].output, "simulated response");
});

test("stored criterion report can be loaded for later report or email use", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "data.json", [{ id: "m1", transcript: "A", summary: "A" }]);
  await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], runId: "loadable", root, executor: fakeExecutor, metadataProvider });
  const loaded = await loadRun("loadable", { root });
  assert.equal(loaded.runId, "loadable");
  assert.ok(loaded.artifacts.length >= 5);
});

test("criterion refinery adapter uses existing ordered platform execution", async () => {
  const calls = [];
  const result = await runCriterionRefinery({
    name: "criterion test refinery",
    units: [{ id: "dataset", label: "load dataset" }, { id: "score", label: "score outputs" }],
    execute: async unit => { calls.push(unit.id); return { unit: unit.id }; },
    runId: "criterion-refinery-test"
  });
  assert.deepEqual(calls, ["dataset", "score"]);
  assert.equal(result.be, "criterion result");
});
