import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

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

test("quantity context maps to times/by/per keywords", () => {
  const s = parse("exists su name loop from quantity num 3 via quantity num 2 to quantity num 10 be topic ya");

  assert.deepEqual(s.times, { num: 3 });
  assert.deepEqual(s.by, { num: 2 });
  assert.deepEqual(s.per, { num: 10 });
  assert.ok(!s.from, "from should be normalized to times");
  assert.ok(!s.via, "via should be normalized to by");
  assert.ok(!s.to, "to should be normalized to per");
});

test("limit context maps to atleast/exactly/atmost keywords", () => {
  const s = parse("exists su name fence from limit num 1 via limit num 2 to limit num 3 be topic ya");

  assert.deepEqual(s.atleast, { num: 1 });
  assert.deepEqual(s.exactly, { num: 2 });
  assert.deepEqual(s.atmost, { num: 3 });
  assert.ok(!s.from, "from should be normalized to atleast");
  assert.ok(!s.via, "via should be normalized to exactly");
  assert.ok(!s.to, "to should be normalized to atmost");
});

test("sequence context maps to fromindex/atindex/toindex", () => {
  const s = parse("exists su name item from sequence num 1 via sequence num 2 to sequence num 3 be topic ya");

  assert.deepEqual(s.fromindex, { num: 1 });
  assert.deepEqual(s.atindex, { num: 2 });
  assert.deepEqual(s.toindex, { num: 3 });
  assert.ok(!s.from, "from should be normalized to fromindex");
  assert.ok(!s.via, "via should be normalized to atindex");
  assert.ok(!s.to, "to should be normalized to toindex");
});

test("via space maps to at keyword", () => {
  const s = parse("ob name doors via space slot2 be topic ya");

  assert.deepEqual(s.at, { name: "slot2" });
  assert.ok(!s.via, "via should be normalized to at");
});

test("flat at role parses directly", () => {
  const s = parse("ob name doors at num 2 be topic ya");

  assert.deepEqual(s.at, { num: 2 });
  assert.equal(s.ob?.name, "doors");
});

test("interior context maps outof/in/into keywords", () => {
  const s = parse("exists su name item from interior cellar via interior hallway to interior attic be topic ya");

  assert.deepEqual(s.outof, { name: "cellar" });
  assert.deepEqual(s.in, { name: "hallway" });
  assert.deepEqual(s.into, { name: "attic" });
});

test("surface context maps offof/on/onto keywords", () => {
  const s = parse("exists su name ball from surface table via surface rail to surface shelf be topic ya");

  assert.deepEqual(s.offof, { name: "table" });
  assert.deepEqual(s.on, { name: "rail" });
  assert.deepEqual(s.onto, { name: "shelf" });
});

test("inside keyword aliases to in", () => {
  const s = parse("inside hallway be topic ya");

  assert.deepEqual(s.in, { name: "hallway" });
  assert.ok(!s.inside, "inside should alias to in");
});

test("along keyword aliases to on", () => {
  const s = parse("along rail be topic ya");

  assert.deepEqual(s.on, { name: "rail" });
  assert.ok(!s.along, "along should alias to on");
});

test("under context maps fromunder/under/beneath keywords", () => {
  const s = parse("exists su name crate from under bed via under frame to under floor be topic ya");

  assert.deepEqual(s.fromunder, { name: "bed" });
  assert.deepEqual(s.under, { name: "frame" });
  assert.deepEqual(s.beneath, { name: "floor" });
});

test("person context maps fromperson/with/for keywords", () => {
  const s = parse("exists su name gift from person alice via person bob to person carol be topic ya");

  assert.deepEqual(s.fromperson, { name: "alice" });
  assert.deepEqual(s.with, { name: "bob" });
  assert.deepEqual(s.for, { name: "carol" });
});

test("social context maps fromgroup/among/intogroup keywords", () => {
  const s = parse("exists su name dossier from social admins via social leads to social execs be topic ya");

  assert.deepEqual(s.fromgroup, { name: "admins" });
  assert.deepEqual(s.among, { name: "leads" });
  assert.deepEqual(s.intogroup, { name: "execs" });
});
