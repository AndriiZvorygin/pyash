import test from "node:test";
import assert from "node:assert/strict";

import { forget, remember } from "../program/remember/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { boolean } from "../program/verbs/boolean.mjs";

test("boolean preserves typed truth and lie values at a named destination", async () => {
  forget();
  try {
    await interpret(parse("ob bool truth to name bool answer be boolean do"));
    assert.deepEqual(remember("answer")?.ob, { boolean: true });
    assert.equal(remember("answer")?.be, "boolean");

    await interpret(parse("ob bool lie to name bool answer be boolean do"));
    assert.deepEqual(remember("answer")?.ob, { boolean: false });
  } finally {
    forget();
  }
});

test("boolean rejects non-boolean input rather than coercing it", () => {
  assert.throws(
    () => boolean({ ob: { num: 1 } }),
    /boolean requires a boolean value/u
  );
});

test("interpreter keeps permanently boolean slots read-only", async () => {
  forget();
  try {
    await interpret(parse(
      "exists su name fixed ob bool truth as name permanently boolean be boolean ya"
    ));
    await assert.rejects(
      interpret(parse("ob bool lie to name bool fixed be boolean do")),
      /constant quantity is read-only: fixed/u
    );
  } finally {
    forget();
  }
});
