import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { CHINESE_CHARACTER_ATOM_REFINERY_CONFIG_URL } from "../program/library/translation/chinese_character_atom_refinery.mjs";
import {
  buildChineseCharacterAtomWorklist,
  buildChineseCharacterAtomProposals,
  parseChineseCharacterAtomReviewResponse,
  parseChineseCharacterPhoneticResponse,
  parseChineseCharacterTranslationResponse,
  highConfidenceChineseCharacterAtomLinks,
  parseChineseCharacterAtomLinks,
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
    existingAtomCandidates: [{ kind: "atom", pya: "hnan" }]
  };
  const envelope = (response) => JSON.stringify({
    model: "fixture-model",
    response: JSON.stringify(response),
    done: true
  });

  assert.deepEqual(parseChineseCharacterAtomReviewResponse(envelope({
    verdict: "select",
    confidence: "high",
    matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Base meaning." }],
    rationale: "The evidence supports the base atom."
  }), record), {
    verdict: "select",
    confidence: "high",
    matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Base meaning." }],
    rationale: "The evidence supports the base atom."
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
    verdict: "select",
    matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Base meaning." }],
    rationale: "Missing confidence."
  }), record), /expected contract/u);
});

test("Chinese character refinement keeps generic links blocked through specificity reassignment", () => {
  const record = {
    id: "zh-char-honorific-you",
    character: "您",
    englishCandidates: ["you", "honorific for you"],
    existingMappings: [{ english: "you", pya: "hnan", kind: "kwon" }],
    existingAtomCandidates: [{ kind: "atom", pya: "hnan" }]
  };
  const response = JSON.stringify({
    response: JSON.stringify({
      verdict: "select",
      confidence: "high",
      matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Core meaning is you." }],
      rationale: "The honorific maps to the ordinary you atom."
    }),
    done: true
  });

  for (const specificity of [
    { specificityConflict: true },
    { specificityConflict: false, specificityReviewRequired: true }
  ]) {
    assert.throws(() => parseChineseCharacterAtomReviewResponse(response, { ...record, ...specificity }), /explicit specificity conflict/u);
  }
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

test("automatic linking requires high-confidence Qwen selection of one exact base atom", () => {
  const selected = {
    verdict: "select",
    confidence: "high",
    matches: [{ targetId: "atom:hnan", relation: "base", rationale: "Direct unmarked pronoun." }],
    rationale: "The dictionary evidence supports the base atom."
  };
  const you = {
    character: "你",
    existingAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    exactAtomCandidates: [{ kind: "atom", english: "you", pya: "hnan" }],
    existingMappings: [],
    frequency: { subtlexRank: 3 },
    relatedCharacters: [{ character: "您", subtlexRank: 396 }],
    modelMatch: selected
  };
  const rows = highConfidenceChineseCharacterAtomLinks([
    you,
    { ...you, character: "他", modelMatch: { ...selected, confidence: "medium" } },
    { ...you, character: "她", modelMatch: { ...selected, matches: [...selected.matches, selected.matches[0]] } },
    { ...you, character: "它", modelMatch: { ...selected, matches: [{ ...selected.matches[0], relation: "marked" }] } },
    { ...you, character: "是", modelMatch: { ...selected, verdict: "no-fit", matches: [] } },
    { ...you, character: "您", frequency: { subtlexRank: 396 }, relatedCharacters: [{ character: "你", subtlexRank: 3 }] },
    { ...you, character: "熟", specificityConflict: true },
    { ...you, character: "熟2", exactAtomCandidates: [] },
    { ...you, character: "没", modelMatch: undefined }
  ]);

  assert.deepEqual(rows.map(({ character, pya, confidence }) => ({ character, pya, confidence })), [
    { character: "你", pya: "hnan", confidence: "high" }
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
      verdict: "select",
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
