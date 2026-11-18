import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL } from "../program/library/translation/chinese_character_atom_refinery.mjs";
import {
  buildChineseCharacterAtomWorklist,
  buildChineseCharacterAtomProposals,
  buildChineseCharacterAtomReviewPrompt,
  parseChineseCharacterAtomReviewResponse,
  parseChineseCharacterPhoneticResponse,
  parseChineseCharacterTranslationResponse,
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
  nextChineseCharacterDutyWave
} from "../command/chinese_character_atom_refinery.mjs";

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

test("first-pass root candidate lists exclude grammar catalog targets and underscored atoms", () => {
  const input = {
    unihan: new Map([[
      "甲",
      { character: "甲", standardIndex: 1, readings: { Mandarin: ["jiǎ"], Cantonese: [] } }
    ]]),
    subtlex: new Map(),
    junda: new Map(),
    cedict: new Map([["甲", [{ pinyin: "jia3", definitions: ["you"] }]]]),
    kwonRows: [],
    acceptedLinks: [],
    atomEntries: [
      { en: "you", pya: "hnan" },
      { en: "you_", pya: "sa" }
    ],
    grammarTargets: [{ kind: "grammar", english: "you", pya: "wa" }],
    shuowenByCharacter: new Map(),
    analectsSource: ""
  };

  assert.deepEqual(buildChineseCharacterAtomWorklist(input, { includeMapped: false })[0]
    .existingAtomCandidates.map(({ kind, pya }) => [kind, pya]), [
    ["atom", "hnan"], ["atom", "sa"], ["grammar", "wa"]
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
      { kind: "atom", pya: "hnan" },
      { kind: "atom", pya: "hfoo" }
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
      { targetId: "atom:hnan", relation: "base", rationale: "Best fit." },
      { targetId: "atom:hfoo", relation: "same-sense", rationale: "Related fallback." }
    ],
    rationale: "The evidence ranks the base atom first."
  }), record), {
    verdict: "match",
    confidence: "high",
    matches: [
      { targetId: "atom:hnan", relation: "base", rationale: "Best fit." },
      { targetId: "atom:hfoo", relation: "same-sense", rationale: "Related fallback." }
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
    matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Base meaning." }],
    rationale: "Missing confidence."
  }), record), /expected contract/u);
});

test("Chinese character match parsing accepts medium ranked alternatives and skips marked targets later", () => {
  const record = {
    id: "zh-char-honorific-you",
    character: "您",
    englishCandidates: ["you", "honorific for you"],
    existingMappings: [{ english: "you", pya: "hnan", kind: "kwon" }],
    existingAtomCandidates: [
      { kind: "atom", pya: "hnan" },
      { kind: "atom", pya: "hfoo" }
    ]
  };
  const response = JSON.stringify({
    response: JSON.stringify({
      verdict: "match",
      confidence: "medium",
      matches: [
        { targetId: "atom:hnan", relation: "marked", rationale: "Broad related sense." },
        { targetId: "atom:hfoo", relation: "same-sense", rationale: "Closer semantic fallback." }
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
  assert.match(prompt, /Do not invent a target/u);
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

test("first-pass Qwen review includes every candidate-bearing row, including a unique exact candidate", () => {
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
      { targetId: "atom:hnan", relation: "base", rationale: "Direct unmarked pronoun." },
      { targetId: "atom:hfoo", relation: "same-sense", rationale: "Related fallback." }
    ],
    rationale: "The dictionary evidence supports the base atom."
  };
  const you = {
    character: "你",
    standardIndex: 1,
    existingAtomCandidates: [
      { kind: "atom", english: "you", pya: "hnan" },
      { kind: "atom", english: "fondness", pya: "hfoo" }
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
          { targetId: "atom:hyut", relation: "same-sense", rationale: "Grammar word." },
          { targetId: "grammar:tseh", relation: "same-sense", rationale: "Grammar target." }
        ]
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

test("automatically linked characters appear in the accepted vocabulary projection", () => {
  const links = highConfidenceChineseCharacterAtomLinks([{
    character: "你",
    existingAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    exactAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    existingMappings: [],
    frequency: { subtlexRank: 3 },
    relatedCharacters: [],
    modelMatch: {
      verdict: "match",
      confidence: "high",
      matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Direct lexical fit." }],
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
