import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCowWordNetSenseCrosswalk,
  buildCowWordNetCrosswalkIndex,
  lookupCowChineseFormsByWordNetSenses,
  parseCowChineseWordNet,
  parseCowWordNetCrosswalkPya,
  renderCowWordNetCrosswalkPya
} from "../program/library/translation/cow_wordnet_crosswalk.mjs";

const cowXml = `<?xml version="1.0"?>
<LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
  <LexicalEntry id="word-1"><Lemma writtenForm="甲" partOfSpeech="n"/><Sense synset="cow-00000001-n"/></LexicalEntry>
  <LexicalEntry id="word-2"><Lemma writtenForm="乙" partOfSpeech="n"/><Sense synset="cow-00000001-n"/></LexicalEntry>
  <LexicalEntry id="word-3"><Lemma writtenForm="甲乙" partOfSpeech="n"/><Sense synset="cow-00000001-n"/></LexicalEntry>
  <LexicalEntry id="word-4"><Lemma writtenForm="丙丁" partOfSpeech="v"/><Sense synset="cow-00000002-v"/></LexicalEntry>
  <LexicalEntry id="word-5"><Lemma writtenForm="戊" partOfSpeech="n"/><Sense synset="cow-00000003-n"/></LexicalEntry>
  <Synset id="cow-00000001-n" ili="i100" partOfSpeech="n"/>
  <Synset id="cow-00000002-v" ili="i200" partOfSpeech="v"/>
  <Synset id="cow-00000003-n" partOfSpeech="n"/>
</Lexicon></LexicalResource>`;

test("COW parser keeps all Han lexical forms and sense provenance, including missing ILI rows", () => {
  const cow = parseCowChineseWordNet(cowXml);

  assert.equal(cow.synsets.length, 3);
  assert.equal(cow.senses.length, 5);
  assert.deepEqual(cow.senses.find((row) => row.form === "甲乙"), {
    form: "甲乙",
    hanCharacterCount: 2,
    cowSynsetId: "cow-00000001-n",
    ili: "i100",
    partOfSpeech: "n"
  });
  assert.equal(cow.senses.find((row) => row.form === "戊").ili, "");
});

test("crosswalk matches every local WordNet sense by ILI without requiring a Pyash target", () => {
  const cow = parseCowChineseWordNet(cowXml);
  const result = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [
      { pos: "n", synset: "00000001-n", ili: "i100", lemma: "concept", gloss: "an idea" },
      { pos: "v", synset: "00000001-v", ili: "i100", lemma: "conceptualize", gloss: "form a concept" },
      { pos: "v", synset: "00000002-v", ili: "i200", lemma: "act", gloss: "perform an action" }
    ],
    english30kRows: [
      { word: "concept", rank: 10 },
      { word: "conceptualize", rank: 40 },
      { word: "act", rank: 2 }
    ],
    wordnetFrequencyEntries: [
      { pos: "n", synset: "00000001-n", lemma: "concept", tagCount: 7 },
      { pos: "v", synset: "00000001-v", lemma: "conceptualize", tagCount: 3 }
    ],
    subtlex: new Map([
      ["甲", { rank: 12 }],
      ["乙", { rank: 4 }]
    ])
  });

  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.map((row) => row.wordNetSenseId), [
    "n:00000001-n",
    "v:00000001-v",
    "v:00000002-v"
  ]);
  assert.equal(result.records[0].frequencyRank, 10);
  assert.equal(result.records[0].frequencyTagCount, 7);
  assert.equal(result.records[0].chineseForms.find((row) => row.form === "乙").preferred, true);
  assert.equal(result.records[0].chineseForms.find((row) => row.form === "甲").preferred, false);
  assert.equal(result.records[0].chineseForms.find((row) => row.form === "甲").frequencyStatus, "frequency-top");
  assert.equal(result.records[1].chineseForms.find((row) => row.form === "甲").frequencyStatus, "lower-frequency");
  assert.ok(result.records[0].chineseForms.filter((row) => row.preferred)
    .every((row) => row.hanCharacterCount === 1));
  assert.equal(result.records[2].chineseForms[0].form, "丙丁");
  assert.equal(result.report.cowSynsetsMatched, 2);
  assert.equal(result.report.cowSynsetsWithoutIli, 1);
  assert.equal(result.report.cowIlisMissingFromWordNet, 0);
  assert.equal(result.report.chineseFormsMatched, 4);
});

test("English30k ranks lead form sense order and Princeton counts break only fully evidenced ties", () => {
  const cow = parseCowChineseWordNet(`<?xml version="1.0"?>
  <LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
    <LexicalEntry id="a"><Lemma writtenForm="甲"/><Sense synset="cow-1-n"/></LexicalEntry>
    <Synset id="cow-1-n" ili="i1" partOfSpeech="n"/>
  </Lexicon></LexicalResource>`);
  const tied = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [
      { pos: "n", synset: "00000001-n", ili: "i1", lemma: "first", gloss: "first" },
      { pos: "v", synset: "00000001-v", ili: "i1", lemma: "second", gloss: "second" }
    ],
    english30kRows: [{ word: "first", rank: 10 }, { word: "second", rank: 10 }],
    wordnetFrequencyEntries: [{ pos: "n", synset: "00000001-n", lemma: "first", tagCount: 7 }]
  });
  assert.ok(tied.records.every((record) => record.chineseForms[0].frequencyStatus === "unresolved-frequency-tie"));
  assert.equal(tied.report.chineseFormsWithTopSenseFrequencyTies, 1);

  const resolved = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [
      { pos: "n", synset: "00000001-n", ili: "i1", lemma: "first", gloss: "first" },
      { pos: "v", synset: "00000001-v", ili: "i1", lemma: "second", gloss: "second" }
    ],
    english30kRows: [{ word: "first", rank: 10 }, { word: "second", rank: 10 }],
    wordnetFrequencyEntries: [
      { pos: "n", synset: "00000001-n", lemma: "first", tagCount: 7 },
      { pos: "v", synset: "00000001-v", lemma: "second", tagCount: 3 }
    ]
  });
  assert.equal(resolved.records.find((record) => record.wordNetSenseId === "n:00000001-n")
    .chineseForms[0].frequencyStatus, "frequency-top");
  assert.equal(resolved.records.find((record) => record.wordNetSenseId === "v:00000001-v")
    .chineseForms[0].frequencyStatus, "lower-frequency");
});

test("tied English lemmas do not get an alphabetical winner or partial Princeton count", () => {
  const cow = parseCowChineseWordNet(`<?xml version="1.0"?>
  <LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
    <LexicalEntry id="a"><Lemma writtenForm="甲"/><Sense synset="cow-1-n"/></LexicalEntry>
    <Synset id="cow-1-n" ili="i1" partOfSpeech="n"/>
  </Lexicon></LexicalResource>`);
  const [record] = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [
      { pos: "n", synset: "00000001-n", ili: "i1", lemma: "zeta", gloss: "same sense" },
      { pos: "n", synset: "00000001-n", ili: "i1", lemma: "alpha", gloss: "same sense" }
    ],
    english30kRows: [{ word: "zeta", rank: 4 }, { word: "alpha", rank: 4 }],
    wordnetFrequencyEntries: [{ pos: "n", synset: "00000001-n", lemma: "zeta", tagCount: 9 }]
  }).records;
  assert.equal(record.frequencyLemma, undefined);
  assert.deepEqual(record.frequencyLemmaCandidates, ["alpha", "zeta"]);
  assert.equal(record.frequencyTagCount, null);
});

test("crosswalk prefers shorter Han forms and preserves tied multi-character spellings", () => {
  const cow = parseCowChineseWordNet(`<?xml version="1.0"?>
  <LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
    <LexicalEntry id="a"><Lemma writtenForm="甲乙"/><Sense synset="cow-1-n"/></LexicalEntry>
    <LexicalEntry id="b"><Lemma writtenForm="丙丁"/><Sense synset="cow-1-n"/></LexicalEntry>
    <LexicalEntry id="c"><Lemma writtenForm="戊"/><Sense synset="cow-1-n"/></LexicalEntry>
    <Synset id="cow-1-n" ili="i1" partOfSpeech="n"/>
  </Lexicon></LexicalResource>`);
  const [record] = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [{ pos: "n", synset: "00000001-n", ili: "i1", lemma: "thing", gloss: "a thing" }]
  }).records;

  assert.deepEqual(record.chineseForms.map((row) => [row.form, row.preferred]), [
    ["戊", true],
    ["丙丁", false],
    ["甲乙", false]
  ]);
});

test("equal-length single-character forms use SUBTLEX, then Jun Da, and preserve unresolved ties", () => {
  const cow = parseCowChineseWordNet(`<?xml version="1.0"?>
  <LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
    <LexicalEntry id="a"><Lemma writtenForm="甲"/><Sense synset="cow-1-n"/></LexicalEntry>
    <LexicalEntry id="b"><Lemma writtenForm="乙"/><Sense synset="cow-1-n"/></LexicalEntry>
    <Synset id="cow-1-n" ili="i1" partOfSpeech="n"/>
  </Lexicon></LexicalResource>`);
  const wordnetRows = [{ pos: "n", synset: "00000001-n", ili: "i1", lemma: "thing", gloss: "thing" }];

  const junda = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows,
    junda: new Map([["甲", { rank: 8 }], ["乙", { rank: 2 }]])
  });
  assert.deepEqual(junda.records[0].chineseForms.filter((row) => row.preferred).map((row) => row.form), ["乙"]);

  const tied = buildCowWordNetSenseCrosswalk({ cow, wordnetRows });
  assert.deepEqual(tied.records[0].chineseForms.filter((row) => row.preferred).map((row) => row.form).sort(), ["乙", "甲"].sort());

  const subtlexTie = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows,
    subtlex: new Map([["甲", { rank: 5 }], ["乙", { rank: 5 }]]),
    junda: new Map([["甲", { rank: 2 }], ["乙", { rank: 20 }]])
  });
  assert.deepEqual(subtlexTie.records[0].chineseForms.filter((row) => row.preferred).map((row) => row.form).sort(), ["乙", "甲"].sort());
});

test("crosswalk index and Pyash catalog round-trip preserve sense rows and form postings", () => {
  const cow = parseCowChineseWordNet(cowXml);
  const { records } = buildCowWordNetSenseCrosswalk({
    cow,
    wordnetRows: [{ pos: "n", synset: "00000001-n", ili: "i100", lemma: "concept", gloss: "an idea" }],
    english30kRows: [{ word: "concept", rank: 10 }]
  });
  const source = renderCowWordNetCrosswalkPya(records, { sourceHash: "source-hash" });
  const parsed = parseCowWordNetCrosswalkPya(source);
  const index = buildCowWordNetCrosswalkIndex(parsed.records);

  assert.equal(parsed.sourceHash, "source-hash");
  assert.equal(index.byWordNetSense.get("n:00000001-n").wordNetSenseId, "n:00000001-n");
  assert.equal(index.byChineseForm.get("乙")[0].wordNetSenseId, "n:00000001-n");
  assert.equal(index.preferredByChineseForm.get("乙")[0].matchedForm.preferred, true);
  assert.equal(index.preferredSenseByChineseForm.get("乙")[0].wordNetSenseId, "n:00000001-n");
  assert.equal(index.byChineseForm.has("甲乙"), true);
});

test("COW Chinese lookup keeps preferred short forms and reports sense ties without selecting a loser", () => {
  const form = (value, hanCharacterCount, frequencyStatus, preferred = true) => ({
    form: value,
    hanCharacterCount,
    preferred,
    frequencyStatus,
    cowSynsetIds: [`cow-${value}`]
  });
  const index = buildCowWordNetCrosswalkIndex([
    {
      wordNetSenseId: "n:00000001-n", synset: "00000001-n", partOfSpeech: "n", ili: "i1",
      frequencyRank: 5, frequencyTagCount: 4,
      chineseForms: [form("甲", 1, "frequency-top"), form("甲乙", 2, "frequency-top", false)]
    },
    {
      wordNetSenseId: "n:00000002-n", synset: "00000002-n", partOfSpeech: "n", ili: "i2",
      frequencyRank: 9, frequencyTagCount: 1,
      chineseForms: [form("甲", 1, "lower-frequency")]
    },
    {
      wordNetSenseId: "n:00000003-n", synset: "00000003-n", partOfSpeech: "n", ili: "i3",
      frequencyRank: 12, frequencyTagCount: null,
      chineseForms: [form("乙", 1, "unresolved-frequency-tie")]
    },
    {
      wordNetSenseId: "n:00000004-n", synset: "00000004-n", partOfSpeech: "n", ili: "i4",
      frequencyRank: 12, frequencyTagCount: null,
      chineseForms: [form("乙", 1, "unresolved-frequency-tie")]
    },
    {
      wordNetSenseId: "n:00000005-n", synset: "00000005-n", partOfSpeech: "n", ili: "i5",
      frequencyRank: null, frequencyTagCount: null,
      chineseForms: [form("丙", 1, "no-english30k-frequency")]
    }
  ]);

  const results = lookupCowChineseFormsByWordNetSenses(index, [
    "n:00000001-n", "n:00000002-n", "n:00000003-n", "n:00000005-n"
  ]);
  assert.deepEqual(results.map(({ chinese, frequencyStatus, wordNetSenseIds }) => ({
    chinese, frequencyStatus, wordNetSenseIds
  })), [
    { chinese: "甲", frequencyStatus: "frequency-top", wordNetSenseIds: ["n:00000001-n"] },
    { chinese: "乙", frequencyStatus: "unresolved-frequency-tie", wordNetSenseIds: ["n:00000003-n", "n:00000004-n"] },
    { chinese: "丙", frequencyStatus: "no-english30k-frequency", wordNetSenseIds: ["n:00000005-n"] }
  ]);
});
