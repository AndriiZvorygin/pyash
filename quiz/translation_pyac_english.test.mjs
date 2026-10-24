import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePyacSentence,
  translatePyacToEnglishPyash
} from "../program/verbs/exchange/translation/pyac_to_english_pyash.mjs";

test("Pyac decoder expands fused grammar into structural Pyash and English Pyash", () => {
  const result = decodePyacSentence("mina nyahye hcaspuka pfinkiya");
  assert.equal(result.pyash, "su name mi na ob name nyah ye hcas pu ka be pfin ki ya");
  assert.equal(result.englishPyash, 'su I ob name "our houses" be walked ya');
  assert.equal(result.english, "I walked our houses.");
  assert.deepEqual(
    result.tokens.map((token) => token.parts.map((part) => part.pya)),
    [["mi", "na"], ["nyah", "ye"], ["hcas", "pu", "ka"], ["pfin", "ki", "ya"]]
  );
});

test("Pyac decoder restores phrase-final location cases", () => {
  const result = decodePyacSentence("mina hcasputwih pfinkiya");
  assert.equal(result.pyash, "su name mi na ob name hcas pu twih be pfin ki ya");
  assert.equal(result.english, "I walked into houses.");
});

test("Pyac document translation keeps one record per input line", () => {
  const result = translatePyacToEnglishPyash("mina hcaspuka pfinkiya\nmina hpupka kwinpcih");
  assert.equal(result.records.length, 2);
  assert.match(result.englishPyash, /su I ob name "houses" be walked ya/u);
  assert.match(result.englishPyash, /su I ob name "bread" be give pcih/u);
});

test("Pyac decoder rejects vocabulary that cannot be segmented", () => {
  assert.throws(
    () => decodePyacSentence("unknown pfinkiya"),
    (error) => error.code === "invalid-pyac-translation"
  );
});
