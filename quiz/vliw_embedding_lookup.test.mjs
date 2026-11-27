import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";

const LOOKUP = "from name pset gjat at num 1 to name lyac dlek be tsoc hsat do";

test("lowers a typed lookup sentence for a named tensor row view", () => {
  const lowered = lowerSentence(parse(LOOKUP));
  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].semantic, "embedding-row-lookup");
  assert.deepEqual(Array.from(lowered[0].words), [
    0x4911, 0x225e, 0xab44, 0xa9b2, 0x313e,
    0x225e, 0xe90b, 0x2b73, 0x243e, 0x881d,
    1, 0x615f, 0xec4a, 0xa948, 0x295e, 0
  ]);
});

test("rejects lookup sentences without the exact table, row, alias, and verb fields", () => {
  assert.throws(
    () => lowerSentence(parse("from name pset gjat at num 1 to name lyac dlek by name hwas be tsoc hsat do")),
    /requires from, at, optional fromindex/u
  );
});

test("lowers a payload-backed named index for dynamic embedding-row selection", () => {
  const lowered = lowerSentence(parse(
    "from name pset gjat at name lwat txik to name lyac dlek be tsoc hsat do"
  ));
  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].semantic, "embedding-row-lookup");
  assert.deepEqual(Array.from(lowered[0].words), [
    0x9111, 0x225e, 0xab44, 0xa9b2, 0x313e,
    0x225e, 0xe90b, 0x2b73, 0x243e, 0x225e,
    0xa92b, 0x28ea, 0x615f, 0xec4a, 0xa948, 0x295e
  ]);
});

test("lowers a token-sequence position into the existing fromindex case", () => {
  const lowered = lowerSentence(parse(
    "from name pset gjat at name lwat txik fromindex num 0 to name lyac dlek be tsoc hsat do"
  ));
  assert.equal(lowered.length, 2);
  assert.equal(lowered[0].semantic, "embedding-row-lookup");
  assert.deepEqual(lowered.flatMap(({ words }) => Array.from(words)), [
    28398, 8798, 43844, 43442, 12606, 8798, 59659, 11123,
    9278, 8798, 43307, 10474, 24927, 34845, 0, 25431,
    9, 60490, 43336, 10590, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
  ]);
});

test("rejects embedding selectors that are not a uint16 literal or named index", () => {
  assert.throws(
    () => lowerSentence(parse("from name pset gjat at text row to name lyac dlek be tsoc hsat do")),
    /named index/u
  );
});
