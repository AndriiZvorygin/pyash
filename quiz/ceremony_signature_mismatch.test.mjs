import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

function run(lines) {
  return Promise.all(lines.map(async line => {
    const s = parse(line);
    if (s) return interpret(s);
  }));
}

test("evoker with mismatched signature is rejected", async () => {
  forget();

  const defLines = [
    "subj name foo obj name num to name bar be ceremony def",
    "obj num 1 to name bar be add do",
    "subj name foo be ceremony prah"
  ];
  await run(defLines);

  const evoker = parse("subj name caller obj name baz by num 1 be foo do");
  let err;
  try {
    await interpret(evoker);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected error for signature mismatch");
  assert.equal(err?.sentence?.be, "error");
  assert.match(err?.sentence?.obj?.text ?? "", /signature mismatch/i);
});
