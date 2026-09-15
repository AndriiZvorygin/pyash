import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MEETINGBANK_REFERENCE_PROMPT,
  PROMPT_ABLATION_VARIANTS,
  bootstrapConfidenceInterval,
  buildMeetingBankReferencePrompt,
  runPromptAblation
} from "../../program/runtime/criterion/prompt-ablation.mjs";
import { sha256 } from "../../program/runtime/criterion/metrics.mjs";

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), "pyash-ablation-test-")); }

async function writeFixture(root, { withIds = true, withDigest = true } = {}) {
  const datasetPath = path.join(root, "meetingbank.jsonl");
  const annotationPath = path.join(root, "omni.json");
  const row = { id: "m1", uid: "meeting-1", transcript: "Chair: The motion passed. The council voted 5-0.", summary: "The council approved the motion." };
  await fs.writeFile(datasetPath, `${JSON.stringify(row)}\n`, "utf8");
  await fs.writeFile(annotationPath, JSON.stringify([{ dataset: "MeetingBank", ...(withIds ? { sourceId: "m1" } : {}), key_facts: ["The motion passed."] }]), "utf8");
  await fs.mkdir(path.join(root, "criterion", "results"), { recursive: true });
  const loadedPrompt = "Summarize this complete council meeting. Preserve the important decisions and factual details.\n\nTRANSCRIPT:\nChair: The motion passed. The council voted 5-0.";
  await fs.writeFile(path.join(root, "criterion", "results", "generic.json"), JSON.stringify({
    runId: "generic",
    criterion: "meetingbank",
    models: ["qwen3.5:9b"],
    profile: "summary_direct",
    contextLength: 32768,
    sampling: { think: false, reasoningMode: "direct", temperature: 0.2, top_p: 0.8, top_k: 20, contextLength: 32768 },
    modelMetadata: { "qwen3.5:9b": { model: "qwen3.5:9b", modelDigest: withDigest ? "sha256:model" : null, ollamaVersion: "test" } },
    results: [{
      runId: "generic", benchmark: "meetingbank", model: "qwen3.5:9b", engine: "ollama", profile: "summary_direct", contextLength: 32768,
      sampleId: "m1", status: "ok", effectiveThink: false, modelDigest: withDigest ? "sha256:model" : null, inputHash: sha256(row.transcript), promptHash: sha256(loadedPrompt),
      output: "The motion passed and the council voted 5-0.", outputHash: sha256("The motion passed and the council voted 5-0."),
      scores: { rouge1: 0.5, rouge2: 0.4, rougeL: 0.5, schemaValidity: 1 }, metrics: { outputTokens: 9, totalElapsedMs: 100, generationTokensPerSecond: 90 }
    }]
  }), "utf8");
  await fs.writeFile(path.join(root, "criterion", "results", "meeting-script.json"), JSON.stringify({
    runId: "meeting-script", criterion: "meetingbank", models: ["Shaelois/MeetingScript"], results: [{
      runId: "meeting-script", model: "Shaelois/MeetingScript", sampleId: "m1", status: "ok", output: "The council approved the motion.", outputHash: sha256("The council approved the motion."),
      scores: { rouge1: 0.7, rouge2: 0.6, rougeL: 0.7 }, metrics: { totalElapsedMs: 80 }
    }]
  }), "utf8");
  return { datasetPath, annotationPath, loadedPrompt };
}

function fakeMetadata({ model }) { return { model, modelDigest: "sha256:model", ollamaVersion: "test" }; }

test("MeetingBank prompt variant is exact, transcript-bound and hashed separately", () => {
  const prompt = buildMeetingBankReferencePrompt({ input: "A transcript." });
  assert.ok(prompt.includes(MEETINGBANK_REFERENCE_PROMPT));
  assert.match(prompt, /TRANSCRIPT:\nA transcript\./u);
  assert.notEqual(sha256(prompt), sha256("A transcript."));
  assert.equal(PROMPT_ABLATION_VARIANTS.generic, "qwen_baseline_generic");
  assert.equal(PROMPT_ABLATION_VARIANTS.meetingBank, "qwen_meetingbank_reference");
});

test("bootstrap confidence intervals are deterministic and fail closed for no values", () => {
  const first = bootstrapConfidenceInterval([1, 2, 3], { iterations: 100, seed: 7 });
  const second = bootstrapConfidenceInterval([1, 2, 3], { iterations: 100, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(bootstrapConfidenceInterval([]).lower, null);
});

test("paired ablation reuses the generic Qwen row and runs only the MeetingBank prompt", async () => {
  const root = await tempRoot();
  const { datasetPath, annotationPath, loadedPrompt } = await writeFixture(root);
  let calls = 0;
  const run = await runPromptAblation({
    root, datasetPath, annotationPath, sourceRunIds: ["generic"], comparisonRunIds: ["meeting-script"], runId: "paired-smoke", smoke: true,
    executor: async ({ prompt }) => { calls += 1; assert.match(prompt, /city-council agenda segment/u); return { text: "The council approved the motion in a 5-0 vote.", effectiveThink: false, timing: { outputTokens: 10, totalElapsedMs: 120, generationTokensPerSecond: 83 } }; },
    metadataProvider: async ({ model }) => fakeMetadata({ model })
  });
  assert.equal(calls, 1);
  assert.equal(run.status, "completed");
  assert.equal(run.matchedSubsetCount, 1);
  assert.equal(run.selectedSampleCount, 1);
  assert.equal(run.results.length, 2);
  assert.equal(run.results.filter(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.generic)[0].baselineReused, true);
  assert.equal(run.results.filter(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.meetingBank)[0].promptText.includes(MEETINGBANK_REFERENCE_PROMPT), true);
  assert.equal(run.sourceVerification.promptOnlyChange, true);
  assert.equal(run.sourceVerification.modelDigestsMatch, true);
  assert.equal(run.results.filter(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.generic)[0].promptHash, sha256(loadedPrompt));
  assert.notEqual(run.results.filter(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.generic)[0].promptHash, run.results.filter(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.meetingBank)[0].promptHash);
  assert.equal(run.pairedAggregates[0].sampleCount, 1);
  assert.ok(run.pairedAggregates[0].rougeLDelta !== null);
  assert.equal(run.comparisonAggregates[0].aggregate.sampleCount, 1);
  assert.ok(run.promptTemplates[PROMPT_ABLATION_VARIANTS.meetingBank].hash);
  for (const suffix of ["json", "jsonl", "md", "csv", "pya"]) await fs.access(path.join(root, "criterion", "results", `paired-smoke.${suffix}`));
  await fs.access(path.join(root, "criterion", "review", "paired-smoke.html"));
});

test("paired ablation resumes the experimental run without rerunning completed samples", async () => {
  const root = await tempRoot();
  const { datasetPath, annotationPath } = await writeFixture(root);
  let calls = 0;
  const options = {
    root, datasetPath, annotationPath, sourceRunIds: ["generic"], comparisonRunIds: [], runId: "paired-resume",
    executor: async () => { calls += 1; return { text: "The council approved the motion.", effectiveThink: false, timing: { outputTokens: 6, totalElapsedMs: 100 } }; },
    metadataProvider: async ({ model }) => fakeMetadata({ model })
  };
  await runPromptAblation(options);
  await runPromptAblation({ ...options, resume: true, executor: async () => { throw new Error("completed row was rerun"); } });
  assert.equal(calls, 1);
});

test("missing model digest makes a generic row unverifiable instead of silently reusing it", async () => {
  const root = await tempRoot();
  const { datasetPath, annotationPath } = await writeFixture(root, { withDigest: false });
  let calls = 0;
  const run = await runPromptAblation({
    root, datasetPath, annotationPath, sourceRunIds: ["generic"], comparisonRunIds: [], runId: "paired-digest-missing",
    executor: async () => { calls += 1; return { text: "The council approved the motion.", effectiveThink: false, timing: { outputTokens: 6, totalElapsedMs: 100 } }; },
    metadataProvider: async ({ model }) => ({ model, modelDigest: null, ollamaVersion: "test" })
  });
  assert.equal(calls, 2);
  assert.equal(run.results.find(row => row.promptVariant === PROMPT_ABLATION_VARIANTS.generic).baselineReused, false);
  assert.equal(run.sourceVerification.modelDigestsMatch, false);
  assert.equal(run.sourceVerification.promptOnlyChange, false);
});

test("missing Omni source IDs fail closed before making model requests", async () => {
  const root = await tempRoot();
  const { datasetPath, annotationPath } = await writeFixture(root, { withIds: false });
  let calls = 0;
  const run = await runPromptAblation({
    root, datasetPath, annotationPath, sourceRunIds: ["generic"], comparisonRunIds: [], runId: "paired-unmatched", smoke: true,
    executor: async () => { calls += 1; return { text: "unexpected", timing: {} }; },
    metadataProvider: async ({ model }) => fakeMetadata({ model })
  });
  assert.equal(calls, 0);
  assert.equal(run.status, "partial");
  assert.equal(run.matchedSubsetCount, 0);
  assert.equal(run.subsetJoins.unmatched[0].reason, "missing source ID");
});
