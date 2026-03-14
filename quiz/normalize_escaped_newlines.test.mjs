import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("normalize escaped newlines converts literal escapes into real line breaks", () => {
  const run = spawnSync("node", ["command/normalize_escaped_newlines.mjs"], {
    input: "a\\nb\\n",
    encoding: "utf8"
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "a\nb\n");
});
