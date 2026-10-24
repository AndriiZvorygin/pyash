import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePyacSentence,
  translatePyacToEnglishPyash
} from "../program/verbs/exchange/translation/pyac_to_english_pyash.mjs";

test("Pyac decoder expands fused grammar into structural Pyash and English Pyash", () => {
  const result = decodePyacSentence("mina nyahye hcaspuka pfinkiya");
  assert.equal(result.pyash, "su name mi na ob name nyah ye hcas pu ka be pfin ki ya");
  assert.equal(result.englishPyash, "su I ob our houses be walked ya");
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

test("Pyac decoder derives English roles and prepositions from VLIW grammar", () => {
  const prayerOpening = decodePyacSentence("nyahye hpapwu cyakte saye hnimna swutpyohjwih");
  assert.equal(
    prayerOpening.englishPyash,
    "O our dad in heaven, su your name be holy jwih"
  );
  assert.equal(prayerOpening.english, "Our dad in heaven, may your name be holy.");

  const negativeImperative = decodePyacSentence("nyahyi no hyocma tlakpcih");
  assert.equal(
    negativeImperative.englishPyash,
    "su you ob us to temptation be not bring pcih"
  );
  assert.equal(negativeImperative.english, "Do not bring us to temptation.");
});

test("Pyac document translation keeps one record per input line", () => {
  const result = translatePyacToEnglishPyash("mina hcaspuka pfinkiya\nmina hpupka kwinpcih");
  assert.equal(result.records.length, 2);
  assert.match(result.englishPyash, /su I ob houses be walked ya/u);
  assert.match(result.englishPyash, /su I ob bread be give pcih/u);
});

test("Pyac decoder rejects vocabulary that cannot be segmented", () => {
  assert.throws(
    () => decodePyacSentence("unknown pfinkiya"),
    (error) => error.code === "invalid-pyac-translation"
  );
});

test("Pyac decoder takes lexical English from the dictionary", () => {
  const result = decodePyacSentence("pyuh nyahyi cwakso hxucpcih");
  const hxuc = result.tokens.at(-1).parts.find((part) => part.pya === "hxuc");
  assert.equal(hxuc.english, "rescuing");
  assert.equal(result.englishPyash, "su you ob us from evil be rescue pcih");
  assert.equal(result.english, "But rescue us from evil.");
});
