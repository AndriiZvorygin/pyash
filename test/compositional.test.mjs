import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { compositionalGrid } from "../library/compositionalCases.mjs";

// Compositional cases: state context with source/destination axes

test("parse captures from/to state context for compile workflow", () => {
  const s = parse("subj name artifact from state draft to state json be compile do");

  assert.deepEqual(s.from, { context: "state", name: "draft" });
  assert.deepEqual(s.to, { context: "state", name: "json" });
});

// sanity: mapping exists in the compositional grid

test("compositional grid exposes state source/destination cases", () => {
  assert.ok(compositionalGrid.state?.source?.hnuc, "state source case missing");
  assert.ok(compositionalGrid.state?.destination?.hnuc, "state destination case missing");
});
