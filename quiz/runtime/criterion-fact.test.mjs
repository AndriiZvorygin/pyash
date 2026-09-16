import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  computeFactMetrics,
  createDeterministicFactJudge,
  createOllamaFactJudge,
  joinOmniMeetingSample,
  municipalClaimFlags,
  normalizeFactEvidence,
  runFactAudit,
  splitFactSentences
} from "../../program/runtime/criterion/fact-audit.mjs";
import { renderRunCsv, renderRunMarkdown } from "../../program/runtime/criterion/report.mjs";

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), "pyash-fact-test-")); }

test("fact metrics implement OmniCSEval completeness, conciseness and faithfulness", () => {
  const metrics = computeFactMetrics({
    keyFacts: [{ id: "f1" }, { id: "f2" }, { id: "f3" }],
    summarySentences: [{ id: "s1" }, { id: "s2" }],
    matches: [
      { keyFactId: "f1", summarySentenceId: "s1", matched: true },
      { keyFactId: "f1", summarySentenceId: "s1", matched: true },
      { keyFactId: "f2", summarySentenceId: "s2", matched: true }
    ],
    claims: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    verifications: [
      { claimId: "c1", support: "supported" },
      { claimId: "c2", support: "unsupported" },
      { claimId: "c3", support: "contradiction" }
    ]
  });
  assert.equal(metrics.completeness, 2 / 3);
  assert.equal(metrics.completenessPercent, (2 / 3) * 100);
  assert.equal(metrics.conciseness, 1);
  assert.equal(metrics.faithfulness, 1 / 3);
  assert.equal(metrics.matchedKeyFactCount, 2);
  assert.equal(metrics.unsupportedClaimCount, 1);
  assert.equal(metrics.contradictionCount, 1);
  assert.equal(metrics.unresolvedJudgeCount, 0);
});

test("fact metrics fail closed for empty denominators and preserve missing evidence", () => {
  const metrics = computeFactMetrics({ keyFacts: [], summarySentences: [], claims: [], verifications: [], informativeSentenceCount: 0 });
  assert.equal(metrics.completeness, null);
  assert.equal(metrics.conciseness, null);
  assert.equal(metrics.faithfulness, null);
  assert.equal(metrics.informativeSentenceCount, 0);
  const missing = normalizeFactEvidence({ verifications: [{ claimId: "c1", support: "unresolved" }] }, { sourceText: "Source.", summaryText: "Claim." });
  assert.equal(missing.verifications[0].support, "unresolved");
  assert.equal(missing.verifications[0].claimId, "claim-s1");
});

test("fact sentences and municipal flags retain evidence-friendly boundaries", () => {
  const sentences = splitFactSentences("Chair: The motion passed.\nClerk: The vote was 5-2!");
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, "Chair: The motion passed.");
  assert.equal(sentences[1].text, "Clerk: The vote was 5-2!");
  assert.equal(sentences[0].start, 0);
  const flags = municipalClaimFlags("The council approved a $12,000 grant by June 3, 2026; the clerk recorded the final outcome.");
  assert.equal(flags.approvalOrRejection, true);
  assert.equal(flags.monetaryAmount, true);
  assert.equal(flags.date, true);
  assert.equal(flags.departmentOrResponsiblePerson, true);
  assert.equal(flags.finalOutcome, true);
});

test("checked-in fact fixture covers municipal evidence and an omitted key fact", async () => {
  const fixture = JSON.parse(await fs.readFile(path.resolve("criterion/fixtures/fact-audit/meeting-001.json"), "utf8"));
  const evidence = normalizeFactEvidence(fixture, { sourceText: fixture.sourceText, summaryText: fixture.summary });
  const metrics = computeFactMetrics(evidence);
  assert.equal(evidence.keyFacts.length, 4);
  assert.equal(evidence.keyFacts.find(fact => fact.id === "fact-motion").flags.motion, true);
  assert.equal(evidence.keyFacts.find(fact => fact.id === "fact-vote").flags.vote, true);
  assert.equal(evidence.keyFacts.find(fact => fact.id === "fact-amount").flags.monetaryAmount, true);
  assert.equal(evidence.keyFacts.find(fact => fact.id === "fact-deadline").flags.deadline, true);
  assert.equal(metrics.matchedKeyFactCount, 1);
  assert.equal(metrics.unsupportedClaimCount, 1);
});

test("exact Omni joins require one explicit MeetingBank source match", () => {
  const samples = [
    { id: "local-1", metadata: { meetingId: "MB-1" } },
    { id: "local-2", metadata: { meetingId: "MB-2" } }
  ];
  const joined = joinOmniMeetingSample([
    { sourceDataset: "MeetingBank", sourceId: "MB-1", keyFacts: [] },
    { sourceDataset: "MeetingBank", sourceId: "missing", keyFacts: [] },
    { sourceDataset: "QMSum", sourceId: "MB-2", keyFacts: [] }
  ], samples);
  assert.equal(joined.matched.length, 1);
  assert.equal(joined.unmatched.length, 2);
  const ambiguous = joinOmniMeetingSample([{ sourceDataset: "MeetingBank", sourceId: "same" }], [
    { id: "a", metadata: { meetingId: "same" } },
    { id: "b", metadata: { meetingId: "same" } }
  ]);
  assert.equal(ambiguous.unmatched[0].reason, "ambiguous source ID");
});

test("Ollama fact judge is an external structured adapter", async () => {
  let call;
  const judge = createOllamaFactJudge({ model: "judge-model", baseUrl: "http://judge.test" });
  const result = await judge({
    sourceText: "The council approved the grant.",
    summaryText: "The grant was approved.",
    fetchImpl: async (url, options) => {
      call = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ keyFacts: [], claims: [], matches: [], verifications: [] }) } }) };
    }
  });
  assert.equal(call.url, "http://judge.test/api/chat");
  assert.equal(call.body.model, "judge-model");
  assert.equal(call.body.think, false);
  assert.equal(call.body.format, "json");
  assert.equal(call.body.options.num_predict, 4096);
  assert.equal(result.judge.provider, "ollama");
  assert.equal(result.judge.model, "judge-model");
});

test("post-hoc fact audit reuses saved rows and resumes without a second judge call", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.json");
  await fs.writeFile(datasetPath, `${JSON.stringify([{ id: "m1", transcript: "The council approved a $20 grant. The vote was unanimous.", summary: "The council approved a $20 grant." }])}\n`, "utf8");
  await fs.mkdir(path.join(root, "criterion", "results"), { recursive: true });
  await fs.writeFile(path.join(root, "criterion", "results", "source.json"), JSON.stringify({
    runId: "source", criterion: "meetingbank", models: ["MeetingScript"], results: [{ runId: "source", model: "MeetingScript", sampleId: "m1", status: "ok", inputHash: "source-input", outputHash: "source-output", output: "The council approved a $20 grant." }]
  }), "utf8");
  const judge = createDeterministicFactJudge();
  let calls = 0;
  const countedJudge = async input => { calls += 1; return judge(input); };
  const run = await runFactAudit({ root, datasetPath, sourceRunIds: ["source"], runId: "fact-smoke", judge: countedJudge, judgeProvider: "deterministic", smoke: true });
  assert.equal(calls, 1);
  assert.equal(run.evaluationMode, "automated_proxy");
  assert.equal(run.results[0].status, "ok");
  assert.equal(run.results[0].sourceRunId, "source");
  assert.ok(run.results[0].scores.faithfulness !== null);
  assert.match(renderRunMarkdown(run), /Fact evaluation/);
  assert.match(renderRunMarkdown(run), /automated_proxy/);
  assert.match(renderRunCsv(run), /faithfulness_percent/);
  for (const suffix of ["json", "jsonl", "md", "csv", "pya"]) await fs.access(path.join(root, "criterion", "results", `fact-smoke.${suffix}`));
  await fs.access(path.join(root, "criterion", "review", "fact-smoke.html"));
  const resumed = await runFactAudit({ root, datasetPath, sourceRunIds: ["source"], runId: "fact-smoke", judge: async () => { throw new Error("resume called judge"); }, resume: true, smoke: true });
  assert.equal(resumed.results.length, 1);
  assert.equal(calls, 1);
  assert.equal(resumed.results[0].outputHash, run.results[0].outputHash);
});

test("fact audit preserves failed judge attempts and records the retry", async () => {
  const root = await tempRoot();
  const datasetPath = path.join(root, "meetingbank.json");
  await fs.writeFile(datasetPath, `${JSON.stringify([{ id: "m1", transcript: "The council approved the grant.", summary: "" }])}\n`, "utf8");
  await fs.mkdir(path.join(root, "criterion", "results"), { recursive: true });
  await fs.writeFile(path.join(root, "criterion", "results", "source.json"), JSON.stringify({
    runId: "source", criterion: "meetingbank", models: ["MeetingScript"], results: [{ runId: "source", model: "MeetingScript", sampleId: "m1", status: "ok", output: "The grant was approved." }]
  }), "utf8");
  const first = await runFactAudit({ root, datasetPath, sourceRunIds: ["source"], runId: "fact-retry", judge: async () => { throw new Error("temporary judge failure"); } });
  assert.equal(first.results[0].status, "error");
  const second = await runFactAudit({ root, datasetPath, sourceRunIds: ["source"], runId: "fact-retry", judge: createDeterministicFactJudge(), resume: true });
  assert.equal(second.results[0].status, "ok");
  assert.equal(second.results[0].retryCount, 1);
  assert.equal(second.attemptHistory.length, 1);
  const checkpoint = (await fs.readFile(path.join(root, "criterion", "results", "fact-retry.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(checkpoint.length, 2);
  assert.equal(checkpoint[0].status, "ok");
  assert.equal(checkpoint[1].status, "error");
});

test("exact mode preserves released key facts while still using saved output rows", async () => {
  const root = await tempRoot();
  const fixture = JSON.parse(await fs.readFile(path.resolve("criterion/fixtures/fact-audit/meeting-001.json"), "utf8"));
  const datasetPath = path.join(root, "meetingbank.json");
  await fs.writeFile(datasetPath, `${JSON.stringify([{ id: "fixture-meeting-001", transcript: fixture.sourceText, summary: "" }])}\n`, "utf8");
  await fs.mkdir(path.join(root, "criterion", "results"), { recursive: true });
  await fs.writeFile(path.join(root, "criterion", "results", "exact-source.json"), JSON.stringify({
    runId: "exact-source", criterion: "meetingbank", models: ["MeetingScript"], results: [{ runId: "exact-source", model: "MeetingScript", sampleId: "fixture-meeting-001", status: "ok", inputHash: "input", outputHash: "output", output: fixture.summary }]
  }), "utf8");
  const run = await runFactAudit({
    mode: "omnicseval-meeting",
    root,
    datasetPath,
    annotationPath: path.resolve("criterion/fixtures/fact-audit/meeting-001.json"),
    sourceRunIds: ["exact-source"],
    runId: "exact-fact",
    judge: createDeterministicFactJudge(),
    judgeProvider: "deterministic"
  });
  assert.equal(run.status, "completed");
  assert.equal(run.evaluationMode, "exact-omnicseval-compatible");
  assert.equal(run.results[0].scores.keyFactCount, 4);
  assert.equal(run.unmatchedJoins.length, 0);
});
