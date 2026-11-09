import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main as runCriterionCommand } from "../../command/criterion.mjs";
import { loadRun } from "../../program/runtime/criterion/report.mjs";
import {
  runThroughputBenchmark,
  inspectThroughputTargetQueue,
  THROUGHPUT_BENCHMARK_VERSION,
  THROUGHPUT_PROFILE,
  THROUGHPUT_PROMPTS,
  THROUGHPUT_PROMPT_SET_HASH
} from "../../program/runtime/criterion/throughput.mjs";

test("criterion throughput performs excluded warmups then five serial measured calls and writes replayable artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "criterion-throughput-"));
  const calls = [];
  const events = [];
  let active = 0;
  let maxActive = 0;
  let clock = Date.parse("2026-11-08T12:00:00Z");
  const now = () => new Date(clock += 1000);
  try {
    const run = await runThroughputBenchmark({
      model: "SparkLLM/Spark-X2.6-4B:q4_k_m",
      runId: "throughput-test-run",
      hostId: "mriczo",
      gpuId: "gpu-0",
      root,
      now,
      onEvent: event => events.push(event),
      machine: { hostname: "test-machine", platform: "linux", cpu: "test", gpu: "test-gpu" },
      metadataProvider: async ({ model }) => ({ model, modelDigest: "sha256:test-model", quantization: "Q4_K_M" }),
      executor: async request => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(request);
        await Promise.resolve();
        active -= 1;
        const n = calls.length;
        const outputTokens = n === 1 ? 2 : 240 + n;
        return {
          text: `answer-${n}`,
          payload: {
            eval_count: outputTokens,
            eval_duration: 2_000_000_000,
            prompt_eval_count: 100,
            prompt_eval_duration: 500_000_000,
            total_duration: 2_600_000_000
          }
        };
      }
    });

    assert.equal(calls.length, 2 + THROUGHPUT_PROMPTS.length);
    assert.deepEqual(events.slice(0, 4).map(event => `${event.event}:${event.kind}`), [
      "warmup-started:short-ping",
      "warmup-completed:short-ping",
      "warmup-started:first-prompt-replay",
      "warmup-completed:first-prompt-replay"
    ]);
    assert.equal(maxActive, 1);
    assert.deepEqual(calls.map(call => call.identity), [
      "throughput-test-run-warmup-ping",
      "throughput-test-run-warmup-sample",
      ...THROUGHPUT_PROMPTS.map(sample => `throughput-test-run-${sample.id}`)
    ]);
    assert.equal(calls[0].sampling.num_predict, 2);
    assert.equal(calls[1].prompt, THROUGHPUT_PROMPTS[0].prompt);
    assert.ok(calls.slice(1).every(call => call.profile === "summary_direct"));
    assert.ok(calls.slice(1).every(call => call.contextLength === 32768));
    assert.ok(calls.slice(1).every(call => call.sampling.keep_alive === 1800));
    assert.ok(calls.slice(2).every(call => call.sampling.num_predict === THROUGHPUT_PROFILE.num_predict));

    assert.equal(run.status, "completed");
    assert.equal(run.evaluationMode, "warm-throughput");
    assert.equal(run.throughput.version, THROUGHPUT_BENCHMARK_VERSION);
    assert.equal(run.throughput.promptSetHash, THROUGHPUT_PROMPT_SET_HASH);
    assert.equal(run.throughput.hostId, "mriczo");
    assert.equal(run.throughput.modelRetained, true);
    assert.equal(run.throughput.warmups.length, 2);
    assert.equal(run.results.length, 5);
    assert.equal(run.results[0].metrics.generationTokensPerSecond, 121.5);
    assert.equal(run.throughput.aggregate.weightedTokensPerSecond, 122.5);

    const saved = await loadRun("throughput-test-run", { root });
    assert.equal(saved.throughput.promptSetHash, THROUGHPUT_PROMPT_SET_HASH);
    assert.equal(saved.results[0].promptText, THROUGHPUT_PROMPTS[0].prompt);
    for (const filename of ["throughput-test-run.pya", "throughput-test-run.jsonl", "throughput-test-run.md", "throughput-test-run.csv"]) {
      await fs.access(path.join(root, "criterion", "results", filename));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("criterion throughput fails before inference when the model is not in the Housekeeper catalog", async () => {
  let calls = 0;
  await assert.rejects(runThroughputBenchmark({
    model: "missing-model",
    hostId: "mriczo",
    executor: async () => { calls += 1; },
    metadataProvider: async ({ model }) => ({ model, modelDigest: null })
  }), /not verified as installed/u);
  assert.equal(calls, 0);
});

test("throughput preflight records existing work and lets Housekeeper queue the benchmark", async () => {
  const check = await inspectThroughputTargetQueue({
    housekeeperUrl: "http://housekeeper",
    hostId: "mriczo",
    fetchImpl: async url => url.endsWith("/snapshot")
      ? ({ ok: true, json: async () => ({ hostId: "mriczo", executionSlotBusy: true, executionSlots: [{ deviceId: "gpu0", jobs: [{ remoteJobId: "local-running", status: "running" }, { remoteJobId: "local-queued", status: "queued" }] }] }) })
      : ({ ok: true, json: async () => ({ queueDepth: 2, queuedCount: 1, runningCount: 1, softQueueCap: 500, queueOverSoftCap: false, jobs: [
        { remoteJobId: "local-running", status: "running", forwarded: false, executionHostId: "mriczo" },
        { remoteJobId: "local-queued", status: "queued", forwarded: false, executionHostId: "mriczo" },
        { remoteJobId: "remote-running", status: "running", forwarded: true, executionHostId: "swac" }
      ] }) })
  });
  assert.equal(check.localExecutionSlotBusy, true);
  assert.equal(check.targetActiveJobCount, 2);
  assert.deepEqual(check.targetActiveJobIds, ["local-running", "local-queued"]);
  assert.equal(check.queueDepth, 2);
  assert.equal(check.forwardedElsewhere, 1);

  const forwardedOnly = await inspectThroughputTargetQueue({
    housekeeperUrl: "http://housekeeper/",
    hostId: "mriczo",
    fetchImpl: async url => {
      if (url.endsWith("/snapshot")) return { ok: true, json: async () => ({ hostId: "mriczo", executionSlotBusy: false, executionSlots: [{ jobs: [] }] }) };
      assert.equal(url, "http://housekeeper/queue");
      return { ok: true, json: async () => ({ jobs: [{ remoteJobId: "remote-running", status: "running", forwarded: true, executionHostId: "swac" }] }) };
    }
  });
  assert.deepEqual({ hostId: forwardedOnly.hostId, activeJobsObserved: forwardedOnly.activeJobsObserved, forwardedElsewhere: forwardedOnly.forwardedElsewhere }, {
    hostId: "mriczo",
    activeJobsObserved: 1,
    forwardedElsewhere: 1
  });
});

test("criterion throughput requires one pinned model and host", async () => {
  await assert.rejects(runThroughputBenchmark({ executor: async () => {} }), /exactly one --model/u);
  await assert.rejects(runThroughputBenchmark({ model: "model", executor: async () => {} }), /pinned --host-id/u);
  await assert.rejects(runCriterionCommand(["criterion", "throughput", "--model", "one,two", "--host-id", "mriczo"]), /exactly one --model/u);
  await assert.rejects(runCriterionCommand(["criterion", "throughput", "--model", "one"]), /requires --host-id/u);
});
