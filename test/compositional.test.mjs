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

test("compositional grid covers all contexts and axes", () => {
  const contexts = [
    "space",
    "interior",
    "surface",
    "under",
    "time",
    "state",
    "person",
    "social",
    "discourse"
  ];

  for (const ctx of contexts) {
    const row = compositionalGrid[ctx];
    assert.ok(row, `missing context ${ctx}`);
    for (const axis of ["source", "way", "destination"]) {
      assert.ok(row[axis]?.hnuc, `missing ${ctx}.${axis}`);
    }
  }
});

test("parser captures all contexts for from/to", () => {
  const contexts = [
    "space",
    "interior",
    "surface",
    "under",
    "time",
    "state",
    "person",
    "social",
    "discourse"
  ];

  for (const ctx of contexts) {
    const fromSentence = parse(`su item from ${ctx} origin be topic ya`);
    assert.deepEqual(fromSentence.from, { context: ctx, name: "origin" });

    const toSentence = parse(`su item to ${ctx} goal be topic ya`);
    assert.deepEqual(toSentence.to, { context: ctx, name: "goal" });
  }
});

test("parser captures all contexts for via/way", () => {
  const contexts = [
    "space",
    "interior",
    "surface",
    "under",
    "time",
    "state",
    "person",
    "social",
    "discourse"
  ];

  for (const ctx of contexts) {
    const viaSentence = parse(`su item via ${ctx} route be topic ya`);
    assert.deepEqual(viaSentence.via, { context: ctx, name: "route" });
  }
});
