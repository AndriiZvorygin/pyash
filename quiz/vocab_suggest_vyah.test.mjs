import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest accepts vyah aspect keywords as grammar terms", async () => {
  const lines = [];
  const result = await runVocabSuggest(["--text", "poll habit cron schedule"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.ok(lines.includes("poll: ok"));
  assert.ok(lines.includes("habit: ok"));
  assert.ok(lines.includes("cron: ok"));
  assert.ok(lines.includes("schedule: ok"));
});

test("vocab_suggest accepts habitual tense keyword tomorrow", async () => {
  const lines = [];
  const result = await runVocabSuggest(["--text", "tomorrow"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.ok(lines.includes("tomorrow: ok"));
});
