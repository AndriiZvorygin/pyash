import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { compositionalGrid } from "../library/compositionalCases.mjs";

// Compositional cases: state context with source/destination axes

test("parse captures from/to state context for compile workflow", () => {
  const s = parse("subj name artifact from state draft to state json be compile do");

  assert.deepEqual(s.from, { context: "state", name: "draft", keyword: "fromstate" });
  assert.deepEqual(s.to, { context: "state", name: "json", keyword: "become" });
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

test("compositional grid keywords match documentation table", () => {
  const expected = {
    space: { source: "from", way: "at", destination: "to" },
    interior: { source: "outof", way: "inside", destination: "into" },
    surface: { source: "offof", way: "along", destination: "onto" },
    under: { source: "fromunder", way: "under", destination: "beneath" },
    time: { source: "since", way: "during", destination: "until" },
    state: { source: "fromstate", way: "via", destination: "become" },
    person: { source: "fromperson", way: "with", destination: "for" },
    social: { source: "fromgroup", way: "among", destination: "intogroup" },
    discourse: { source: "fromtext", way: "accordingto", destination: "astext" }
  };

  for (const [ctx, axes] of Object.entries(expected)) {
    const row = compositionalGrid[ctx];
    assert.ok(row, `missing context ${ctx}`);
    for (const [axis, keyword] of Object.entries(axes)) {
      assert.equal(row[axis]?.prep, keyword, `keyword mismatch for ${ctx}.${axis}`);
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
    const fromKeyword = compositionalGrid[ctx].source.prep;
    assert.deepEqual(fromSentence.from, { context: ctx, name: "origin", keyword: fromKeyword });

    const toSentence = parse(`su item to ${ctx} goal be topic ya`);
    const toKeyword = compositionalGrid[ctx].destination.prep;
    assert.deepEqual(toSentence.to, { context: ctx, name: "goal", keyword: toKeyword });
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
    const viaKeyword = compositionalGrid[ctx].way.prep;
    assert.deepEqual(viaSentence.via, { context: ctx, name: "route", keyword: viaKeyword });
  }
});
