import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL } from "../program/library/translation/chinese_character_atom_refinery.mjs";
import {
  buildChineseCharacterAtomWorklist,
  parseChineseOpenWordNetCharacterSenses,
  buildChineseCharacterAtomProposals,
  buildChineseCharacterAtomReviewPrompt,
  parseChineseCharacterAtomReviewResponse,
  parseChineseCharacterPhoneticResponse,
  parseChineseCharacterTranslationResponse,
  hasCowDirectAtomCandidate,
  highFrequencyCowCharacterAtomLinks,
  highConfidenceChineseCharacterAtomLinks,
  parseChineseCharacterAtomLinks,
  reconcileChineseCharacterAtomLinkConflicts,
  acceptedChineseCharacterAtomRows,
  renderChineseCharacterAtomLinksPya,
  parseEnglishGrammarTargets,
  parseUnihanCharacterData
} from "../program/library/translation/chinese_character_atom_refinery.mjs";
import {
  buildChineseCharacterAtomMatchTasks,
  attachWordNetSenseTargets,
  chineseCharacterRecordsForModelReview,
  applyChineseCharacterAtomLinkChanges,
  nextChineseCharacterDutyWave
} from "../command/chinese_character_atom_refinery.mjs";

function wordnetSenseTarget(pya, english, senseId = `n:${pya}-sense`, ili = `i-${pya}`, gloss = english) {
  return {
    senseId, ili, targetKind: "atom", targetId: `atom:${pya}`, target: english,
    targetPartOfSpeech: "n", pyashSequence: [pya], english, pya, gloss, lemmas: [english]
  };
}

function candidateSense(pya, senseId = `n:${pya}-sense`, ili = `i-${pya}`, gloss = pya) {
  return { senseId, ili, partOfSpeech: "n", gloss, lemmas: [pya], cowLinked: false };
}

test("active atom bridges are joined to their WordNet ILI and sense definitions", () => {
  const attached = attachWordNetSenseTargets({
    atomEntries: [{ en: "driving", pya: "hdok" }],
    sourceHashes: { atoms: "atom-source" },
    sourceHash: "input-source"
  }, {
    wordnet: {
      sourceHash: "wordnet-source",
      rows: [{ pos: "v", synset: "01934845-v", ili: "i-driving" }],
      index: { bridgeIndex: new Map([
        ["v:01934845-v", {
          source: "v:01934845-v", targetKind: "atom", target: "drive", targetPartOfSpeech: "n",
          pyashSequence: ["hdok"], gloss: "operate and control a vehicle", lemmas: ["drive", "driving"]
        }],
        ["n:00000001-n", {
          source: "n:00000001-n", targetKind: "compound", target: "vehicle driver", targetPartOfSpeech: "n",
          pyashSequence: ["hdok", "hfoo"], gloss: "a person who drives", lemmas: ["driver"]
        }],
        ["v:00000002-v", {
          source: "v:00000002-v", targetKind: "atom", target: "missing", targetPartOfSpeech: "v",
          pyashSequence: ["unknown"], gloss: "unavailable atom", lemmas: ["missing"]
        }]
      ]) }
    },
    resourceHashes: { englishWordNetBridges: "bridge-source" }
  });

  assert.deepEqual(attached.wordnetSenseTargets.map(({ senseId, ili, pya, partOfSpeech, targetPartOfSpeech, gloss, lemmas }) => ({
    senseId, ili, pya, partOfSpeech, targetPartOfSpeech, gloss, lemmas
  })), [{
    senseId: "v:01934845-v",
    ili: "i-driving",
    pya: "hdok",
    partOfSpeech: "v",
    targetPartOfSpeech: "n",
    gloss: "operate and control a vehicle",
    lemmas: ["drive", "driving"]
  }]);
  assert.notEqual(attached.sourceHash, "input-source");
});

test("active atom bridge senses receive English30k rank and exact WordNet tag-count evidence", () => {
  const attached = attachWordNetSenseTargets({
    atomEntries: [{ en: "driving", pya: "hdok" }],
    sourceHashes: { atoms: "atom-source" },
    sourceHash: "input-source"
  }, {
    source: {
      sourceHash: "english30k-source",
      rows: [{ word: "drive", rank: 40 }, { word: "driving", rank: 10 }]
    },
    wordnet: {
      sourceHash: "wordnet-source",
      rows: [{ pos: "v", synset: "01934845-v", ili: "i-driving" }],
      index: { bridgeIndex: new Map([
        ["v:01934845-v", {
          source: "v:01934845-v", targetKind: "atom", target: "driving", targetPartOfSpeech: "v",
          pyashSequence: ["hdok"], gloss: "operate and control a vehicle", lemmas: ["drive", "driving"]
        }]
      ]) }
    },
    resourceHashes: { english30k: "english30k-source", englishWordNetBridges: "bridge-source" }
  }, {
    sourceHash: "princeton-frequency-source",
    joined: { entries: [
      { pos: "v", synset: "01934845-v", lemma: "drive", tagCount: 2 },
      { pos: "v", synset: "01934845-v", lemma: "driving", tagCount: 12 }
    ] }
  });

  assert.deepEqual(attached.wordnetSenseTargets.map(({ frequencyRank, frequencyTagCount, frequencyLemma }) => ({
    frequencyRank, frequencyTagCount, frequencyLemma
  })), [{ frequencyRank: 10, frequencyTagCount: 12, frequencyLemma: "driving" }]);
  assert.equal(attached.sourceHashes.princetonWordNetFrequency, "princeton-frequency-source");
});

test("COW frequency allocation selects the most frequent linked atom sense without model review", () => {
  const record = {
    character: "驱",
    frequency: { subtlexRank: 100 },
    existingMappings: [],
    existingAtomCandidates: [
      {
        kind: "atom", english: "drive", pya: "hgo", candidateSources: ["cow-direct"],
        wordnetSenses: [{ senseId: "v:01934845-v", cowLinked: true, frequencyRank: 30, frequencyTagCount: 8 }]
      },
      {
        kind: "atom", english: "driving", pya: "hdok", candidateSources: ["cow-direct"],
        wordnetSenses: [{ senseId: "n:00299323-n", cowLinked: true, frequencyRank: 10, frequencyTagCount: 4 }]
      }
    ]
  };
  const { changes, decisions } = highFrequencyCowCharacterAtomLinks([record]);

  assert.equal(hasCowDirectAtomCandidate(record), true);
  assert.deepEqual(chineseCharacterRecordsForModelReview([record]).map((row) => row.character), []);
  assert.deepEqual(changes.map(({ pya, status, frequencyRank }) => ({ pya, status, frequencyRank })), [
    { pya: "hdok", status: "accepted", frequencyRank: 10 }
  ]);
  assert.equal(decisions.get("驱").status, "promoted");
});

test("COW frequency allocation uses WordNet tag count for rank ties and leaves unresolved ties pending", () => {
  const record = {
    character: "同",
    frequency: { subtlexRank: 50 },
    existingMappings: [],
    existingAtomCandidates: [
      {
        kind: "atom", english: "equal-a", pya: "hpa", candidateSources: ["cow-direct"],
        wordnetSenses: [{ senseId: "n:sense-a", cowLinked: true, frequencyRank: 12, frequencyTagCount: 3 }]
      },
      {
        kind: "atom", english: "equal-b", pya: "hpb", candidateSources: ["cow-direct"],
        wordnetSenses: [{ senseId: "n:sense-b", cowLinked: true, frequencyRank: 12, frequencyTagCount: 9 }]
      }
    ]
  };
  const selected = highFrequencyCowCharacterAtomLinks([record]);
  assert.deepEqual(selected.changes.map(({ pya }) => pya), ["hpb"]);

  record.existingAtomCandidates[0].wordnetSenses[0].frequencyTagCount = 9;
  const tied = highFrequencyCowCharacterAtomLinks([record]);
  assert.deepEqual(tied.changes, []);
  assert.equal(tied.decisions.get("同").status, "unresolved-frequency-tie");

  record.existingAtomCandidates.forEach((candidate) => {
    candidate.wordnetSenses[0].frequencyTagCount = null;
  });
  const missingTagCounts = highFrequencyCowCharacterAtomLinks([record]);
  assert.deepEqual(missingTagCounts.changes, []);
  assert.equal(missingTagCounts.decisions.get("同").status, "unresolved-frequency-tie");
});

test("COW allocation gives a contested atom to the more frequent character and uses the next ranked target as fallback", () => {
  const candidate = (pya, rank, senseId) => ({
    kind: "atom", english: pya, pya, candidateSources: ["cow-direct"],
    wordnetSenses: [{ senseId, cowLinked: true, frequencyRank: rank, frequencyTagCount: 2 }]
  });
  const records = [
    {
      character: "後", frequency: { subtlexRank: 20 }, existingMappings: [],
      existingAtomCandidates: [candidate("hfirst", 1, "n:first"), candidate("hsecond", 4, "n:second")]
    },
    {
      character: "后", frequency: { subtlexRank: 5 }, existingMappings: [],
      existingAtomCandidates: [candidate("hfirst", 1, "n:first"), candidate("hthird", 7, "n:third")]
    }
  ];
  const { changes } = highFrequencyCowCharacterAtomLinks(records);

  assert.deepEqual(changes.map(({ character, pya }) => [character, pya]), [["后", "hfirst"], ["後", "hsecond"]]);
});

test("Jun Da does not break equal SUBTLEX ranks when characters compete for one atom", () => {
  const candidate = {
    kind: "atom", english: "shared", pya: "hshared", candidateSources: ["cow-direct"],
    wordnetSenses: [{ senseId: "n:shared", cowLinked: true, frequencyRank: 1, frequencyTagCount: 1 }]
  };
  const { changes } = highFrequencyCowCharacterAtomLinks([
    {
      character: "乙", standardIndex: 2, frequency: { subtlexRank: 10, jundaRank: 1 },
      existingMappings: [], existingAtomCandidates: [{ ...candidate }]
    },
    {
      character: "甲", standardIndex: 1, frequency: { subtlexRank: 10, jundaRank: 100 },
      existingMappings: [], existingAtomCandidates: [{ ...candidate }]
    }
  ]);

  assert.deepEqual(changes.map(({ character }) => character), ["甲"]);
});

test("COW frequency allocation replaces a curated link and leaves unranked COW candidates as residuals", () => {
  const current = { character: "驱", english: "drive", pya: "hgo", status: "accepted", source: "cow-frequency-allocation" };
  const record = {
    character: "驱",
    frequency: { subtlexRank: 100 },
    cowReviewRequired: true,
    existingMappings: [{ ...current, kind: "pyash-curated" }],
    existingAtomCandidates: [{
      kind: "atom", english: "driving", pya: "hdok", candidateSources: ["cow-direct"],
      wordnetSenses: [{ senseId: "v:01934845-v", cowLinked: true, frequencyRank: 10, frequencyTagCount: 8 }]
    }]
  };
  const result = highFrequencyCowCharacterAtomLinks([record], [current]);

  assert.deepEqual(result.changes.map(({ pya, status }) => [pya, status]), [["hgo", "withdrawn"], ["hdok", "accepted"]]);
  assert.equal(result.decisions.get("驱").status, "updated");

  record.existingAtomCandidates[0].wordnetSenses[0].frequencyRank = null;
  const unranked = highFrequencyCowCharacterAtomLinks([record], [current]);
  assert.deepEqual(unranked.changes, []);
  assert.equal(unranked.decisions.get("驱").status, "no-english30k-frequency");
  assert.deepEqual(chineseCharacterRecordsForModelReview([record]), []);
});

test("COW link replacement updates prior status without leaving a second accepted atom link", () => {
  const links = applyChineseCharacterAtomLinkChanges([
    { character: "驱", english: "drive", pya: "hgo", status: "accepted", source: "chinese-character-atom-refinery" },
    { character: "你", english: "you", pya: "hnan", status: "accepted" }
  ], [
    { character: "驱", english: "drive", pya: "hgo", status: "withdrawn" },
    { character: "驱", english: "driving", pya: "hdok", status: "accepted", wordNetSenseId: "v:01934845-v" }
  ]);

  assert.deepEqual(links, [
    { character: "驱", english: "drive", pya: "hgo", status: "withdrawn", key: "withdraw:驱:hgo", source: "chinese-character-atom-refinery" },
    { character: "你", english: "you", pya: "hnan", status: "accepted" },
    { character: "驱", english: "driving", pya: "hdok", status: "accepted" }
  ]);
});

test("Chinese character refinery keeps the complete graph and adds a separate existing-atom first pass", async () => {
  const source = await readFile(CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL, "utf8");
  const sentences = buildProgram(source).sentences;
  const graphs = new Map();
  let graphName = "";
  for (const sentence of sentences) {
    if (sentence?.be === "refinery") {
      graphName = sentence.su?.name;
      graphs.set(graphName, []);
    } else if (sentence?.be === "translation stage" && graphName) {
      graphs.get(graphName).push(sentence.su?.name);
    } else if (sentence?.mood === "prah") {
      graphName = "";
    }
  }

  assert.deepEqual(graphs.get("translation chinese character atoms"), [
    "build ranked character worklist",
    "prepare existing atom matches",
    "review ambiguous atom matches",
    "prepare missing meaning translations",
    "generate atom proposals",
    "record character link review"
  ]);
  assert.deepEqual(graphs.get("translation chinese character atom first pass"), [
    "build ranked character worklist",
    "prepare existing atom matches",
    "review ambiguous atom matches",
    "record character link review"
  ]);
  const config = sentences.find((sentence) => sentence?.mood === "ya" && sentence.su?.text === "refinery-pass");
  assert.equal(config.ob.text, "first-pass");
});

test("Chinese character refinery reads single-atom grammar targets and skips catalog metadata", () => {
  const source = [
    "su name translation_english_grammar be map def",
    'su text "format" ob text "english-grammar-v1" ya',
    'su text "source" ob text "fixture source" ya',
    'su text "you" ob text "{\\"surface\\":\\"you\\",\\"kind\\":\\"pronoun\\",\\"components\\":[\\"you_\\"],\\"pyashSequence\\":[\\"sa\\"],\\"position\\":\\"standalone\\",\\"evidence\\":\\"fixture evidence\\"}" ya',
    'su text "your" ob text "{\\"surface\\":\\"your\\",\\"kind\\":\\"possessive-determiner\\",\\"components\\":[\\"you_\\",\\"possessive_marker_\\"],\\"pyashSequence\\":[\\"sa\\",\\"ye\\"],\\"position\\":\\"prefix\\",\\"evidence\\":\\"fixture evidence\\"}" ya'
  ].join("\n");

  assert.deepEqual(parseEnglishGrammarTargets(source), [{
    id: "grammar:you_",
    kind: "grammar",
    english: "you",
    pya: "sa",
    components: ["you_"],
    evidence: "fixture evidence"
  }]);
});

test("COW character senses retain ILI crosswalks and omit multi-character and non-WordNet entries", () => {
  const xml = `<?xml version="1.0"?>
    <LexicalResource><Lexicon id="cow" language="cmn-Hans" version="1.1">
      <LexicalEntry id="cow-w1"><Lemma writtenForm="驱" partOfSpeech="v"/><Sense synset="cow-00007012-v"/></LexicalEntry>
      <LexicalEntry id="cow-w2"><Lemma writtenForm="你们" partOfSpeech="n"/><Sense synset="cow-00001740-n"/></LexicalEntry>
      <LexicalEntry id="cow-w3"><Lemma writtenForm="之" partOfSpeech="n"/><Sense synset="cow-80000047-n"/></LexicalEntry>
      <Synset id="cow-00007012-v" ili="i501" partOfSpeech="v"/>
      <Synset id="cow-00001740-n" ili="i502" partOfSpeech="n"/>
      <Synset id="cow-80000047-n" partOfSpeech="n"/>
    </Lexicon></LexicalResource>`;

  assert.deepEqual(parseChineseOpenWordNetCharacterSenses(xml), [{
    character: "驱",
    ili: "i501",
    partOfSpeech: "v",
    cowSynsets: ["cow-00007012-v"]
  }]);
});

test("Chinese character refinery reads the TGH standard index from Unihan other mappings", () => {
  const characters = parseUnihanCharacterData(
    "U+4E00\tkMandarin\tyī\nU+4E00\tkDefinition\tone; 1",
    "U+4E00\tkTGH\t2013:1\nU+4E8C\tkTGH\t2013:2"
  );

  assert.equal(characters.size, 2);
  assert.equal(characters.get("一").standardIndex, 1);
  assert.deepEqual(characters.get("一").readings.Mandarin, ["yī"]);
  assert.equal(characters.get("一").unihanDefinition, "one; 1");
  assert.equal(characters.get("二").standardIndex, 2);
});

test("Chinese character worklist preserves exact and prefix-ranked atom candidates", () => {
  const worklist = buildChineseCharacterAtomWorklist({
    unihan: new Map([[
      "你",
      { character: "你", standardIndex: 1, readings: { Mandarin: ["nǐ"], Cantonese: [] } }
    ]]),
    subtlex: new Map(),
    junda: new Map(),
    cedict: new Map([[
      "你",
      [{ pinyin: "ni3", definitions: ["affection"] }]
    ]]),
    kwonRows: [],
    acceptedLinks: [],
    atomEntries: [
      { en: "affect", pya: "hfoo" },
      { en: "affectionate", pya: "hbar" }
    ],
    wordnetSenseTargets: [
      wordnetSenseTarget("hfoo", "affect"),
      wordnetSenseTarget("hbar", "affectionate")
    ],
    grammarTargets: [],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  });

  assert.deepEqual(worklist[0].exactAtomCandidates, []);
  assert.deepEqual(worklist[0].existingAtomCandidates.map(({ pya, candidateRank, lexicalMatchScore }) => ({
    pya,
    candidateRank,
    lexicalMatchScore
  })), [
    { pya: "hfoo", candidateRank: 1, lexicalMatchScore: 2 },
    { pya: "hbar", candidateRank: 2, lexicalMatchScore: 2 }
  ]);
});

test("worklist ranks linked WordNet senses, uses COW ILI matches, and filters atoms already linked elsewhere", () => {
  const [record] = buildChineseCharacterAtomWorklist({
    unihan: new Map([[
      "驱",
      { character: "驱", standardIndex: 1, readings: { Mandarin: ["qū"], Cantonese: [] } }
    ]]),
    subtlex: new Map(),
    junda: new Map(),
    cedict: new Map([["驱", [{ pinyin: "qu1", definitions: ["to drive", "to expel"] }]]]),
    kwonRows: [{ zh: "马", pya: "kyas", en: "horse" }],
    acceptedLinks: [],
    atomEntries: [
      { en: "driving", pya: "hdrive" },
      { en: "horse", pya: "kyas" },
      { en: "expulsion", pya: "hexpel" }
    ],
    wordnetSenseTargets: [
      {
        senseId: "v:01934845-v", ili: "i-driving", targetKind: "atom", targetId: "atom:hdrive",
        target: "driving", targetPartOfSpeech: "v", pyashSequence: ["hdrive"],
        english: "driving", pya: "hdrive", gloss: "operate and control a vehicle's direction and speed",
        lemmas: ["drive", "driving"]
      },
      {
        senseId: "n:10123456-n", ili: "i-horse", targetKind: "atom", targetId: "atom:kyas",
        target: "horse", targetPartOfSpeech: "n", pyashSequence: ["kyas"],
        english: "horse", pya: "kyas", gloss: "a solid-hoofed herbivorous quadruped",
        lemmas: ["horse"]
      }
    ],
    cowCharacterSenses: [
      { character: "驱", ili: "i-driving", partOfSpeech: "v", cowSynsets: ["cow-01934845-v"] },
      { character: "驱", ili: "i-horse", partOfSpeech: "n", cowSynsets: ["cow-10123456-n"] }
    ],
    grammarCharacterLinks: [],
    grammarTargets: [],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  }, { includeMapped: false, rootAtomsOnly: true });

  assert.deepEqual(record.existingAtomCandidates.map(({ pya }) => pya), ["hdrive"]);
  assert.equal(record.cowFrequencyCandidateCount, 2);
  assert.equal(record.cowFrequencyBlockedCandidateCount, 1);
  assert.deepEqual(chineseCharacterRecordsForModelReview([record]), []);
  assert.deepEqual(record.existingAtomCandidates[0].wordnetSenses.map((sense) => ({
    senseId: sense.senseId,
    cowLinked: sense.cowLinked,
    gloss: sense.gloss
  })), [{
    senseId: "v:01934845-v",
    cowLinked: true,
    gloss: "operate and control a vehicle's direction and speed"
  }]);
});

test("COW adds a current Pyash link to the first-pass review when it has an alternate atom sense", () => {
  const [record] = buildChineseCharacterAtomWorklist({
    unihan: new Map([[
      "驱",
      { character: "驱", standardIndex: 1, readings: { Mandarin: ["qū"], Cantonese: [] } }
    ]]),
    subtlex: new Map([["驱", { rank: 100 }]]),
    junda: new Map(),
    cedict: new Map([["驱", [{ pinyin: "qu1", definitions: ["to drive"] }]]]),
    kwonRows: [],
    acceptedLinks: [{
      character: "驱", english: "operate", pya: "hgo", status: "accepted",
      source: "chinese-character-atom-refinery"
    }],
    atomEntries: [{ en: "operate", pya: "hgo" }, { en: "driving", pya: "hdrive" }],
    wordnetSenseTargets: [
      wordnetSenseTarget("hgo", "operate", "v:01934846-v", "i-operate", "cause a device to function"),
      wordnetSenseTarget("hdrive", "driving", "v:01934845-v", "i-driving", "operate and control a vehicle")
    ],
    cowCharacterSenses: [{
      character: "驱", ili: "i-driving", partOfSpeech: "v", cowSynsets: ["cow-01934845-v"]
    }],
    grammarCharacterLinks: [],
    grammarTargets: [],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  }, { includeMapped: false, rootAtomsOnly: true });

  assert.equal(record.status, "cow-link-review");
  assert.equal(record.cowReviewRequired, true);
  assert.deepEqual(record.existingAtomCandidates.map(({ pya }) => pya), ["hdrive", "hgo"]);
  assert.deepEqual(record.cowReview.cowCandidates, ["hdrive"]);
  assert.equal(record.reviewPriority, 0);
});

test("first-pass root candidate lists exclude grammar catalog targets and underscored atoms", () => {
  const input = {
    unihan: new Map([[
      "甲",
      { character: "甲", standardIndex: 1, readings: { Mandarin: ["jiǎ"], Cantonese: [] } }
    ]]),
    subtlex: new Map(),
    junda: new Map(),
    cedict: new Map([["甲", [{ pinyin: "jia3", definitions: ["you", "ist"] }]]]),
    kwonRows: [],
    acceptedLinks: [],
    atomEntries: [
      { en: "you", pya: "hnan" },
      { en: "you_", pya: "sa" },
      { en: "_ist", pya: "dxi7s" }
    ],
    wordnetSenseTargets: [
      wordnetSenseTarget("hnan", "you"),
      wordnetSenseTarget("sa", "you_"),
      wordnetSenseTarget("dxi7s", "_ist")
    ],
    grammarTargets: [{ kind: "grammar", english: "you", pya: "wa" }],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  };

  assert.deepEqual(buildChineseCharacterAtomWorklist(input, { includeMapped: false })[0]
    .existingAtomCandidates.map(({ kind, pya }) => [kind, pya]), [
    ["atom", "hnan"], ["atom", "sa"], ["atom", "dxi7s"]
  ]);
  assert.deepEqual(buildChineseCharacterAtomWorklist(input, { includeMapped: false, rootAtomsOnly: true })[0]
    .existingAtomCandidates.map(({ kind, pya }) => [kind, pya]), [["atom", "hnan"]]);
});

test("Chinese character worklist uses Unihan's Mandarin reading and drops abbreviation-only gloss rows", () => {
  const worklist = buildChineseCharacterAtomWorklist({
    unihan: new Map([
      ["那", { character: "那", standardIndex: 1, readings: { Mandarin: ["nà"], Cantonese: [] } }],
      ["意", { character: "意", standardIndex: 2, readings: { Mandarin: ["yì"], Cantonese: [] } }]
    ]),
    subtlex: new Map(),
    junda: new Map(),
    cedict: new Map([
      ["那", [
        { pinyin: "Na1", definitions: ["surname Na"] },
        { pinyin: "na4", definitions: ["that", "those"] },
        { pinyin: "nuo2", definitions: ["many", "beautiful", "how"] }
      ]],
      ["意", [
        { pinyin: "yi4", definitions: ["Italy", "Italian", "abbr. for 意大利[Yi4 da4 li4]"] },
        { pinyin: "yi4", definitions: ["idea", "meaning", "thought"] }
      ]]
    ]),
    kwonRows: [],
    acceptedLinks: [],
    atomEntries: [],
    grammarTargets: [],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  }, { includeMapped: false, rootAtomsOnly: true });

  const byCharacter = new Map(worklist.map((record) => [record.character, record]));
  assert.deepEqual(byCharacter.get("那").englishCandidates, ["that", "those"]);
  assert.deepEqual(byCharacter.get("意").englishCandidates, ["idea", "meaning", "thought"]);
});

test("frequency preserves the common you mapping while marking the lower-frequency honorific for review", () => {
  const rows = buildChineseCharacterAtomWorklist({
    unihan: new Map([
      ["你", { character: "你", standardIndex: 1, readings: { Mandarin: ["nǐ"], Cantonese: [] } }],
      ["您", { character: "您", standardIndex: 2, readings: { Mandarin: ["nín"], Cantonese: [] } }]
    ]),
    subtlex: new Map([["你", { rank: 3 }], ["您", { rank: 396 }]]),
    junda: new Map(),
    cedict: new Map([
      ["你", [{ pinyin: "ni3", definitions: ["you (informal, as opposed to courteous 您[nin2])"] }]],
      ["您", [{ pinyin: "nin2", definitions: ["you (courteous, as opposed to informal 你[ni3])"] }]]
    ]),
    kwonRows: [{ zh: "您", pya: "hnan", en: "you" }],
    acceptedLinks: [{ character: "你", pya: "hnan", english: "you", status: "accepted" }],
    atomEntries: [{ en: "you", pya: "hnan" }],
    grammarTargets: [],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  });
  const byCharacter = new Map(rows.map((row) => [row.character, row]));

  assert.equal(byCharacter.get("你").status, "already-mapped");
  assert.equal(byCharacter.get("你").specificityConflict, false);
  assert.equal(byCharacter.get("您").status, "specificity-review");
  assert.equal(byCharacter.get("您").specificityConflict, true);
});

test("Chinese character refinery duty waves advance with a safe default parallelism", () => {
  const pending = ["a", "b", "c", "d"];

  assert.deepEqual(nextChineseCharacterDutyWave(pending, 0, { dutiesRemaining: 3 }), ["a"]);
  assert.deepEqual(nextChineseCharacterDutyWave(pending, 1, { parallelism: 4, dutiesRemaining: 2 }), ["b", "c"]);
  assert.deepEqual(nextChineseCharacterDutyWave(pending, 3, { parallelism: 4, dutiesRemaining: 0 }), []);
});

test("Chinese character refinery parses Ollama envelopes for every Housekeeper stage", () => {
  const record = {
    id: "fixture-character",
    existingAtomCandidates: [
      { kind: "atom", pya: "hnan", wordnetSenses: [candidateSense("hnan")] },
      { kind: "atom", pya: "hfoo", wordnetSenses: [candidateSense("hfoo")] }
    ]
  };
  const envelope = (response) => JSON.stringify({
    model: "fixture-model",
    response: JSON.stringify(response),
    done: true
  });

  assert.deepEqual(parseChineseCharacterAtomReviewResponse(envelope({
    verdict: "match",
    confidence: "high",
    matches: [
      { targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "base", rationale: "Best fit." },
      { targetId: "atom:hfoo", senseId: "n:hfoo-sense", relation: "same-sense", rationale: "Related fallback." }
    ],
    rationale: "The evidence ranks the base atom first."
  }), record), {
    verdict: "match",
    confidence: "high",
    matches: [
      { targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "base", rationale: "Best fit." },
      { targetId: "atom:hfoo", senseId: "n:hfoo-sense", relation: "same-sense", rationale: "Related fallback." }
    ],
    rationale: "The evidence ranks the base atom first."
  });
  assert.deepEqual(parseChineseCharacterTranslationResponse(envelope({
    verdict: "complete",
    translations: [{ english: "you", sense: "second-person pronoun", register: "unmarked", evidence: "Dictionary gloss." }]
  }), record).translations[0].english, "you");
  assert.deepEqual(parseChineseCharacterPhoneticResponse(envelope({
    entries: [{ language: "zh", transcription: "nǐ", source: "Unihan Mandarin reading." }]
  }), record).entries[0].transcription, "nǐ");
  assert.throws(() => parseChineseCharacterAtomReviewResponse(JSON.stringify({
    response: "{ invalid",
    done: true
  }), record), /malformed JSON/u);
  assert.throws(() => parseChineseCharacterAtomReviewResponse(envelope({
    verdict: "match",
    matches: [{ targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "base", rationale: "Base meaning." }],
    rationale: "Missing confidence."
  }), record), /expected contract/u);
});

test("sense review requires the chosen WordNet synset and prompts against its linked definition", () => {
  const sense = {
    senseId: "n:00299323-n",
    ili: "i321",
    partOfSpeech: "n",
    gloss: "the act of controlling and steering the movement of a vehicle or animal",
    lemmas: ["driving"],
    cowLinked: true
  };
  const record = {
    id: "zh-char-qu",
    character: "驱",
    readings: { Mandarin: ["qū"] },
    englishCandidates: ["to drive"],
    evidence: { cedict: [{ pinyin: "qu1", definitions: ["to drive"] }] },
    existingAtomCandidates: [{ kind: "atom", pya: "hdok", english: "driving", wordnetSenses: [sense] }]
  };
  const parsed = parseChineseCharacterAtomReviewResponse(JSON.stringify({
    response: JSON.stringify({
      verdict: "match",
      confidence: "high",
      matches: [{ targetId: "atom:hdok", senseId: "n:00299323-n", relation: "same-sense", rationale: "The linked synset definition matches the Chinese driving sense." }],
      rationale: "The synset definition fits the standalone Chinese meaning."
    }),
    done: true
  }), record);
  const prompt = buildChineseCharacterAtomReviewPrompt(record);

  assert.equal(parsed.matches[0].senseId, "n:00299323-n");
  assert.match(prompt, /WordNet sense definition/u);
  assert.match(prompt, /the act of controlling and steering/u);
  assert.match(prompt, /COW direct character-to-synset evidence/u);
  assert.match(prompt, /Character: 驱/u);
  assert.doesNotMatch(prompt, /Rank only the supplied Pyash targets by semantic fit/u);
});

test("Chinese character match parsing accepts medium ranked alternatives and skips marked targets later", () => {
  const record = {
    id: "zh-char-honorific-you",
    character: "您",
    englishCandidates: ["you", "honorific for you"],
    existingMappings: [{ english: "you", pya: "hnan", kind: "kwon" }],
    existingAtomCandidates: [
      { kind: "atom", pya: "hnan", wordnetSenses: [candidateSense("hnan")] },
      { kind: "atom", pya: "hfoo", wordnetSenses: [candidateSense("hfoo")] }
    ]
  };
  const response = JSON.stringify({
    response: JSON.stringify({
      verdict: "match",
      confidence: "medium",
      matches: [
        { targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "marked", rationale: "Broad related sense." },
        { targetId: "atom:hfoo", senseId: "n:hfoo-sense", relation: "same-sense", rationale: "Closer semantic fallback." }
      ],
      rationale: "Two candidates fit to different degrees."
    }),
    done: true
  });
  assert.deepEqual(parseChineseCharacterAtomReviewResponse(response, record).matches.map(({ targetId }) => targetId), [
    "atom:hnan", "atom:hfoo"
  ]);
  const prompt = buildChineseCharacterAtomReviewPrompt({
    ...record,
    existingMappings: [],
    evidence: { cedict: [] }
  });
  assert.match(prompt, /Do not invent targets/u);
  assert.match(prompt, /or decide which Chinese character is more frequent/iu);
  assert.match(prompt, /Use the supplied Unihan Mandarin reading/u);
  assert.doesNotMatch(prompt, /SUBTLEX-CH rank|Jun Da modern-text rank/u);
});

test("Chinese character proposals retain specificity review state after translation", async () => {
  const [proposal] = await buildChineseCharacterAtomProposals([{
    id: "zh-char-honorific-you",
    character: "您",
    status: "specificity-review",
    frequency: { subtlexRank: 396 },
    englishCandidates: ["you", "honorific for you"],
    existingMappings: [{ english: "you", pya: "hnan", kind: "kwon" }],
    existingAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    exactAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    relatedCharacters: [{ character: "你", subtlexRank: 3, rankRelation: "less-frequent" }],
    evidence: { cedict: [{ definitions: ["you (courteous, as opposed to informal 你)"] }] },
    specificityConflict: true
  }], { atomEntries: [], grammarTargets: [] }, {
    translationsByCharacter: new Map([["zh-char-honorific-you", {
      translations: [{ english: "you (honorific)", sense: "standalone", register: "formal", evidence: "dictionary" }]
    }]]),
    specificityReassignments: new Set(["zh-char-honorific-you"])
  });

  assert.equal(proposal.specificityConflict, false);
  assert.equal(proposal.specificityReviewRequired, true);
});

test("first-pass Qwen review includes every supplied non-COW candidate row, including a unique exact candidate", () => {
  const uniqueExact = {
    id: "zh-char-you",
    character: "你",
    evidence: { cedict: [] },
    existingAtomCandidates: [{ kind: "atom", pya: "hnan" }],
    exactAtomCandidates: [{ kind: "atom", pya: "hnan" }]
  };
  const relatedCandidate = {
    id: "zh-char-related",
    character: "近",
    evidence: { cedict: [] },
    existingAtomCandidates: [{ kind: "atom", pya: "hbar" }],
    exactAtomCandidates: []
  };
  const noCandidate = { id: "zh-char-empty", existingAtomCandidates: [], exactAtomCandidates: [] };

  assert.deepEqual(buildChineseCharacterAtomMatchTasks([uniqueExact, relatedCandidate, noCandidate], new Map(), {
    requireEveryCandidate: true
  }).map((task) => task.recordId), ["zh-char-you", "zh-char-related"]);
  assert.deepEqual(buildChineseCharacterAtomMatchTasks([uniqueExact, relatedCandidate, noCandidate], new Map())
    .map((task) => task.recordId), ["zh-char-related"]);
});

test("automatic linking accepts ranked semantic fallbacks and deterministically allocates each atom once", () => {
  const selected = {
    verdict: "match",
    confidence: "high",
    matches: [
      { targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "base", rationale: "Direct unmarked pronoun." },
      { targetId: "atom:hfoo", senseId: "n:hfoo-sense", relation: "same-sense", rationale: "Related fallback." }
    ],
    rationale: "The dictionary evidence supports the base atom."
  };
  const you = {
    character: "你",
    standardIndex: 1,
    existingAtomCandidates: [
      { kind: "atom", english: "you", pya: "hnan", wordnetSenses: [candidateSense("hnan")] },
      { kind: "atom", english: "fondness", pya: "hfoo", wordnetSenses: [candidateSense("hfoo")] }
    ],
    exactAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    existingMappings: [],
    frequency: { subtlexRank: 3 },
    relatedCharacters: [{ character: "您", subtlexRank: 396 }],
    modelMatch: selected
  };
  const rows = highConfidenceChineseCharacterAtomLinks([
    { ...you, character: "您", standardIndex: 2, frequency: { subtlexRank: 396 } },
    { ...you, character: "你", frequency: { subtlexRank: 3 }, modelMatch: { ...selected, confidence: "medium", matches: [selected.matches[0]] } },
    { ...you, character: "他", modelMatch: { ...selected, matches: [{ ...selected.matches[0], relation: "marked" }] } },
    { ...you, character: "她", modelMatch: { ...selected, confidence: "low" } },
    { ...you, character: "它", modelMatch: { ...selected, verdict: "no-fit", matches: [] } },
    {
      ...you,
      character: "吗",
      existingAtomCandidates: [
        { kind: "atom", english: "interrogative_mood_", pya: "hyut" },
        { kind: "grammar", english: "interrogative_mood", pya: "tseh" }
      ],
      modelMatch: {
        verdict: "match",
        confidence: "high",
        matches: [
          { targetId: "atom:hyut", senseId: "n:hyut-sense", relation: "same-sense", rationale: "Grammar word." },
          { targetId: "grammar:tseh", relation: "same-sense", rationale: "Grammar target." }
        ]
      }
    },
    {
      ...you,
      character: "者",
      existingAtomCandidates: [{ kind: "atom", english: "_ist", pya: "dxi7s" }],
      modelMatch: {
        verdict: "match",
        confidence: "high",
        matches: [{ targetId: "atom:dxi7s", senseId: "n:dxi7s-sense", relation: "same-sense", rationale: "Derivational marker." }]
      }
    },
    { ...you, character: "熟", existingMappings: [{ pya: "other" }] },
    { ...you, character: "没", modelMatch: undefined }
  ], [
    { character: "它", pya: "hbar", status: "accepted" }
  ]);

  assert.deepEqual(rows.map(({ character, pya, confidence }) => ({ character, pya, confidence })), [
    { character: "你", pya: "hnan", confidence: "medium" },
    { character: "您", pya: "hfoo", confidence: "high" }
  ]);
  assert.deepEqual(highConfidenceChineseCharacterAtomLinks([{ ...you, modelMatch: undefined }]), []);
});

test("automatic character links keep the selected WordNet sense available for review provenance", () => {
  const candidate = {
    kind: "atom",
    english: "driving",
    pya: "hdok",
    wordnetSenses: [{
      senseId: "n:00299323-n",
      ili: "i321",
      partOfSpeech: "n",
      gloss: "the act of controlling and steering a vehicle",
      lemmas: ["driving"],
      cowLinked: true
    }]
  };
  const [link] = highConfidenceChineseCharacterAtomLinks([{
    character: "驱",
    existingAtomCandidates: [candidate],
    existingMappings: [],
    frequency: { subtlexRank: 100 },
    modelMatch: {
      verdict: "match",
      confidence: "high",
      matches: [{ targetId: "atom:hdok", senseId: "n:00299323-n", relation: "base", rationale: "The synset definition matches." }]
    }
  }]);

  assert.equal(link.pya, "hdok");
  assert.equal(link.wordNetSenseId, "n:00299323-n");
});

test("COW review can replace an existing refinery link with a better linked WordNet sense", () => {
  const replacement = {
    kind: "atom",
    english: "driving",
    pya: "hdok",
    wordnetSenses: [candidateSense(
      "hdok",
      "v:01934845-v",
      "i-driving",
      "operate and control a vehicle's direction and speed"
    )]
  };
  const [withdrawn, accepted] = highConfidenceChineseCharacterAtomLinks([{
    character: "驱",
    existingMappings: [{ character: "驱", english: "drive", pya: "hgo", kind: "pyash-curated" }],
    cowReviewRequired: true,
    specificityConflict: true,
    existingAtomCandidates: [replacement],
    frequency: { subtlexRank: 100 },
    modelMatch: {
      verdict: "match",
      confidence: "high",
      matches: [{ targetId: "atom:hdok", senseId: "v:01934845-v", relation: "base", rationale: "The COW-linked WordNet sense fits." }]
    }
  }], [{
    character: "驱",
    english: "drive",
    pya: "hgo",
    status: "accepted",
    source: "chinese-character-atom-refinery"
  }]);

  assert.deepEqual({ character: withdrawn.character, pya: withdrawn.pya, status: withdrawn.status }, {
    character: "驱", pya: "hgo", status: "withdrawn"
  });
  assert.deepEqual({ character: accepted.character, pya: accepted.pya, status: accepted.status }, {
    character: "驱", pya: "hdok", status: "accepted"
  });
  assert.equal(accepted.wordNetSenseId, "v:01934845-v");
});

test("automatically linked characters appear in the accepted vocabulary projection", () => {
  const links = highConfidenceChineseCharacterAtomLinks([{
    character: "你",
    existingAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan", wordnetSenses: [candidateSense("hnan")] }],
    exactAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan", wordnetSenses: [candidateSense("hnan")] }],
    existingMappings: [],
    frequency: { subtlexRank: 3 },
    relatedCharacters: [],
    modelMatch: {
      verdict: "match",
      confidence: "high",
      matches: [{ targetId: "atom:hnan", senseId: "n:hnan-sense", relation: "base", rationale: "Direct lexical fit." }],
      rationale: "Direct dictionary match."
    }
  }]);
  const accepted = parseChineseCharacterAtomLinks(renderChineseCharacterAtomLinksPya(links));

  assert.deepEqual(acceptedChineseCharacterAtomRows([], accepted).map(({ character, english, pya }) => ({ character, english, pya })), [
    { character: "你", english: "you", pya: "hnan" }
  ]);
});

test("existing Chinese character conflicts keep root links and the higher-frequency duplicate atom", () => {
  const result = reconcileChineseCharacterAtomLinkConflicts({
    acceptedLinks: [
      { character: "想", pya: "hcik", english: "think", status: "accepted" },
      { character: "意", pya: "hcik", english: "think", status: "accepted" },
      { character: "你", pya: "hnan", english: "you", status: "accepted" }
    ],
    grammarCharacterLinks: [
      { character: "你", pya: "sa", source: "chinese-character-grammar-refinery" },
      { character: "他", pya: "clah", source: "chinese-character-grammar-refinery" },
      { character: "你", pya: "hbar", source: "user-approved-character-mapping" }
    ],
    subtlex: new Map([["想", { rank: 28 }], ["意", { rank: 78 }]]),
    junda: new Map(),
    unihan: new Map([["想", { standardIndex: 1 }], ["意", { standardIndex: 2 }]])
  });

  assert.deepEqual(result.grammarCharactersToRemove, ["你"]);
  assert.deepEqual(result.withdrawn, [{ character: "意", pya: "hcik" }]);
  assert.deepEqual(result.acceptedLinks.map(({ character, status }) => [character, status]), [
    ["想", "accepted"], ["意", "withdrawn"], ["你", "accepted"]
  ]);
});

test("existing Chinese root links to underscore-marked morphology targets are withdrawn", () => {
  const result = reconcileChineseCharacterAtomLinkConflicts({
    acceptedLinks: [{ character: "者", pya: "dxi7s", english: "_ist", status: "accepted" }],
    grammarCharacterLinks: [],
    atomEntries: [{ en: "_ist", pya: "dxi7s" }],
    subtlex: new Map(),
    junda: new Map(),
    unihan: new Map()
  });

  assert.deepEqual(result.withdrawn, [{ character: "者", pya: "dxi7s" }]);
  assert.equal(result.acceptedLinks[0].status, "withdrawn");
});
