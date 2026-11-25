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
    /exactly from, at, to, be, and mood/u
  );
});
