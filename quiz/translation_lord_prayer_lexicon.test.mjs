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
import { buildLordPrayerTranslation } from "../program/verbs/exchange/translation/lord_prayer_translation.mjs";
import { decodePhraseVliw, renderVliwPyac } from "../program/library/vliw/phrase.mjs";

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
  assert.equal(lexicon.entries.find((entry) => entry.term === "daily")?.selectedCandidateId, "adjective-hodiernal-bread");
  assert.deepEqual(
    lexicon.entries.find((entry) => entry.term === "daily")?.semanticCandidates[0].pyashSequence,
    ["dlatci", "hpupka"]
  );
  assert.deepEqual(
    lexicon.entries.find((entry) => entry.term === "bread")?.semanticCandidates[0].pyashSequence,
    ["hpup"]
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
    ["evil", "evil"],
    ["will", "purpose"],
    ["earth", "floor"],
    ["power", "strength"],
    ["forever", "age"],
    ["debts", "debit-plural"],
    ["debtors", "debit-agent-plural"],
    ["deliver", "rescuing"],
    ["amen", "firmly"]
  ]) {
    assert.equal(lexicon.entries.find((entry) => entry.term === term)?.selectedCandidateId, candidateId);
  }
  assert.deepEqual(
    lexicon.entries.find((entry) => entry.term === "debtors")?.semanticCandidates[0].pyashSequence,
    ["hdef", "hgen", "pu"]
  );
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
  assert.equal(index.resolve("deliver").semanticCandidates[0].id, "rescuing");

  const source = renderLordPrayerLexiconPya(lexicon);
  const reparsed = parseLordPrayerLexicon(source);
  assert.deepEqual(reparsed.entries, lexicon.entries);
  const program = buildProgram(source);
  assert.ok(program.sentences.some((sentence) => sentence?.su?.text === "term:daily"));
});

test("Lord's Prayer translation fuses grammar endings and emits clause moods", async () => {
  const translation = buildLordPrayerTranslation({ lexicon: await loadLordPrayerLexicon() });
  assert.equal(translation.clauses[0].canonical, "Our Father in heaven, may your name be kept holy.");
  assert.equal(translation.clauses[0].pyac, "nyahye hpapwu cyakte saye hnimna swutpyohjwih");
  assert.equal(translation.clauses[0].pyash, "nyah ye hpap wu cyak te sa ye hnim na swut pyoh jwih");
  assert.equal(translation.clauses[0].pyashSurface, translation.clauses[0].pyac);
  assert.equal(translation.clauses[2].pyac, "saye hmucna cyakte tlapta tcunjwih");
  assert.equal(translation.clauses[3].pyac, "nyahyi trenmyah nyahye dlatci hpupka kwinpcih");
  assert.equal(
    translation.clauses[3].englishPyash,
    "su you be give ob us today our daily bread do"
  );
  assert.equal(translation.clauses[5].pyac, "nyahna pcah nyahye hdef hgenpuka hsonrali");
  assert.equal(translation.clauses[8].pyac, "hyap syunna wa htafna wa nyamna hnispumyah sayeli");
  assert.equal(translation.clauses[9].pyac, "hretli");
});

test("Lord's Prayer renders every text form from decoded VLIW", async () => {
  const translation = buildLordPrayerTranslation({ lexicon: await loadLordPrayerLexicon() });
  for (const clause of translation.clauses) {
    const decoded = decodePhraseVliw(clause.vliw.vectors);
    assert.equal(renderVliwPyac(decoded), clause.pyac, clause.locator);
    assert.equal(clause.vliw.format, "pyac-vliw-phrase-v1");
    assert.ok(clause.englishPyash.length > 0, clause.locator);
    assert.ok(clause.english.length > 0, clause.locator);
  }
  assert.equal(translation.clauses[8].englishPyash, "su yours be is ob king government and strength and glory during ages ya");
  assert.equal(translation.clauses[8].english, "Yours is king government and strength and glory during ages.");
  assert.equal(translation.clauses[9].englishPyash, "firmly ya");
  assert.equal(translation.clauses[9].english, "Firmly.");
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
