import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSH_CASE_REGISTER_LAYOUT,
  syshCaseRegisterForKeyword,
  syshCompoundWordCapacity
} from "../program/library/compile/sysh_case_registers.mjs";
import {
  prepareSyshSentencePattern,
  lookupSyshSentencePattern,
  SYSH_CONTROL_REGISTER_LAYOUT
} from "../program/library/compile/sysh_sentence_pattern.mjs";
import {
  clearSignatureHandlers,
  registerSignatureHandler
} from "../program/bridge/signature.mjs";
import { parse } from "../program/understand/index.mjs";

test("Sysh assigns stable virtual registers to grid cells and core cases", () => {
  assert.equal(SYSH_CASE_REGISTER_LAYOUT.length, 38);
  assert.deepEqual(
    SYSH_CASE_REGISTER_LAYOUT.map(({ index }) => index),
    Array.from({ length: 38 }, (_, index) => index)
  );
  assert.equal(new Set(SYSH_CASE_REGISTER_LAYOUT.map(({ keyword }) => keyword)).size, 38);
  assert.equal(syshCaseRegisterForKeyword("su").pya, "na");
  assert.equal(syshCaseRegisterForKeyword("ob").pya, "ka");
});

test("reused case HNUCs remain distinct context-specific registers", () => {
  const sourceRegisters = ["from", "fromperson", "fromgroup", "fromtext"]
    .map(syshCaseRegisterForKeyword);

  assert.equal(new Set(sourceRegisters.map(({ hnuc }) => hnuc)).size, 1);
  assert.equal(new Set(sourceRegisters.map(({ index }) => index)).size, 4);
});

test("unassigned grid cells reserve virtual slots without inventing HNUCs", () => {
  for (const keyword of ["by", "per", "atleast", "exactly", "atmost", "fromindex", "atindex", "toindex"]) {
    const register = syshCaseRegisterForKeyword(keyword);
    assert.ok(register, `${keyword} has a virtual register slot`);
    assert.equal(register.encodable, false);
    assert.equal(register.hnuc, null);
  }
});

test("non-case dispatch fields are not assigned a case register", () => {
  assert.equal(syshCaseRegisterForKeyword("from"), SYSH_CASE_REGISTER_LAYOUT[0]);
  assert.equal(syshCaseRegisterForKeyword("be"), null);
});

test("Sysh dispatch pattern uses the Pyash verb, case, and value-type signature", () => {
  const first = prepareSyshSentencePattern(parse("from num 2 to num 3 be plus do"));
  const samePattern = prepareSyshSentencePattern(parse("from num 20 to num 30 be plus do"));
  const differentPattern = prepareSyshSentencePattern(parse("ob num 2 to num 3 be plus do"));
  const sameSignatureDifferentMood = prepareSyshSentencePattern(parse("from num 2 to num 3 be plus ya"));

  assert.equal(first.patternKey, "be plus from num to num");
  assert.equal(first.patternKey, samePattern.patternKey);
  assert.equal(first.patternKey, sameSignatureDifferentMood.patternKey);
  assert.deepEqual(first.controlRegisters, [
    { ...SYSH_CONTROL_REGISTER_LAYOUT[0], value: "plus" },
    { ...SYSH_CONTROL_REGISTER_LAYOUT[1], value: "do" }
  ]);
  assert.equal(sameSignatureDifferentMood.controlRegisters[1].value, "ya");
  assert.notEqual(first.patternKey, differentPattern.patternKey);
  assert.deepEqual(
    first.caseRegisters.map(({ keyword, index, value }) => [keyword, index, value.num]),
    [["from", 0, 2], ["to", 2, 3]]
  );
  assert.deepEqual(
    differentPattern.caseRegisters.map(({ keyword, index }) => [keyword, index]),
    [["to", 2], ["ob", 37]].sort((left, right) => left[1] - right[1])
  );
});

test("Sysh sentence-pattern lookup resolves through the existing Pyash handler registry", () => {
  const sentence = parse("from num 2 to num 3 be plus do");
  const handler = () => "matched";
  const pattern = prepareSyshSentencePattern(sentence);
  registerSignatureHandler({ signatureWords: pattern.signatureWords, handler });

  try {
    assert.equal(lookupSyshSentencePattern(sentence).handler, handler);
    assert.equal(
      lookupSyshSentencePattern(parse("from num 20 to num 30 be plus do")).handler,
      handler
    );
    assert.equal(
      lookupSyshSentencePattern(parse("ob num 2 to num 3 be plus do")).handler,
      null
    );
  } finally {
    clearSignatureHandlers();
  }
});

test("inline Pyash compounds fit two words in 32-bit and four in 64-bit registers", () => {
  assert.equal(syshCompoundWordCapacity(32), 2);
  assert.equal(syshCompoundWordCapacity(64), 4);
  assert.throws(() => syshCompoundWordCapacity(24), /multiple of 16 bits/);
});
