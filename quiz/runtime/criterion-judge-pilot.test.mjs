import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MEETINGBANK_JUDGE_PILOT_PROMPT_HASH,
  MEETINGBANK_JUDGE_PILOT_SELECTION_SEED,
  UNIRRM_MODEL_ID,
  normalizeUniRrmJudgement,
  parseUniRrmOutput,
  runMeetingBankJudgePilot,
  selectMeetingBankJudgePilotSamples
} from "../../program/runtime/criterion/judge-pilot.mjs";
import { createHuggingFaceJudgeExecutor } from "../../program/runtime/criterion/huggingface.mjs";

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-judge-pilot-")); }

test("MeetingBank judge pilot selection is deterministic and shared across models", () => {
  const samples = [
    { id: "short", input: "Short transcript.", metadata: { transcriptTokens: 20, type: "committee" } },
    { id: "medium", input: "Medium transcript.", metadata: { transcriptTokens: 1500, type: "council" } },
    { id: "long", input: "Long transcript.", metadata: { transcriptTokens: 5000, type: "council" } },
    { id: "other", input: "Other transcript.", metadata: { transcriptTokens: 300, type: "public" } }
  ];
  const first = selectMeetingBankJudgePilotSamples(samples, { seed: MEETINGBANK_JUDGE_PILOT_SELECTION_SEED, count: 3 });
  const second = selectMeetingBankJudgePilotSamples([...samples].reverse(), { seed: MEETINGBANK_JUDGE_PILOT_SELECTION_SEED, count: 3 });
  assert.deepEqual(first.map(sample => sample.id), second.map(sample => sample.id));
  assert.equal(new Set(first.map(sample => sample.id)).size, 3);
});

test("UniRRM parser strips thinking and normalizes the native five-point scale", () => {
  const parsed = parseUniRrmOutput('<think>private reasoning</think>\n{"overall_score": 5, "faithfulness_score": 3, "unsupported_claims": ["claim"], "final_verdict": "acceptable"}');
  assert.equal(parsed.valid, true);
  const judgement = normalizeUniRrmJudgement(parsed.value);
  assert.equal(judgement.normalizedPercentages.overallPercentage, 100);
  assert.equal(judgement.normalizedPercentages.faithfulnessPercentage, 50);
  assert.deepEqual(judgement.unsupported_claims, ["claim"]);
  assert.equal(judgement.scale.formula, "((score - 1) / 4) * 100");
});

test("UniRRM native pairwise output exposes best response without a reference", () => {
  const parsed = parseUniRrmOutput(JSON.stringify({ best_id: "Response2", evaluations: [{ response_id: "Response1", final_score: 2 }, { response_id: "Response2", final_score: 4 }] }));
  const judgement = normalizeUniRrmJudgement(parsed.value, { mode: "pairwise" });
  assert.equal(judgement.final_verdict, "Response2");
  assert.equal(judgement.overall_score, 2);
});

test("Hugging Face judge adapter uses the existing durable queue with a judge operation", async () => {
  const requests = [];
  const workerCalls = [];
  let status = { status: "queued" };
  const adapter = await createHuggingFaceJudgeExecutor({
    root: await tempRoot(),
    runId: "judge-adapter",
    housekeeperUrl: "http://housekeeper:8090",
    enqueue: async (_root, envelope) => requests.push(envelope),
    writeStatus: async () => {},
    readStatus: async () => status,
    workerRunner: async options => {
      workerCalls.push(options);
      status = { status: "success", result: JSON.stringify({ text: JSON.stringify({ overall_score: 4 }), timing: {} }) };
    },
    pollMs: 1
  });
  const messages = [{ role: "system", content: "system" }, { role: "user", content: "judge this" }];
  const result = await adapter.executor({ prompt: "judge this", messages, sample: { id: "m1", input: "source" } });
  assert.equal(result.text, '{"overall_score":4}');
  assert.equal(requests[0].jobSpec.kind, "huggingface-generate");
  assert.equal(requests[0].jobSpec.payload.operation, "judge");
  assert.equal(requests[0].jobSpec.payload.model, UNIRRM_MODEL_ID);
  assert.equal(requests[0].jobSpec.payload.input, "judge this");
  assert.deepEqual(requests[0].jobSpec.payload.messages, messages);
  assert.equal(workerCalls.length, 1);
  assert.equal(workerCalls[0].maxPolls, 7201);
  await adapter.close();
});

test("judge pilot checkpoints pointwise and pairwise rows without exposing references to the judge", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.json");
  await fs.writeFile(datasetPath, `${JSON.stringify([
    { id: "m1", transcript: "The council approved the budget.", summary: "Reference one." },
    { id: "m2", transcript: "The council deferred the motion.", summary: "Reference two." }
  ])}\n`, "utf8");
  const models = ["qwen3.5:9b", "qwen3.8:27b", "qwen3.8:9b"];
  const seenPrompts = [];
  const generationRunner = async ({ id, samples }) => ({
    runId: id,
    results: samples.flatMap(sample => models.map(model => ({
      runId: id,
      model,
      sampleId: sample.id,
      status: "ok",
      output: `${model} summary`,
      outputHash: `${model}-${sample.id}`,
      inputHash: `input-${sample.id}`,
      modelDigest: `digest-${model}`,
      reference: sample.reference,
      scores: { rouge1: 0.2, rouge2: 0.1, rougeL: 0.15 },
      metrics: { totalElapsedMs: 10, outputTokens: 4, generationTokensPerSecond: 400 }
    })))
  });
  const judgeExecutor = async ({ prompt }) => {
    seenPrompts.push(prompt);
    const value = prompt.includes("<Response1")
      ? { best_id: "Response1", evaluations: [{ response_id: "Response1", final_score: 4 }, { response_id: "Response2", final_score: 3 }] }
      : { overall_score: 4, faithfulness_score: 4, completeness_score: 3, decision_action_coverage_score: 3, relevance_conciseness_score: 4, municipal_summary_suitability_score: 4, unsupported_claims: [], contradicted_claims: [], omitted_important_items: [], evidence: [{ source: "s1" }], confidence: 4, final_verdict: "acceptable" };
    return { text: JSON.stringify(value), timing: { totalElapsedMs: 5 } };
  };
  const run = await runMeetingBankJudgePilot({ root, datasetPath, models, selectionCount: 2, runId: "pilot-test", generationRunner, judgeExecutor });
  assert.equal(run.selection.count, 2);
  assert.equal(run.generationRows.length, 6);
  assert.equal(run.pointwiseRows.length, 6);
  assert.equal(run.pairwiseRows.length, 6);
  assert.equal(run.status, "completed");
  assert.ok(seenPrompts.every(prompt => !prompt.includes("Reference one") && !prompt.includes("Reference two")));
  assert.equal(run.promptHash, MEETINGBANK_JUDGE_PILOT_PROMPT_HASH);
  await fs.access(path.join(root, "criterion", "results", "pilot-test.jsonl"));
  const checkpoint = (await fs.readFile(path.join(root, "criterion", "results", "pilot-test.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(checkpoint.length, 12);
  assert.equal(new Set(checkpoint.map(row => row.identity)).size, 12);
});
