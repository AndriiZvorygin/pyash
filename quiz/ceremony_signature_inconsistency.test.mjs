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

test("evoker with inconsistent signature is rejected", async () => {
  forget();

  const defLines = [
    "su name foo ob name num value to name num bar be ceremony def",
    "ob num 1 to name bar be plus do",
    "su name foo be ceremony prah"
  ];
  await run(defLines);

  const evoker = parse("su name caller ob name baz by num 1 be foo do");
  let err;
  try {
    await interpret(evoker);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected error for signature inconsistency");
  assert.equal(err?.sentence?.be, "error");
  assert.match(err?.sentence?.ob?.text ?? "", /signature inconsistency/i);
});
