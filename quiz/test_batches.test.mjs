import assert from "node:assert/strict";
import test from "node:test";

import {
  batchItems,
  DEFAULT_TEST_CONCURRENCY,
  MAX_TEST_BATCH_COUNT,
  recommendedTestConcurrency,
  TEST_HOST_MEMORY_RESERVE_BYTES,
  TEST_WORKER_MEMORY_BUDGET_BYTES
} from "../command/test_batches.mjs";

test("test batches preserve order and cap each fresh runner process", () => {
  const files = Array.from({ length: MAX_TEST_BATCH_COUNT * 100 + 3 }, (_, index) => `quiz-${index}`);
  const batches = batchItems(files);

  assert.deepEqual(batches.map((batch) => batch.length), [101, 101, 101]);
  assert.deepEqual(batches.flat(), files);
  assert.ok(DEFAULT_TEST_CONCURRENCY >= 1);
});

test("test batching handles empty input and rejects invalid sizes", () => {
  assert.deepEqual(batchItems([]), []);
  assert.throws(() => batchItems(["quiz.test.mjs"], 0), /positive safe integer/u);
  assert.throws(() => batchItems("quiz.test.mjs"), /must be an array/u);
});

test("test concurrency leaves a CPU free and stays within available RAM", () => {
  const gib = 1024 ** 3;
  assert.equal(recommendedTestConcurrency({ cpuCount: 12, memoryBytes: 40 * gib }), 11);
  assert.equal(recommendedTestConcurrency({ cpuCount: 32, memoryBytes: 10 * gib }), 4);
  assert.equal(recommendedTestConcurrency({ cpuCount: 1, memoryBytes: 40 * gib }), 1);
  assert.equal(recommendedTestConcurrency({ cpuCount: 32, memoryBytes: 1 * gib }), 1);
  assert.equal(TEST_WORKER_MEMORY_BUDGET_BYTES, 2 * gib);
  assert.equal(TEST_HOST_MEMORY_RESERVE_BYTES, 2 * gib);
});
