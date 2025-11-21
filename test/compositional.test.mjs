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

test("to discourse maps to totext keyword", () => {
  const s = parse("su doc to discourse summary be topic ya");

  assert.deepEqual(s.totext, { name: "summary" });
  assert.ok(!s.to, "to should be normalized to totext");
});

test("compositional roles do not expose context field", () => {
  const s = parse("su doc from discourse spec via time now to state json be topic ya");

  assert.ok(!("context" in (s.fromtext || {})));
  assert.ok(!("context" in (s.during || {})));
  assert.ok(!("context" in (s.become || {})));
});
