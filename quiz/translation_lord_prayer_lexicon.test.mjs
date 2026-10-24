import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { buildProgram } from "../program/program.mjs";
import {
  buildLordPrayerLexiconIndex,
  loadLordPrayerLexicon,
  parseLordPrayerLexicon,
  renderLordPrayerLexiconPya
} from "../program/verbs/exchange/translation/lord_prayer_lexicon.mjs";
import {
  buildLordPrayerAnalysis,
  renderLordPrayerAnalysisPya
} from "../program/verbs/exchange/translation/hkestlat_compound_analysis.mjs";

function fixtureSources() {
  return {
    dictionaryRows: [
      { en: "heaven", zh: "天堂", pya: "cyak" },
      { en: "bread", zh: "面包", pya: "hpup" },
      { en: "temptation", zh: "诱惑", pya: "hyoc" }
    ],
    stemRows: [["cyak", "天堂", 2, "paradise", ""]]
  };
}

test("Lord's Prayer Greek pilot preserves source policy and lexical gaps", async () => {
  const lexicon = await loadLordPrayerLexicon();
  assert.equal(lexicon.format, "lord-prayer-lexicon-v1");
  assert.equal(lexicon.metadata["canonical-edition"], "Nestle-Aland 28 (NA28)");
  assert.equal(lexicon.metadata["critical-edition"], "SBL Greek New Testament (SBLGNT)");
  assert.equal(lexicon.metadata["syriac-source"], "Matthew 6:10 form ܡܰܠܟܽܘܬܳܟ, malkūthākh");
  assert.equal(lexicon.entries.length, 26);
  assert.deepEqual(lexicon.entries.find((entry) => entry.term === "daily")?.greekForms, ["ἐπιούσιον"]);
  assert.equal(lexicon.entries.find((entry) => entry.term === "daily")?.selectedCandidateId, "grammar-hodiernal-bread");
  assert.deepEqual(
    lexicon.entries.find((entry) => entry.term === "daily")?.semanticCandidates[0].pyashSequence,
    ["dleh", "hpup"]
  );
  const kingdom = lexicon.entries.find((entry) => entry.term === "kingdom");
  assert.equal(kingdom?.selectedCandidateId, "king-government");
  assert.equal(kingdom?.semanticCandidates[2].status, "accepted-existing");
  assert.deepEqual(kingdom?.aramaicForms, ["ܡܰܠܟܽܘܬܳܟ"]);
  assert.deepEqual(kingdom?.aramaicTransliterations, ["malkūthākh"]);
  assert.deepEqual(kingdom?.semanticCandidates[1].pyashSequence, ["hyap", "tyun"]);
  assert.deepEqual(kingdom?.semanticCandidates[3].pyashSequence, ["dwa2n", "syun"]);
  for (const [term, candidateId] of [
    ["holy", "holy-root"],
    ["give", "giving"],
    ["forgive", "pardon"],
    ["bring", "existing-bring"],
    ["evil", "evil"]
  ]) {
    assert.equal(lexicon.entries.find((entry) => entry.term === term)?.selectedCandidateId, candidateId);
  }
  assert.deepEqual(
    lexicon.entries.find((entry) => entry.term === "our")?.semanticCandidates[0].pyashSequence,
    ["nyah", "ye"]
  );
});

test("Greek pilot index and renderer retain stable candidate identities", async () => {
  const lexicon = await loadLordPrayerLexicon();
  const index = buildLordPrayerLexiconIndex(lexicon);
  assert.equal(index.resolve("KINGDOM").greekLemma, "βασιλεία");
  assert.deepEqual(index.resolve("kingdom").aramaicTransliterations, ["malkūthākh"]);
  assert.equal(index.resolve("deliver").semanticCandidates[0].id, "rhyomai-review");

  const source = renderLordPrayerLexiconPya(lexicon);
  const reparsed = parseLordPrayerLexicon(source);
  assert.deepEqual(reparsed.entries, lexicon.entries);
  const program = buildProgram(source);
  assert.ok(program.sentences.some((sentence) => sentence?.su?.text === "term:daily"));
});

test("Lord's Prayer analysis links dictionary evidence to Greek pilot records", async () => {
  const lexicon = await loadLordPrayerLexicon();
  const analysis = buildLordPrayerAnalysis({
    ...fixtureSources(),
    lexicon
  });
  const heaven = analysis.terms.find((term) => term.term === "heaven");
  const kingdom = analysis.terms.find((term) => term.term === "kingdom");
  assert.equal(heaven.lexicon.greekLemma, "οὐρανός");
  assert.equal(heaven.lexicon.selectedCandidateId, "existing-heaven");
  assert.equal(kingdom.lexicon.semanticCandidates[0].status, "review");
  assert.equal(kingdom.lexicon.aramaicTransliterations[0], "malkūthākh");
  const rendered = renderLordPrayerAnalysisPya(analysis);
  const roundTrip = buildProgram(rendered);
  const roundTripKingdom = roundTrip.sentences.find((sentence) => sentence?.su?.text === "term:kingdom");
  assert.equal(JSON.parse(roundTripKingdom.ob.text).lexicon.greekLemma, "βασιλεία");
});

test("Greek pilot parser rejects malformed candidate payloads", async () => {
  const source = await fs.readFile(
    new URL("../program/verbs/exchange/translation/lord_prayer_lexicon.pya", import.meta.url),
    "utf8"
  );
  const malformed = source.replace('\\"status\\":\\"unresolved\\"', '\\"status\\":\\"invented\\"');
  assert.throws(
    () => parseLordPrayerLexicon(malformed),
    (error) => error.code === "invalid-lord-prayer-lexicon"
  );
});
