import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePyacWord,
  encodePyacWord
} from "../program/library/vliw/word_code.mjs";
import {
  decodePhraseVliw,
  lowerPhraseVliw,
  PHRASE_CASE_WORDS,
  renderVliwPyac
} from "../program/library/vliw/phrase.mjs";

test("lwonprom word encoding produces the canonical Pyac word numbers", () => {
  const known = new Map([
    ["hpap", 0x4920],
    ["na", 0x24de],
    ["pfin", 0x6884],
    ["pyoh", 0x6027],
    ["jwih", 0x41af],
    ["kcu7h", 0x9517],
    ["kcuh", 0x5517]
  ]);
  for (const [pya, hnuc] of known) {
    assert.equal(encodePyacWord(pya), hnuc, pya);
    assert.equal(decodePyacWord(hnuc), pya, pya);
  }
});

test("lwonprom final-consonant aliases share their encoded slot", () => {
  assert.equal(encodePyacWord("hmas"), encodePyacWord("hmaz"));
  assert.equal(decodePyacWord(encodePyacWord("hmaz")), "hmas");
});

test("phrase VLIW roundtrip preserves Pyac words and phrase markers", () => {
  const lowered = lowerPhraseVliw({
    tokens: "hpapwu cyakte saye hnimna swutpyohjwih"
  });
  const decoded = decodePhraseVliw(lowered.vectors);
  assert.equal(renderVliwPyac(decoded), "hpapwu cyakte saye hnimna swutpyohjwih");
  assert.deepEqual(decoded.phraseEnds, [1, 3, 7]);
  assert.equal(decoded.moodIndex, 10);
  assert.equal(decoded.vectors.length, 1);
  assert.equal(decoded.vectors[0][0] & 1, 1);
});

test("phrase VLIW uses continuation vectors without losing word order", () => {
  const tokens = Array.from({ length: 20 }, () => "na");
  const lowered = lowerPhraseVliw({ tokens });
  const decoded = decodePhraseVliw(lowered.vectors);
  assert.equal(decoded.tokens.length, 20);
  assert.equal(decoded.vectors.length, 2);
  assert.equal(decoded.vectors[0][0] & 1, 0);
  assert.equal(decoded.vectors[1][0] & 1, 1);
  assert.deepEqual(decoded.tokens.map((token) => token.pya), tokens);
});

test("phrase VLIW derives case boundaries from the vocabulary inventory", () => {
  for (const pya of ["wu", "yu", "mwah", "je", "gveh", "lwoh"]) {
    assert.equal(PHRASE_CASE_WORDS.has(pya), true, pya);
  }
  const decoded = decodePhraseVliw(lowerPhraseVliw({
    tokens: "hcaswu hcasyu pfin ya"
  }).vectors);
  assert.deepEqual(decoded.phraseEnds, [1, 3]);
});
