import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChineseCharacterGrammarReviewPrompt,
  buildChineseCharacterGrammarWorklist,
  highConfidenceChineseCharacterGrammarLinks,
  parseClassicalFunctionCharacterCandidates,
  parseChineseCharacterGrammarReviewResponse,
  parseEnglishGrammarCharacterTargets
} from "../program/library/translation/chinese_character_grammar_refinery.mjs";
import {
  parseEnglishGrammarCatalog,
  removeEnglishGrammarChineseCharacterLinks,
  renderEnglishGrammarChineseCharacterLinks
} from "../program/library/translation/english_grammar.mjs";

function pyaJson(value) {
  return JSON.stringify(JSON.stringify(value));
}

function grammarCatalogSource() {
  return [
    "su name translation_english_grammar be map def",
    'su text "format" ob text "english-grammar-v1" ya',
    'su text "source" ob text "test catalog" ya',
    'su text "source-hash" ob text "test-hash" ya',
    `su text "also" ob text ${pyaJson({ surface: "also", kind: "conjunction", components: ["also_"], pyashSequence: ["pcah"], evidence: "test evidence" })} ya`,
    `su text "and" ob text ${pyaJson({ surface: "and", kind: "conjunction", components: ["and_"], pyashSequence: ["wa"], evidence: "test evidence" })} ya`,
    `su text "you" ob text ${pyaJson({ surface: "you", kind: "pronoun", components: ["you_"], pyashSequence: ["sa"], evidence: "test evidence" })} ya`,
    `su text "lexical decoy" ob text ${pyaJson({ surface: "lexical decoy", kind: "pronoun", components: ["decoy_"], pyashSequence: ["fyif"], evidence: "test evidence" })} ya`,
    `su text "multiword decoy" ob text ${pyaJson({ surface: "multiword decoy", kind: "pronoun", components: ["you_", "also_"], pyashSequence: ["sa", "pcah"], evidence: "test evidence" })} ya`,
    "prah",
    ""
  ].join("\n");
}

function classicalCandidateSource(characters) {
  return [
    "su name classical_chinese_function_character_candidates be map def",
    'su text "meta:format" ob text "classical-chinese-function-character-candidates-v1" ya',
    'su text "meta:source" ob text "CCL-15-112 section 4.3" ya',
    ...characters.map((character) => `su text "character:${character}" ob text ${pyaJson({ character })} ya`),
    "prah",
    ""
  ].join("\n");
}

test("classical function-character source validates provenance and single Han rows", () => {
  assert.deepEqual(parseClassicalFunctionCharacterCandidates(classicalCandidateSource(["之", "也"])), {
    sourceId: "CCL-15-112 section 4.3",
    characters: ["之", "也"]
  });
  assert.throws(() => parseClassicalFunctionCharacterCandidates(classicalCandidateSource(["之", "之"])), /unique rows/u);
  assert.throws(() => parseClassicalFunctionCharacterCandidates(classicalCandidateSource(["之", "ab"])), /one Han character/u);
});

test("grammar targets include only single-word Pyash grammar codes", () => {
  const { targets } = parseEnglishGrammarCharacterTargets(grammarCatalogSource());
  assert.deepEqual(targets.map((target) => target.english), ["also", "and", "you"]);
  assert.equal(targets.some((target) => target.pya === "fyif"), false);
  assert.equal(targets.some((target) => target.components.length > 1), false);
});

test("worklist requires direct grammar glosses and ranks classical seeds before modern candidates", () => {
  const grammarTargets = parseEnglishGrammarCharacterTargets(grammarCatalogSource()).targets;
  const unihan = new Map(["也", "乎", "与"].map((character) => [character, { readings: { Mandarin: ["test"] } }]));
  const cedict = new Map([
    ["也", [{ pinyin: "ye3", definitions: ["also", "(in Classical Chinese) final particle implying affirmation"] }]],
    ["乎", [{ pinyin: "hu1", definitions: ['particle indicating a question ("And you?")'] }]],
    ["与", [{ pinyin: "yu3", definitions: ["and", "together with"] }]]
  ]);
  const udSource = {
    name: "test GSDSimp",
    text: [
      "# sent_id = 1",
      "# text = 也与乎牛",
      "1\t也\t也\tSCONJ\tCS\t_\t0\troot\t_\t_",
      "2\t与\t与\tCCONJ\tCC\t_\t1\tconj\t_\t_",
      "3\t乎\t乎\tPART\tSP\t_\t1\tdiscourse\t_\t_",
      "4\t牛\t牛\tNOUN\tNN\t_\t1\tobj\t_\t_",
      ""
    ].join("\n")
  };
  const worklist = buildChineseCharacterGrammarWorklist({
    unihan,
    subtlex: new Map(),
    cedict,
    shuowenByCharacter: new Map(),
    classicalCandidates: { sourceId: "CCL-15-112 section 4.3", characters: ["也", "乎"] },
    leggeSource: "header\n論語\n也者與乎",
    wenYenSource: "header\n*** START OF THE PROJECT GUTENBERG EBOOK 論語 ***\n也者與乎",
    udSources: [udSource],
    grammarTargets,
    existingLinks: []
  });
  assert.deepEqual(worklist.map((record) => record.character), ["也", "与"]);
  assert.deepEqual(worklist[0].grammarTargets.map((target) => target.english), ["also"]);
  assert.deepEqual(worklist[1].grammarTargets.map((target) => target.english), ["and"]);
  assert.equal(worklist[0].classicalSeed, true);
  assert.equal(worklist[1].classicalSeed, false);
  const linkedWorklist = buildChineseCharacterGrammarWorklist({
    unihan,
    subtlex: new Map(),
    cedict,
    shuowenByCharacter: new Map(),
    classicalCandidates: { sourceId: "CCL-15-112 section 4.3", characters: ["也", "乎"] },
    leggeSource: "header\n論語\n也者與乎",
    wenYenSource: "header\n*** START OF THE PROJECT GUTENBERG EBOOK 論語 ***\n也者與乎",
    udSources: [udSource],
    grammarTargets,
    existingLinks: [{ character: "也", targetId: grammarTargets[0].id, status: "accepted" }]
  });
  assert.deepEqual(linkedWorklist.map((record) => record.character), ["与"]);
});

test("grammar prompt and response contract restrict review to supplied targets", () => {
  const grammarTargets = parseEnglishGrammarCharacterTargets(grammarCatalogSource()).targets;
  const record = {
    id: "zh-grammar-char-4e5f",
    character: "也",
    classicalSeed: true,
    sources: ["CCL-15-112 section 4.3"],
    frequency: {
      classicalLeggeOccurrences: 2,
      classicalWenYenOccurrences: 2,
      gsdsimpGrammarOccurrences: 4,
      gsdsimpUpostagCounts: { SCONJ: 4 }
    },
    evidence: {
      cedict: [{ pinyin: "ye3", definitions: ["also"] }],
      unihanDefinition: "also",
      shuowen: "",
      classicalLegge: [],
      classicalWenYen: [],
      gsdsimp: []
    },
    existingGrammarLinks: [],
    grammarTargets: grammarTargets.filter((target) => target.english === "also")
  };
  const prompt = buildChineseCharacterGrammarReviewPrompt(record);
  assert.match(prompt, /No lexical root targets/u);
  assert.match(prompt, /one-to-one/u);
  assert.match(prompt, /ordered fallback list/u);
  assert.match(prompt, /Existing Pyash grammar targets/u);
  assert.doesNotMatch(prompt, /fyif/u);
  assert.deepEqual(parseChineseCharacterGrammarReviewResponse({
    verdict: "select",
    confidence: "high",
    matches: [{ targetId: record.grammarTargets[0].id, relation: "base", rationale: "The gloss and contexts support this use." }],
    rationale: "Direct grammatical sense."
  }, record).matches[0].targetId, record.grammarTargets[0].id);
  assert.throws(() => parseChineseCharacterGrammarReviewResponse({
    verdict: "select",
    confidence: "high",
    matches: [{ targetId: "root:invented", relation: "base", rationale: "not supplied" }],
    rationale: "Invented target."
  }, record), /unprovided target/u);
  assert.throws(() => parseChineseCharacterGrammarReviewResponse({
    verdict: "select",
    confidence: "high",
    matches: [
      { targetId: record.grammarTargets[0].id, relation: "base", rationale: "First candidate." },
      { targetId: record.grammarTargets[0].id, relation: "same-sense", rationale: "Duplicate atom." }
    ],
    rationale: "Duplicate target candidate."
  }, { ...record, grammarTargets: [record.grammarTargets[0], { ...record.grammarTargets[0], id: "alias-target" }] }), /repeats a Pyash atom/u);
});

test("high-confidence grammar linking withholds marked and lower-confidence decisions", () => {
  const target = parseEnglishGrammarCharacterTargets(grammarCatalogSource()).targets.find((entry) => entry.english === "also");
  const record = {
    character: "也",
    sources: ["CCL-15-112 section 4.3"],
    classicalSeed: true,
    frequency: { classicalLeggeOccurrences: 1, classicalWenYenOccurrences: 1, gsdsimpGrammarOccurrences: 1, gsdsimpUpostagCounts: {} },
    grammarTargets: [target],
    grammarMatch: {
      verdict: "select",
      confidence: "high",
      matches: [{ targetId: target.id, relation: "base", rationale: "Direct gloss and grammatical context." }],
      rationale: "Supported."
    }
  };
  const accepted = highConfidenceChineseCharacterGrammarLinks([record]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].status, "accepted");
  assert.equal(accepted[0].confidence, "high");
  assert.equal(highConfidenceChineseCharacterGrammarLinks([record], accepted).length, 0);
  assert.equal(highConfidenceChineseCharacterGrammarLinks([{
    ...record,
    grammarMatch: { ...record.grammarMatch, confidence: "medium" }
  }]).length, 0);
  assert.equal(highConfidenceChineseCharacterGrammarLinks([{
    ...record,
    grammarMatch: { ...record.grammarMatch, matches: [{ ...record.grammarMatch.matches[0], relation: "marked" }] }
  }]).length, 0);
});

test("frequency allocation assigns one atom per character and falls back after an atom is claimed", () => {
  const targets = parseEnglishGrammarCharacterTargets(grammarCatalogSource()).targets;
  const and = targets.find((target) => target.english === "and");
  const you = targets.find((target) => target.english === "you");
  const records = [
    {
      character: "甲",
      sources: ["UD test"],
      classicalSeed: false,
      frequency: { gsdsimpUpostagCounts: { CCONJ: 20, PRON: 10 }, subtlexCount: 100 },
      grammarTargets: [and, you],
      grammarMatch: {
        verdict: "select",
        confidence: "high",
        matches: [
          { targetId: and.id, relation: "base", rationale: "Most frequent candidate use." },
          { targetId: you.id, relation: "same-sense", rationale: "Fallback use." }
        ]
      }
    },
    {
      character: "乙",
      sources: ["UD test"],
      classicalSeed: false,
      frequency: { gsdsimpUpostagCounts: { CCONJ: 30 }, subtlexCount: 50 },
      grammarTargets: [and],
      grammarMatch: {
        verdict: "select",
        confidence: "high",
        matches: [{ targetId: and.id, relation: "base", rationale: "Higher-frequency conjunction use." }]
      }
    }
  ];
  const links = highConfidenceChineseCharacterGrammarLinks(records);
  assert.equal(links.length, 2);
  assert.deepEqual(new Set(links.map((link) => link.character)), new Set(["甲", "乙"]));
  assert.deepEqual(new Set(links.map((link) => link.pya)), new Set([and.pya, you.pya]));
  const assigned = new Map(links.map((link) => [link.character, link]));
  assert.equal(assigned.get("甲").pya, you.pya);
  assert.equal(assigned.get("甲").candidateRank, 2);
  assert.equal(assigned.get("甲").relevantUseFrequency, 10);
  assert.equal(assigned.get("乙").pya, and.pya);
});

test("accepted grammar links render into the English grammar catalog", () => {
  const source = grammarCatalogSource();
  const target = parseEnglishGrammarCharacterTargets(source).targets.find((entry) => entry.english === "also");
  const link = {
    character: "也",
    targetId: target.id,
    pya: target.pya,
    components: target.components,
    english: target.english,
    relation: "base",
    confidence: "high",
    status: "accepted",
    source: "chinese-character-grammar-refinery",
    sources: ["CCL-15-112 section 4.3"],
    rationale: "Direct gloss and grammatical context."
  };
  const catalog = parseEnglishGrammarCatalog(source);
  const updated = renderEnglishGrammarChineseCharacterLinks(source, [link]);
  const parsed = parseEnglishGrammarCatalog(updated);
  assert.equal(parsed.chineseCharacterLinks.length, 1);
  assert.deepEqual(parsed.chineseCharacterLinks[0].components, ["also_"]);
  assert.equal(renderEnglishGrammarChineseCharacterLinks(updated, [link]), updated);
  assert.equal(catalog.chineseCharacterLinks.length, 0);
});

test("grammar link rendering enforces one-to-one assignments and can remove one run's links", () => {
  const source = grammarCatalogSource();
  const targets = parseEnglishGrammarCharacterTargets(source).targets;
  const and = targets.find((target) => target.english === "and");
  const you = targets.find((target) => target.english === "you");
  const link = (character, target, sourceTag) => ({
    character,
    targetId: target.id,
    pya: target.pya,
    components: target.components,
    english: target.english,
    relation: "base",
    confidence: "high",
    status: "accepted",
    source: sourceTag,
    sources: ["test source"],
    rationale: "Test evidence."
  });

  assert.throws(() => renderEnglishGrammarChineseCharacterLinks(source, [
    link("甲", and, "test"),
    link("乙", and, "test")
  ]), /atom already linked/u);
  assert.throws(() => renderEnglishGrammarChineseCharacterLinks(source, [
    link("甲", and, "test"),
    link("甲", you, "test")
  ]), /character already linked/u);

  const generatedSource = renderEnglishGrammarChineseCharacterLinks(source, [
    link("甲", and, "chinese-character-grammar-refinery"),
    link("乙", you, "human-curated")
  ]);
  const cleanedSource = removeEnglishGrammarChineseCharacterLinks(generatedSource, {
    sourceTag: "chinese-character-grammar-refinery"
  });
  const remaining = parseEnglishGrammarCatalog(cleanedSource).chineseCharacterLinks;
  assert.deepEqual(remaining.map((row) => [row.character, row.pya]), [["乙", you.pya]]);
});
