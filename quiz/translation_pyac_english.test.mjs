import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePyacSentence,
  renderEnglishFromVliw,
  translatePyacToEnglishPyash
} from "../program/verbs/exchange/translation/pyac_to_english_pyash.mjs";
import {
  decodePhraseVliw,
  lowerSentencePhraseVliw
} from "../program/library/vliw/phrase.mjs";

test("Pyac lowering uses suffix roles instead of structural su/ob/name tokens", () => {
  const lowered = lowerSentencePhraseVliw({
    mood: "ya",
    su: { name: "mi na" },
    ob: { name: "hcas pu ka" },
    be: "pfin ki"
  });
  const decoded = decodePhraseVliw(lowered.vectors);
  assert.deepEqual(decoded.tokens.map((token) => token.pya), [
    "mi", "na", "hcas", "pu", "ka", "pfin", "ki", "ya"
  ]);
});

test("Pyac lowering marks an explicitly named variable while lexical phrases stay unmarked", () => {
  const lowered = lowerSentencePhraseVliw({
    mood: "ya",
    su: { name: "mi na" },
    be: "pfin ki"
  }, { markNames: true });
  assert.deepEqual(decodePhraseVliw(lowered.vectors).tokens.map((token) => token.pya), [
    "mi", "gi", "na", "pfin", "ki", "ya"
  ]);
});

test("Pyac decoder separates English Pyash from encoded structural evidence", () => {
  const result = decodePyacSentence("mina nyahye hcaspuka pfinkiya");
  assert.equal(result.pyash, "ya su I be walked ob our houses.");
  assert.equal(result.structural, "su name mi na ob name nyah ye hcas pu ka be pfin ki ya");
  assert.equal(result.englishPyash, "ya su I be walked ob our houses.");
  assert.equal(result.english, "I walked our houses.");
  assert.deepEqual(
    result.tokens.map((token) => token.parts.map((part) => part.pya)),
    [["mi", "na"], ["nyah", "ye"], ["hcas", "pu", "ka"], ["pfin", "ki", "ya"]]
  );
});

test("Pyac decoder restores phrase-final location cases", () => {
  const result = decodePyacSentence("mina hcasputwih pfinkiya");
  assert.equal(result.pyash, "ya su I be walked ob into houses.");
  assert.equal(result.structural, "su name mi na ob name hcas pu twih be pfin ki ya");
  assert.equal(result.english, "I walked into houses.");
});

test("Pyac decoder derives English roles and prepositions from VLIW grammar", () => {
  const prayerOpening = decodePyacSentence("nyahye hpapwu cyakte saye hnimna swutpyohjwih");
  assert.equal(
    prayerOpening.englishPyash,
    "may O our dad in heaven, su your name be holy."
  );
  assert.equal(prayerOpening.english, "Our dad in heaven, may your name be holy.");

  const negativeImperative = decodePyacSentence("nyahyi no hyocma tlakpcih");
  assert.equal(
    negativeImperative.englishPyash,
    "do su you be not bring ob to us to temptation."
  );
  assert.equal(negativeImperative.english, "Do not bring to us to temptation.");
});

test("relative-clause marker renders its English surface instead of its structural label", () => {
  const lowered = lowerSentencePhraseVliw({
    mood: "ya",
    su: { name: "pyan na" },
    be: "pcim ra",
    ob: { name: "la sren ra kcin ka" }
  });
  const result = renderEnglishFromVliw(lowered.vectors);
  assert.match(result.englishPyash, /that exhibits/u);
  assert.doesNotMatch(result.englishPyash, /dependent clause/u);
});

test("benefactive renders for across a mixed noun and pronoun phrase", () => {
  const lowered = lowerSentencePhraseVliw({
    mood: "ya",
    su: { name: "pyan na" },
    be: "pcim ra",
    ob: { name: "la sren ra tlih kcin twin cyah tlih ba ya tlih pwah" }
  });
  const result = renderEnglishFromVliw(lowered.vectors);
  assert.match(result.englishPyash, /for a deep desire someone/u);
  assert.match(result.englishPyash, /or it/u);
});

test("Pyac document translation keeps one record per input line", () => {
  const result = translatePyacToEnglishPyash("mina hcaspuka pfinkiya\nmina hpupka kwinpcih");
  assert.equal(result.records.length, 2);
  assert.match(result.englishPyash, /ya su I be walked ob houses\./u);
  assert.match(result.englishPyash, /do su I be give ob bread\./u);
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
  assert.equal(result.englishPyash, "do su you be rescue ob to us from evil.");
  assert.equal(result.english, "But rescue to us from evil.");
});
