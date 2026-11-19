import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";

const booleanLiteral = "be not ob la ob bool truth be boolean ya ko do";

test("boolean not lowers its nested boolean with grammatical HNUCs", () => {
  const lowered = lowerSentence(parse(booleanLiteral));

  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].semantic, "boolean-composition");
  assert.deepEqual([...lowered[0].words], [
    0x02a9,
    0x257e, 0x6909, 0x245e, 0x7271, 0x217e, 0x305e, 0x245e, 0x30de, 0x295e,
    0, 0, 0, 0, 0, 0
  ]);
});

test("pure literal comparisons lower as boolean expression leaves", () => {
  const lowered = lowerSentence(parse("su num 5 from num 5 be equally do"));
  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].semantic, "boolean-comparison");
});

test("Pyash reference evaluates nested boolean literals consistently", async () => {
  forget();
  try {
    const result = await interpret(parse(booleanLiteral));
    assert.equal(result?.value?.boolean ?? result?.ob?.boolean, false);

    const conjunction = await interpret(parse(
      "be and ob la ob bool truth be boolean ya ko with la ob bool lie be boolean ya ko do"
    ));
    assert.equal(conjunction?.value?.boolean ?? conjunction?.ob?.boolean, false);

    const disjunction = await interpret(parse(
      "be or ob la ob bool lie be boolean ya ko with la ob bool truth be boolean ya ko do"
    ));
    assert.equal(disjunction?.value?.boolean ?? disjunction?.ob?.boolean, true);

    const nested = await interpret(parse(
      "be and ob la ob bool truth be boolean ya ko with la be not ob la ob bool truth be boolean ya ko do ko do"
    ));
    assert.equal(nested?.value?.boolean ?? nested?.ob?.boolean, false);
  } finally {
    forget();
  }
});
