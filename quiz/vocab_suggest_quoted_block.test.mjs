import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("vocab_suggest checks quoted pyash blocks", () => {
  const result = spawnSync(
    "node",
    ["program/command/vocab_suggest.mjs", "quiz/fixtures/vocab_suggest_quoted.pya"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /profile/);
});
