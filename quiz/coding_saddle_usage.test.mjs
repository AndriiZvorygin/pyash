import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendSaddleUsage,
  formatSaddleUsageSummary,
  readSaddleUsageRecords,
  readSaddleUsageSummary
} from "../program/agent/coding_saddle_usage.mjs";
import { formatMindUsage, normalizeMindUsage, sumMindUsages } from "../program/verbs/mind/usage.mjs";

test("mind usage normalization accepts provider token vocabularies and derives totals", () => {
  assert.equal(normalizeMindUsage({}), null);
  assert.deepEqual(normalizeMindUsage({
    input_tokens: 12,
    cached_input_tokens: 8,
    cache_write_input_tokens: 1,
    output_tokens: 5,
    reasoning_output_tokens: 3
  }), {
    inputTokens: 12,
    cachedInputTokens: 8,
    cacheWriteInputTokens: 1,
    outputTokens: 5,
    reasoningOutputTokens: 3,
    totalTokens: 17
  });
  assert.deepEqual(normalizeMindUsage({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }), {
    inputTokens: 7,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 2,
    reasoningOutputTokens: 0,
    totalTokens: 9
  });
});

test("coding saddle usage records are durable, replayable, and idempotent", async () => {
  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-usage-"));
  const now = new Date("2026-10-30T12:00:00.000Z");
  const usage = normalizeMindUsage({
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 20,
    reasoning_output_tokens: 6
  });
  try {
    const first = await appendSaddleUsage({
      worldRoot,
      turnId: "turn-000001-abc",
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3",
      usage,
      now
    });
    assert.equal(first.appended, true);
    const second = await appendSaddleUsage({
      worldRoot,
      turnId: "turn-000001-abc",
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3",
      usage,
      now: new Date("2026-10-31T12:00:00.000Z")
    });
    assert.equal(second.appended, false);

    const records = await readSaddleUsageRecords({ worldRoot });
    assert.equal(records.length, 1);
    assert.equal(records[0].turnId, "turn-000001-abc");
    assert.equal(records[0].mindName, "zai");
    assert.equal(records[0].backend, "zai");
    assert.equal(records[0].model, "glm-5.3");
    assert.equal(records[0].usage.totalTokens, 120);

    const summary = await readSaddleUsageSummary({ worldRoot });
    assert.equal(summary.length, 1);
    assert.equal(summary[0].turns, 1);
    assert.match(formatSaddleUsageSummary(summary), /usage: zai\/glm-5\.3 · turns 1 · input 100 \(cached 40, cache write 0\) · output 20 \(reasoning 6\) · total 120/);
  } finally {
    await fs.rm(worldRoot, { recursive: true, force: true });
  }
});

test("mind usage formatting and sums remain provider-neutral", () => {
  const total = sumMindUsages([
    { input_tokens: 10, output_tokens: 4 },
    { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }
  ]);
  assert.deepEqual(total, {
    inputTokens: 17,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 6,
    reasoningOutputTokens: 0,
    totalTokens: 23
  });
  assert.equal(formatMindUsage(total), "input 17 (cached 0, cache write 0) · output 6 (reasoning 0) · total 23");
});
