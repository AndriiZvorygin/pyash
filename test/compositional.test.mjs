import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";

// New compositional keyword mapping: axis + context become keyword fields

test("via time maps to during keyword", () => {
  const s = parse("su item via time now be topic ya");

  assert.deepEqual(s.during, { name: "now" });
  assert.ok(!s.via, "via should be normalized to during");
});

test("from discourse maps to fromtext keyword", () => {
  const s = parse("su doc from discourse spec be topic ya");

  assert.deepEqual(s.fromtext, { name: "spec" });
  assert.ok(!s.from, "from should be normalized to fromtext");
});

test("to state maps to become keyword", () => {
  const s = parse("su artifact to state json be topic ya");

  assert.deepEqual(s.become, { name: "json" });
  assert.ok(!s.to, "to should be normalized to become");
});
