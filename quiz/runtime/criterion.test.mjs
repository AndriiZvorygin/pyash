import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../../program/understand/index.mjs";
import { deriveSignatureFromCall } from "../../program/bridge/signature.mjs";
import { runCriterion, rerunCriterion, scoreSample } from "../../program/runtime/criterion/run.mjs";
import { extractLead3, extractSentences } from "../../program/runtime/criterion/baseline.mjs";
import { runBaseline } from "../../program/runtime/criterion/baseline-run.mjs";
import { createHuggingFaceExecutor, huggingFaceModelDefaults } from "../../program/runtime/criterion/huggingface.mjs";
import { loadSuiteSamples } from "../../program/runtime/criterion/datasets.mjs";
import { contextLengthBucket, ollamaTiming, percentile, rougeScores } from "../../program/runtime/criterion/metrics.mjs";
import { runNightmare, runReverie } from "../../program/runtime/criterion/suites.mjs";
import { runCriterionRefinery } from "../../program/runtime/criterion/refinery.mjs";
import { runOllamaChat } from "../../program/runtime/criterion/ollama.mjs";
import { loadRun, renderRunCsv, renderRunMarkdown } from "../../program/runtime/criterion/report.mjs";

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

test("Lead-3 extracts actual sentences across speaker labels and newlines", () => {
  const source = "[00:01] Speaker A: First motion passed.\nSpeaker B: Second motion failed!\nSpeaker A: Third item is pending?\nSpeaker B: Fourth item follows.";
  assert.deepEqual(extractSentences(source), ["First motion passed.", "Second motion failed!", "Third item is pending?", "Fourth item follows."]);
  assert.equal(extractLead3(source), "First motion passed. Second motion failed! Third item is pending?");
  assert.deepEqual(extractSentences(""), []);
  assert.equal(extractLead3(null), "");
});

test("Lead-3 baseline uses the first three sentences and writes resumable artifacts", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "meetingbank.json", [{ id: "m1", transcript: "First sentence. Second sentence. Third sentence. Fourth sentence.", summary: "First sentence. Second sentence. Third sentence." }]);
  const run = await runBaseline({ benchmark: "meetingbank", datasetPath: dataset, runId: "meetingbank-lead3", root });
  assert.equal(run.engine, "baseline");
  assert.equal(run.results[0].model, "baseline:lead-3");
  assert.equal(run.results[0].output, "First sentence. Second sentence. Third sentence.");
  assert.equal(run.results[0].scores.rouge1, 1);
  assert.equal(run.results[0].metrics.generationTokensPerSecond, null);
  for (const suffix of ["pya", "json", "jsonl", "md", "csv"]) await fs.access(path.join(root, "criterion", "results", `meetingbank-lead3.${suffix}`));
  const resumed = await runBaseline({ benchmark: "meetingbank", datasetPath: dataset, runId: "meetingbank-lead3", root, resume: true });
  assert.equal(resumed.results.length, 1);
  assert.equal(resumed.results[0].output, run.results[0].output);
});

test("Hugging Face adapter exposes model defaults without loading a model", async () => {
  assert.equal(huggingFaceModelDefaults("ahmeddeldalyyy/meeting-summarizer-meetingbank").maxInputTokens, 1024);
  assert.equal(huggingFaceModelDefaults("Shaelois/MeetingScript").maxInputTokens, 4096);
  const dialogLed = huggingFaceModelDefaults("MingZhong/DialogLED-large-5120");
  assert.equal(dialogLed.maxInputTokens, 5120);
  assert.equal(dialogLed.numBeams, 4);
  assert.equal(dialogLed.doSample, false);
  assert.equal(dialogLed.chunkLongInputs, true);
  const adapter = await createHuggingFaceExecutor({ housekeeperUrl: "http://mriczo:8090" });
  const metadata = await adapter.metadataProvider({ model: "Shaelois/MeetingScript" });
  assert.equal(metadata.model, "Shaelois/MeetingScript");
  assert.equal(metadata.engine, "huggingface");
  assert.equal(metadata.maxInputTokens, 4096);
  await adapter.close();
});

test("Hugging Face adapter sends inference through the durable GPU lane", async () => {
  const requests = [];
  let status = { status: "queued" };
  let workerCalls = 0;
  const adapter = await createHuggingFaceExecutor({
    root: await tempRoot(),
    runId: "hf-queue-test",
    housekeeperUrl: "http://housekeeper:8090",
    enqueue: async (_worldRoot, envelope) => requests.push(envelope),
    writeStatus: async (_worldRoot, handleId, next) => ({ ...next, handleId }),
    readStatus: async () => status,
    workerRunner: async () => {
      workerCalls += 1;
      status = { status: "success", result: JSON.stringify({ text: "summary", timing: { outputTokens: 5 }, metadata: { truncated: true }, metadataRecord: { parameterCount: 123 } }) };
    },
    pollMs: 1
  });

  const result = await adapter.executor({
    model: "Shaelois/MeetingScript",
    prompt: "Summarize this meeting.",
    sample: { id: "m1", input: "Alice: The meeting ended." }
  });

  assert.equal(result.text, "summary");
  assert.deepEqual(result.metadata.modelMetadata, { parameterCount: 123 });
  assert.equal(workerCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].lane, "criterion");
  assert.equal(requests[0].serviceName, "huggingface");
  assert.equal(requests[0].jobSpec.kind, "huggingface-generate");
  assert.equal(requests[0].jobSpec.payload.model, "Shaelois/MeetingScript");
  await adapter.close();
});

test("Hugging Face judge requests use distinct handles for each review identity", async () => {
  const handles = [];
  const adapter = await createHuggingFaceExecutor({
    root: await tempRoot(),
    runId: "hf-judge-handle-test",
    operation: "judge",
    housekeeperUrl: "http://housekeeper:8090",
    enqueue: async (_worldRoot, envelope) => handles.push(envelope.handleId),
    writeStatus: async () => {},
    readStatus: async () => ({ status: "success", result: JSON.stringify({ text: "{}" }) }),
    workerRunner: async () => {},
    pollMs: 1
  });

  const sample = { id: "m1", input: "Alice: The meeting ended." };
  await adapter.executor({ prompt: "pointwise", identity: "pointwise\u0000qwen\u0000m1", sample });
  await adapter.executor({ prompt: "pairwise", identity: "pairwise\u0000m1\u0000qwen-a\u0000qwen-b", sample });
  await adapter.executor({ prompt: "swap", identity: "pairwise\u0000m1\u0000qwen-a\u0000qwen-b\u0000swap", sample });

  assert.equal(handles.length, 3);
  assert.equal(new Set(handles).size, 3);
  await adapter.close();
});

test("Hugging Face adapter forwards target-specific long-context generation settings", async () => {
  const requests = [];
  let status = { status: "queued" };
  const adapter = await createHuggingFaceExecutor({
    root: await tempRoot(),
    runId: "hf-target-settings",
    housekeeperUrl: "http://housekeeper:8090",
    enqueue: async (_worldRoot, envelope) => requests.push(envelope),
    writeStatus: async () => {},
    readStatus: async () => status,
    workerRunner: async () => {
      status = { status: "success", result: JSON.stringify({ text: "summary", timing: {} }) };
    },
    pollMs: 1
  });

  await adapter.executor({
    model: "MingZhong/DialogLED-large-5120",
    prompt: "Summarize this meeting.",
    sample: { id: "m1", input: "Speaker A: The meeting ended." }
  });

  assert.equal(requests[0].jobSpec.payload.generation.maxInputTokens, 5120);
  assert.equal(requests[0].jobSpec.payload.generation.chunkLongInputs, true);
  assert.equal(requests[0].jobSpec.payload.generation.doSample, false);
  await adapter.close();
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
  assert.equal(run.runScope, "full");
});

test("criterion smoke runs are labelled separately from full aggregates", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "smoke.json", [{ id: "m1", transcript: "A", summary: "A" }]);
  const run = await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], limit: 1, smoke: true, runId: "smoke-scope", root, executor: fakeExecutor, metadataProvider });
  assert.equal(run.runScope, "smoke");
  assert.match(renderRunMarkdown(run), /Run scope: smoke/);
  assert.match(renderRunCsv(run).split("\n", 1)[0], /run_scope/);
});

test("criterion replay preserves a smoke run's bounded sample scope", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "replay.json", [
    { id: "m1", transcript: "A", summary: "A" },
    { id: "m2", transcript: "B", summary: "B" }
  ]);
  await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], limit: 1, smoke: true, runId: "smoke-replay", root, executor: fakeExecutor, metadataProvider });
  let calls = 0;
  const replayed = await rerunCriterion("smoke-replay", { root, executor: async () => { calls += 1; throw new Error("smoke replay expanded unexpectedly"); }, metadataProvider });
  assert.equal(calls, 0);
  assert.equal(replayed.results.length, 1);
  assert.equal(replayed.runScope, "smoke");
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

test("criterion resume normalizes legacy null context identity and removes duplicate rows", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "data.json", [{ id: "m1", transcript: "A", summary: "A" }]);
  await runBaseline({ benchmark: "meetingbank", datasetPath: dataset, runId: "legacy-context", root });
  const jsonl = path.join(root, "criterion", "results", "legacy-context.jsonl");
  const [row] = (await fs.readFile(jsonl, "utf8")).trim().split("\n").map(JSON.parse);
  await fs.writeFile(jsonl, `${JSON.stringify({ ...row, contextLength: 0 })}\n${JSON.stringify(row)}\n`, "utf8");
  const resumed = await runBaseline({ benchmark: "meetingbank", datasetPath: dataset, runId: "legacy-context", root, resume: true });
  assert.equal(resumed.results.length, 1);
  assert.equal(resumed.results[0].sampleId, "m1");
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

test("meeting and query adapters preserve official split and meeting evidence metadata", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "meeting.json", {
    train: [{ id: "train-meeting", transcript: "A: training", summary: "training" }],
    validation: [{ meeting_id: "validation-meeting", city: "Toronto", date: "2026-01-02", turns: [{ speaker: "A", start: 0, end: 1, text: "The council approved the grant." }], summary: { text: "The council approved the grant.", provenance: "meetingbank annotation" }, segment_start: 0, segment_end: 1 }],
    test: [{ id: "test-meeting", transcript: "A: test", summary: "test" }]
  });
  const meeting = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath: dataset, split: "validation" });
  assert.equal(meeting.actualSplit, "validation");
  assert.equal(meeting.samples[0].metadata.meetingId, "validation-meeting");
  assert.equal(meeting.samples[0].metadata.city, "Toronto");
  assert.equal(meeting.samples[0].metadata.evaluationMode, "segment");
  assert.deepEqual(meeting.samples[0].metadata.segmentBoundary, { start: 0, end: 1 });
  assert.deepEqual(meeting.samples[0].metadata.turnBoundaries, [{ index: 0, speaker: "A", start: 0, end: 1 }]);
  assert.ok(meeting.datasetHash);

  const qmsumDataset = await writeJson(root, "qmsum.json", {
    validation: [{ meeting_id: "q-meeting", query: "What was approved?", meeting: "Chair: The grant was approved.", answer: "The grant was approved.", relevant_text_span: [[0, 1]], topic: "grant" }]
  });
  const qmsum = await loadSuiteSamples({ benchmark: "qmsum", datasetPath: qmsumDataset, split: "validation" });
  assert.equal(qmsum.actualSplit, "validation");
  assert.equal(qmsum.samples[0].metadata.evaluationMode, "query-focused");
  assert.deepEqual(qmsum.samples[0].metadata.relevantTextSpan, [[0, 1]]);
  assert.equal(qmsum.samples[0].metadata.sourceTokenCount, 5);
});

test("official QMSum meeting rows expand general and specific queries", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "test.jsonl", {
    meeting_transcripts: [
      { speaker: "Chair", content: "The grant was approved." },
      { speaker: "Clerk", content: "The decision is recorded." }
    ],
    general_query_list: [{ query: "Summarize the whole meeting.", answer: "The grant was approved." }],
    specific_query_list: [{ query: "What was approved?", answer: "The grant was approved.", relevant_text_span: [[0, 1]] }]
  });
  const qmsum = await loadSuiteSamples({ benchmark: "qmsum", datasetPath: dataset });
  assert.equal(qmsum.actualSplit, "test");
  assert.equal(qmsum.samples.length, 2);
  assert.deepEqual(qmsum.samples.map(sample => sample.metadata.evaluationMode), ["full-meeting", "query-focused"]);
  assert.deepEqual(qmsum.samples[1].metadata.relevantTextSpan, [[0, 1]]);
  assert.deepEqual(qmsum.samples[0].metadata.speakerLabels, ["Chair", "Clerk"]);
  assert.match(qmsum.samples[0].input, /Chair: The grant/);
  assert.notEqual(qmsum.samples[0].id, qmsum.samples[1].id);
});

test("DialogSum accepts the official mirror CSV shape", async () => {
  const root = await tempRoot();
  const dataset = path.join(root, "dialogsum.csv");
  await fs.writeFile(dataset, "id,dialogue,summary,topic\nd1,\"#Person1#: Hello. #Person2#: Hi.\",\"People greet.\",greeting\n", "utf8");
  const dialogsum = await loadSuiteSamples({ benchmark: "dialogsum", datasetPath: dataset });
  assert.equal(dialogsum.samples[0].metadata.topic, "greeting");
  assert.deepEqual(dialogsum.samples[0].metadata.speakerLabels, ["Person1", "Person2"]);
});

test("AMI and ICSI fixture adapters preserve speakers, turns, access and missing references", async () => {
  const ami = await loadSuiteSamples({ benchmark: "ami", fixtureRoot: path.resolve("criterion/fixtures/ami") });
  assert.equal(ami.samples.length, 1);
  assert.deepEqual(ami.samples[0].metadata.speakerLabels, ["A", "B", "C"]);
  assert.equal(ami.samples[0].metadata.turnCount, 4);
  assert.equal(ami.samples[0].metadata.turnBoundaries[0].start, 0);
  assert.equal(ami.samples[0].metadata.accessStatus, "synthetic test fixture");

  const root = await tempRoot();
  const icsiRoot = path.join(root, "icsi");
  const fixture = path.join(icsiRoot, "icsi-001");
  await fs.mkdir(fixture, { recursive: true });
  await fs.writeFile(path.join(fixture, "transcript.txt"), "Speaker1: A discussion with no published summary.", "utf8");
  await fs.writeFile(path.join(fixture, "metadata.json"), JSON.stringify({ meetingId: "icsi-001", accessStatus: "user-supplied", preparation: "local conversion" }), "utf8");
  const icsi = await loadSuiteSamples({ benchmark: "icsi", fixtureRoot: icsiRoot });
  assert.equal(icsi.samples[0].metadata.meetingId, "icsi-001");
  assert.equal(icsi.samples[0].metadata.referenceAvailable, false);
  assert.deepEqual(icsi.samples[0].metadata.speakerLabels, ["Speaker1"]);
});

test("DialogSum and LongBench summary adapters preserve topic/task and macro reports", async () => {
  const root = await tempRoot();
  const dialog = await writeJson(root, "dialogsum.json", { test: [{ id: "d1", dialogue: "#Person1#: We need a plan.\n#Person2#: The plan is approved.", summary: "The plan is approved.", topic: "planning" }] });
  const dialogLoaded = await loadSuiteSamples({ benchmark: "dialogsum", datasetPath: dialog });
  assert.equal(dialogLoaded.samples[0].metadata.topic, "planning");
  assert.deepEqual(dialogLoaded.samples[0].metadata.speakerLabels, ["Person1", "Person2"]);

  const long = await writeJson(root, "long-summary.json", { test: [
    { id: "g1", task: "GovReport", input: "The government report describes a program.", answer: "The report describes a program." },
    { id: "q1", dataset: "QMSum", input: "The chair approved a motion.", answer: "The chair approved a motion." }
  ] });
  const run = await runCriterion({ benchmark: "longbench-summary", datasetPath: long, models: ["model"], runId: "long-summary", root, executor: async ({ sample }) => ({ text: sample.reference, timing: { promptTokens: 10, outputTokens: 5, totalElapsedMs: 20, promptTokensPerSecond: 500, generationTokensPerSecond: 250 } }), metadataProvider });
  assert.equal(run.actualSplit, "test");
  assert.equal(run.taskAggregates.length, 2);
  assert.equal(run.taskMacroAggregates[0].task, "macro-average");
  assert.match(renderRunMarkdown(run), /Task breakdown/);
  assert.match(renderRunMarkdown(run), /macro-average/);
  assert.match(renderRunCsv(run), /input_tokens/);
});

test("malformed and reference-missing rows are explicit and resumable", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "malformed.json", [{ id: "missing", transcript: "" }, { id: "no-reference", transcript: "A factual source." }]);
  let calls = 0;
  const run = await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], runId: "malformed", root, executor: async () => { calls += 1; return { text: "A factual source.", timing: {} }; }, metadataProvider });
  assert.equal(calls, 1);
  assert.equal(run.results[0].status, "error");
  assert.match(run.results[0].error, /malformed benchmark row/);
  assert.equal(run.results[1].metadata.referenceAvailable, false);
  assert.equal(run.results[1].scores.rougeL, null);
  const checkpoint = (await fs.readFile(path.join(root, "criterion", "results", "malformed.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(checkpoint.length, 2);
  assert.ok(run.results[1].provenance.datasetHash);
});

test("summary reasoning profiles record effective thinking and context buckets", async () => {
  const root = await tempRoot();
  const dataset = await writeJson(root, "profile.json", [{ id: "p1", transcript: "one two three", summary: "one two three" }]);
  const run = await runCriterion({ benchmark: "meetingbank", datasetPath: dataset, models: ["model"], profile: "summary_reasoned_hidden", runId: "reasoned-hidden", root, executor: async () => ({ text: "one two three", effectiveThink: true, reasoningMode: "reasoned-hidden", timing: { promptTokens: 3, outputTokens: 3, totalElapsedMs: 40 } }), metadataProvider });
  assert.equal(run.sampling.think, true);
  assert.equal(run.results[0].effectiveThink, true);
  assert.equal(run.results[0].reasoningMode, "reasoned-hidden");
  assert.equal(run.results[0].contextLengthBucket, "0-8K");
  assert.equal(contextLengthBucket(32768), "16K-32K");
  assert.ok(run.aggregates[0].aggregate.averageLatencyMs);
  assert.ok(run.aggregates[0].aggregate.qualityPerSecond);
});

test("MMLU-Pro accepts ten-choice answers and preserves category aggregates", async () => {
  assert.equal(scoreSample({ suiteKey: "mmlu-pro", sample: { expectedAnswer: "J" }, output: "J" }).accuracy, 1);
  assert.equal(scoreSample({ suiteKey: "mmlu-pro", sample: { expectedAnswer: "J" }, output: "D" }).accuracy, 0);
  const root = await tempRoot();
  const dataset = await writeJson(root, "mmlu-pro.json", [{ question: "Pick one", options: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], answer: "J", category: "business" }]);
  const run = await runCriterion({ benchmark: "mmlu-pro", datasetPath: dataset, models: ["model"], profile: "summary_direct", runId: "mmlu-pro-category", root, executor: async () => ({ text: "J", timing: { totalElapsedMs: 1, outputTokens: 1 } }), metadataProvider });
  assert.equal(run.aggregates[0].aggregate.accuracy, 1);
  assert.equal(run.categoryAggregates[0].category, "business");
  assert.equal(run.categoryAggregates[0].aggregate.accuracy, 1);
  assert.match(renderRunMarkdown(run), /Category breakdown/);
});
