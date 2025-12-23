import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

// quoted.<lang>.contents ... .<lang>.quoted syntax should preserve inner spacing

test("captures quoted english block with whitespace", () => {
  const s = parse(
    "su name prompt with quoted.english.This is\n  a block with spaces..english.quoted be topic ya"
  );

  assert.equal(s.with.text, "This is\n  a block with spaces.");
  assert.equal(s.be, "topic");
});

test("captures quoted bash block", () => {
  const s = parse(
    "su name script with quoted.bash.echo \"hi\" | wc -l .bash.quoted be run ya"
  );

  assert.equal(s.with.text, 'echo "hi" | wc -l ');
  assert.equal(s.be, "run");
});
