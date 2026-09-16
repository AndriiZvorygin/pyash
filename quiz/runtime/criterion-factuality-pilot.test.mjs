import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSourceInventory,
  createOllamaFactualityJudge,
  dischargeOllamaModels,
  extractCandidateClaims,
  MEETINGBANK_FACTUALITY_MODELS,
  normalizeNativeJudgeResponse,
  preflightOllama,
  retrieveTranscriptEvidence,
  runMeetingBankFactualityPilot
} from "../../program/runtime/criterion/factuality-pilot.mjs";
import { sha256 } from "../../program/runtime/criterion/metrics.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-factuality-"));
}

function ollamaFetch() {
  return async (url, options = {}) => {
    if (url.endsWith("/api/version")) return { ok: true, json: async () => ({ version: "test" }) };
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: MEETINGBANK_FACTUALITY_MODELS.map(name => ({ name, digest: `digest-${name}` })) }) };
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({}) };
    assert.equal(url.endsWith("/api/chat"), true);
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        message: { content: body.messages.at(-1)?.content === "Reply with exactly OK." ? "OK" : "A factual summary." },
        prompt_eval_count: 10,
        prompt_eval_duration: 1e8,
        eval_count: 5,
        eval_duration: 1e8,
        total_duration: 3e8
      })
    };
  };
}

test("factuality lane extracts bounded claims and transcript evidence", () => {
  const claims = extractCandidateClaims("The council approved the motion. Staff will report back by June 5.");
  assert.equal(claims.status, "ok");
  assert.equal(claims.claims.length, 2);
  assert.equal(claims.claims[0].claimType, "motion");
  const inventory = buildSourceInventory("Chair: The council approved the motion. Staff will report back by June 5.");
  const evidence = retrieveTranscriptEvidence(claims.claims[0], inventory.turns);
  assert.equal(evidence.turns.length, 1);
  assert.equal(evidence.turns[0].turnId, "turn-1");
  assert.ok(evidence.evidenceHash);
});

test("factuality lane maps native UniRRM evaluations to transcript-grounded fields", () => {
  const result = normalizeNativeJudgeResponse(JSON.stringify({
    Analysis_process: "Evidence-backed municipal evaluation",
    evaluations: [
      {
        response_id: "Response1",
        final_score: 5,
        criterion: {
          faithfulness_score: 5,
          completeness_score: 4,
          decision_action_score: 4,
          relevance_score: 5,
          conciseness_score: 4,
          publication_suitability_score: 5,
          confidence: 4,
          claims: [
            { claim: "The motion passed.", status: "supported", evidence: "The motion passed.", transcript_turn_ids: ["turn-1"] },
            { claim: "The vote was unanimous.", status: "contradicted", evidence: "The vote was split.", transcript_turn_ids: ["turn-2"] }
          ]
        }
      }
    ]
  }));
  assert.equal(result.status, "ok");
  assert.equal(result.scores.faithfulnessPercentage, 100);
  assert.equal(result.scores.completenessPercentage, 75);
  assert.equal(result.claims[0].status, "supported");
  assert.equal(result.claims[1].status, "contradicted");
  assert.deepEqual(result.claims[1].transcriptTurnIds, ["turn-2"]);
});

test("factuality preflight verifies version, tags, warmup, and a real sample request", async () => {
  const result = await preflightOllama({
    baseUrl: "http://ollama.test",
    models: [MEETINGBANK_FACTUALITY_MODELS[0]],
    sample: { input: "The council approved the motion." },
    fetchImpl: ollamaFetch()
  });
  assert.equal(result.status, "ok");
  assert.equal(result.models[0].available, true);
  assert.deepEqual(result.requests.map(request => request.kind), ["warmup", "meeting"]);
});

test("factuality lane discharges each Ollama model without stopping Ollama", async () => {
  const requests = [];
  const result = await dischargeOllamaModels({
    baseUrl: "http://ollama.test",
    models: ["qwen3.5:9b"],
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    }
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(requests[0].body, { model: "qwen3.5:9b", prompt: "", stream: false, keep_alive: 0 });
});

test("factuality discharge verifies that Ollama released the requested model", async () => {
  const requests = [];
  let loaded = true;
  const result = await dischargeOllamaModels({
    baseUrl: "http://ollama.test",
    models: ["qwen3.5:9b"],
    verifyRelease: true,
    pollMs: 1,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: loaded ? [{ name: "qwen3.5:9b" }] : [] }) };
      loaded = false;
      return { ok: true, json: async () => ({}) };
    }
  });
  assert.equal(result.verified, true);
  assert.ok(requests.some(request => request.url.endsWith("/api/ps")));
});

test("factuality judge defaults to the quantized UniRRM Ollama target", async () => {
  let body = null;
  const judge = createOllamaFactualityJudge({
    baseUrl: "http://ollama.test",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ evaluations: [] }) }, prompt_eval_count: 1, eval_count: 1, total_duration: 1e6 }) };
    },
    maxOutputTokens: 1024,
    contextLength: 16384
  });
  await judge({ prompt: "<User_Input>Evaluate.</User_Input>" });
  assert.equal(body.model, "hf.co/mradermacher/UniRRM-8B-GGUF:Q4_K_M");
  assert.equal(body.think, false);
  assert.equal(body.format, "json");
  assert.equal(body.options.num_ctx, 16384);
  assert.equal(body.options.num_predict, 1024);
});

test("factuality pilot is resumable, hides references, and writes a ROUGE-free report", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.jsonl");
  await fs.writeFile(datasetPath, `${JSON.stringify({ id: "m1", transcript: "Chair: The council approved the motion. Staff will report back by June 5.", summary: "The council approved the motion." })}\n`, "utf8");
  let judgeCalls = 0;
  const judgeExecutor = async () => {
    judgeCalls += 1;
    return { text: JSON.stringify({ evaluations: [{ response_id: "Response1", final_score: 5, criterion: {
      faithfulness_score: 5,
      completeness_score: 5,
      decision_action_score: 5,
      relevance_score: 5,
      conciseness_score: 5,
      publication_suitability_score: 5,
      confidence: 5,
      claims: [{ claim: "The council approved the motion.", status: "supported", importance: "high", evidence: "The council approved the motion.", transcript_turn_ids: ["turn-1"], explanation: "Directly stated." }],
      omitted_important_items: [],
      reasoning: "The summary is grounded.",
      final_verdict: "supported"
    } }] }), timing: { totalElapsedMs: 2 } };
  };
  const generationRunner = async ({ samples, models }) => ({ results: models.map(model => ({
    model,
    sampleId: samples[0].id,
    status: "ok",
    output: "The council approved the motion.",
    outputHash: "summary-hash",
    metrics: { totalElapsedMs: 10, generationTokensPerSecond: 5 }
  })) });
  const run = await runMeetingBankFactualityPilot({
    root,
    datasetPath,
    models: [MEETINGBANK_FACTUALITY_MODELS[0]],
    selectionCount: 1,
    runId: "factuality-test",
    fetchImpl: ollamaFetch(),
    generationRunner,
    judgeExecutor,
    smoke: true
  });
  assert.equal(run.status, "completed");
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].status, "ok");
  assert.equal(run.results[0].referenceHiddenFromJudge, true);
  assert.equal(run.results[0].scores.faithfulnessPercentage, 100);
  assert.equal(judgeCalls, 1);
  assert.match(await fs.readFile(path.join(root, "criterion", "results", "factuality-test.md"), "utf8"), /ROUGE is intentionally excluded/);
  assert.equal(run.judge.discharge.status, "not-managed-by-adapter");
});

test("factuality pilot completes every generation batch before judging", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.jsonl");
  await fs.writeFile(datasetPath, `${JSON.stringify({ id: "m1", transcript: "Chair: The council approved the motion.", summary: "The council approved the motion." })}\n`, "utf8");
  const models = MEETINGBANK_FACTUALITY_MODELS.slice(0, 2);
  const events = [];
  const generationRunner = async ({ id, models: batchModels }) => {
    const model = batchModels[0];
    events.push(`generate:${model}`);
    return { runId: id, results: [{ model, sampleId: "m1", status: "ok", output: "The council approved the motion.", outputHash: `summary-${model}`, metrics: { totalElapsedMs: 10, generationTokensPerSecond: 5 } }] };
  };
  const judgeExecutor = async ({ identity }) => {
    events.push(`judge:${identity.split("\u0000")[0]}`);
    return { text: JSON.stringify({ evaluations: [{ response_id: "Response1", final_score: 5, criterion: {
      faithfulness_score: 5, completeness_score: 5, decision_action_score: 5, relevance_score: 5, conciseness_score: 5, publication_suitability_score: 5,
      confidence: 5, claims: [{ claim: "The council approved the motion.", status: "supported", evidence: "The council approved the motion.", transcript_turn_ids: ["turn-1"] }]
    } }] }) };
  };
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/api/version")) return { ok: true, json: async () => ({ version: "test" }) };
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: MEETINGBANK_FACTUALITY_MODELS.map(name => ({ name, digest: `digest-${name}` })) }) };
    if (url.endsWith("/api/generate")) {
      events.push(`discharge:${JSON.parse(options.body).model}`);
      return { ok: true, json: async () => ({}) };
    }
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: body.messages.at(-1)?.content === "Reply with exactly OK." ? "OK" : "A factual summary." }, prompt_eval_count: 1, prompt_eval_duration: 1e6, eval_count: 1, eval_duration: 1e6, total_duration: 2e6 }) };
  };
  const run = await runMeetingBankFactualityPilot({
    root, datasetPath, models, selectionCount: 1, runId: "factuality-model-major-test", fetchImpl, generationRunner, judgeExecutor, smoke: true
  });
  assert.deepEqual(events, [
    `generate:${models[0]}`, `discharge:${models[0]}`,
    `generate:${models[1]}`, `discharge:${models[1]}`,
    `discharge:${models[0]}`, `discharge:${models[1]}`,
    `judge:${models[0]}`, `judge:${models[1]}`
  ]);
  assert.equal(run.execution.generationCompletedForAllModelsBeforeJudging, true);
  assert.deepEqual(Object.keys(run.generationRunIds), models);
  assert.equal(run.judgeStats.initialRequests, 2);
});

test("factuality resume reuses a complete model-major generation checkpoint", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.jsonl");
  await fs.writeFile(datasetPath, `${JSON.stringify({ id: "m1", transcript: "Chair: The council approved the motion.", summary: "The council approved the motion." })}\n`, "utf8");
  const model = MEETINGBANK_FACTUALITY_MODELS[0];
  const generationRunId = `factuality-reuse-test-generation-${sha256(model).slice(0, 12)}`;
  await fs.mkdir(path.join(root, "criterion", "results"), { recursive: true });
  await fs.writeFile(path.join(root, "criterion", "results", `${generationRunId}.jsonl`), `${JSON.stringify({ model, sampleId: "m1", status: "ok", output: "The council approved the motion.", outputHash: "saved-summary", metrics: { totalElapsedMs: 10, generationTokensPerSecond: 5 } })}\n`, "utf8");
  const judgeExecutor = async () => ({ text: JSON.stringify({ evaluations: [{ response_id: "Response1", final_score: 5, criterion: {
    faithfulness_score: 5, completeness_score: 5, decision_action_score: 5, relevance_score: 5, conciseness_score: 5, publication_suitability_score: 5, confidence: 5,
    claims: [{ claim: "The council approved the motion.", status: "supported", evidence: "The council approved the motion.", transcript_turn_ids: ["turn-1"] }]
  } }] }) });
  const run = await runMeetingBankFactualityPilot({
    root, datasetPath, models: [model], selectionCount: 1, runId: "factuality-reuse-test", resume: true, smoke: true,
    fetchImpl: ollamaFetch(), judgeExecutor,
    generationRunner: async () => { throw new Error("generation should not run for a complete checkpoint"); }
  });
  assert.equal(run.generationReuse[model].reused, true);
  assert.equal(run.results[0].status, "ok");
});
