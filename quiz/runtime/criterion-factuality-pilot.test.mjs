import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSourceInventory,
  extractCandidateClaims,
  MEETINGBANK_FACTUALITY_MODELS,
  normalizeNativeJudgeResponse,
  preflightOllama,
  retrieveTranscriptEvidence,
  runMeetingBankFactualityPilot
} from "../../program/runtime/criterion/factuality-pilot.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-factuality-"));
}

function ollamaFetch() {
  return async (url, options = {}) => {
    if (url.endsWith("/api/version")) return { ok: true, json: async () => ({ version: "test" }) };
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: MEETINGBANK_FACTUALITY_MODELS.map(name => ({ name, digest: `digest-${name}` })) }) };
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
    Analysis_process: "LABEL: supported [turn-1]",
    evaluations: [
      { response_id: "claim-1", final_score: 5, explanation: "LABEL: supported [turn-1]" },
      { response_id: "claim-2", final_score: 2, explanation: "LABEL: contradicted [turn-2]" }
    ]
  }), { responseIds: ["claim-1", "claim-2"] });
  assert.equal(result.status, "ok");
  assert.equal(result.evaluations[0].classification, "supported");
  assert.equal(result.evaluations[0].percentage, 100);
  assert.equal(result.evaluations[1].classification, "contradicted");
  assert.deepEqual(result.evaluations[1].evidenceIds, ["turn-2"]);
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

test("factuality pilot is resumable, hides references, and writes a ROUGE-free report", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.jsonl");
  await fs.writeFile(datasetPath, `${JSON.stringify({ id: "m1", transcript: "Chair: The council approved the motion. Staff will report back by June 5.", summary: "The council approved the motion." })}\n`, "utf8");
  const judgeExecutor = async ({ identity }) => {
    const responseId = identity.endsWith("faithfulness") ? "claim-1" : identity.endsWith("coverage") ? "source-item-1" : "summary";
    const classification = identity.endsWith("coverage") ? "covered" : "supported";
    return { text: JSON.stringify({ evaluations: [{ response_id: responseId, final_score: 5, explanation: `LABEL: ${classification} [turn-1]` }] }), timing: { totalElapsedMs: 2 } };
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
  assert.match(await fs.readFile(path.join(root, "criterion", "results", "factuality-test.md"), "utf8"), /ROUGE is intentionally excluded/);
  assert.equal(run.judge.discharge.status, "not-managed-by-adapter");
});
