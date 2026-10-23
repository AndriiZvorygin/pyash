import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalCompoundPayload,
  loadCompoundLexicon,
  parseCompoundLexicon,
  queryCompoundLexicon
} from "../program/verbs/exchange/translation/compound_lexicon.mjs";
import {
  loadMultilingualCompoundLexicon,
  MULTILINGUAL_COMPOUND_LEXICON_SOURCES
} from "../program/verbs/exchange/translation/compound_lexicons.mjs";
import { choosePyacCompoundCandidate } from "../program/verbs/exchange/translation/pyac_complexity.mjs";

const languages = ["french", "russian", "hindi", "interlingua"];

test("multilingual compound catalogs lower the shared compound set through one parser", async () => {
  const expected = {
    database: { sequence: ["hnuc", "cren"], layers: [16, 19], maxLayer: 19 },
    lighthouse: { sequence: ["kwan", "hcas"], layers: [16, 16], maxLayer: 16 },
    dollhouse: { sequence: ["bwak", "hcas"], layers: [24, 16], maxLayer: 24 },
    waterfall: { sequence: ["hwic", "hfut"], layers: [16, 16], maxLayer: 16 },
    waterline: { sequence: ["hwic", "hlas"], layers: [16, 16], maxLayer: 16 }
  };

  for (const language of languages) {
    const entries = await loadMultilingualCompoundLexicon(language);
    assert.equal(entries.length, 6);
    assert.equal(entries.every((entry) => entry.language === language), true);
    for (const [target, shape] of Object.entries(expected)) {
      const entry = entries.find((candidate) => candidate.target === target);
      assert.ok(entry, `${language} has ${target}`);
      assert.deepEqual(entry.pyashSequence, shape.sequence);
      assert.deepEqual(entry.componentLayers, shape.layers);
      assert.equal(entry.maxLayer, shape.maxLayer);
      assert.equal(entry.status, "lowered-compound");
      assert.match(entry.provenance, new RegExp(`dictionary_${language === "interlingua" ? "ia" : language.slice(0, 2)}\\.json$`, "u"));
      assert.equal(entry.rejectedCandidates[0].maxLayer > entry.maxLayer, true);
    }
    const unresolved = entries.find((entry) => entry.target === "fatherland");
    assert.ok(unresolved);
    assert.equal(unresolved.status, "unlowered");
    assert.equal(unresolved.pyashSequence, undefined);
    assert.match(unresolved.evidence, /preserve the canonical atomic target htu7k/u);
  }

  const candidates = [
    { pyashSequence: ["hdes"], componentLayers: [24] },
    { pyashSequence: ["hnuc", "cren"], componentLayers: [16, 19] }
  ];
  assert.deepEqual(
    choosePyacCompoundCandidate(candidates, {
      byWord: new Map([["hdes", 24], ["hnuc", 16], ["cren", 19]])
    }).pyashSequence,
    ["hnuc", "cren"]
  );
});

test("generic compound loading preserves source language and stable payloads", async () => {
  const source = [
    "su name translation_compounds_french be map def",
    "su text \"base de données\" ob text \"{\\\"surface\\\":\\\"base de données\\\",\\\"morphemes\\\":[\\\"base\\\",\\\"données\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"fixture\\\",\\\"confidence\\\":\\\"curated\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "prah"
  ].join("\n");
  const parsed = parseCompoundLexicon(source, {
    name: "translation_compounds_french",
    language: "french"
  });
  assert.equal(parsed[0].language, "french");
  assert.deepEqual(queryCompoundLexicon(parsed, { target: "database" }).map((entry) => entry.surface), ["base de données"]);
  const loaded = await loadCompoundLexicon({
    url: new URL("../program/verbs/exchange/translation/compound_lexicon_french.pya", import.meta.url),
    name: "translation_compounds_french",
    language: "french"
  });
  assert.equal(canonicalCompoundPayload(loaded[0]), canonicalCompoundPayload(loaded.find((entry) => entry.target === "database")));
  assert.deepEqual(Object.keys(MULTILINGUAL_COMPOUND_LEXICON_SOURCES).sort(), languages.slice().sort());
});
