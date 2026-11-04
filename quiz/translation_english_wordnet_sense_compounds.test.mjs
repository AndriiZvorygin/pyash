import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordNetSenseTranslationPrompt,
  buildSenseDerivedCompoundCandidates,
  buildSenseCompoundChoiceInput,
  parseSenseCompoundChoiceResponse,
  buildSenseDerivedCompoundCandidateFromChoice,
  parseWordNetSenseTranslationResponse,
  parseWordNetSenseTranslationCache,
  renderWordNetSenseTranslationCache,
  senseTranslationKey,
  buildSenseCompoundWorklist,
  buildKwonLinkedAtomicChoices,
  componentGlossAlternatives,
  translateWordNetSenseWave
} from "../program/library/translation/english_wordnet_sense_compounds.mjs";
import {
  buildCompoundVerificationPrompt,
  classifyCompoundCertainty
} from "../program/library/translation/compound_verification.mjs";

const languages = ["chinese", "french", "russian", "hindi"];

test("sense translation prompt is scoped to one definition and comparison-language set", () => {
  const prompt = buildWordNetSenseTranslationPrompt({
    sense: {
      senseId: "n:00000010-n",
      pos: "n",
      lemma: "friendship",
      gloss: "a relationship between friends; their friendship lasted years"
    },
    languages
  });

  assert.match(prompt, /n:00000010-n/u);
  assert.match(prompt, /a relationship between friends/u);
  assert.doesNotMatch(prompt, /their friendship lasted years/u);
  assert.doesNotMatch(prompt, /hfre|hlak|hbad/u);
  assert.match(prompt, /"chinese","french","russian","hindi"/u);
  assert.match(prompt, /Do not split prefixes, suffixes, inflectional endings, or grammatical material/u);
  assert.match(prompt, /A classifier, article, particle/u);
  assert.match(prompt, /compositionEvidence/u);
  assert.match(prompt, /For each part, provide up to three distinct concise English lexical glosses/u);
});

test("component-choice prompt groups glosses and atoms under their source part", () => {
  const atom = (word, sequence, definition, gloss) => ({
    word,
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: [sequence],
    componentLayers: [16],
    mappingKind: "word-suggestion",
    mappingCoverageType: "atomic",
    mappingLookupGloss: gloss,
    mappingLookupSenseEvidence: [{ source: `n:${sequence}`, pos: "n", lemmas: [gloss], definition: `${gloss} meaning` }],
    mappingSuggestedWord: word,
    linkedSense: { source: `n:${sequence}`, pos: "n", lemmas: [word], definition }
  });
  const translations = [{
    language: "chinese",
    surface: "赋予",
    composition: "compound",
    compositionEvidence: "赋 means bestow or assign; 予 means give.",
    components: [
      { surface: "赋", gloss: "bestow/assign", role: "lexical" },
      { surface: "予", gloss: "give", role: "lexical" }
    ]
  }];
  const choices = new Map([
    ["bestow", [atom("donate", "hdon", "give to a charity or good cause", "bestow"), atom("yeah", "dwam", "yes", "bestow")]],
    ["assign", [atom("assigned", "ysad", "designated to a role", "assign"), atom("unspecified", "ysun", "not specified", "assign"), atom("attaching", "ytac", "joining or fastening", "assign"), atom("impose", "ypom", "force something onto", "assign")]],
    ["give", [atom("giving", "kwin", "cause to have, in the abstract or physical sense", "give"), atom("yeah", "dwam", "yes", "give")]]
  ]);
  const sense = { senseId: "v:00120124-v", pos: "v", lemma: "get", gloss: "give certain properties to something" };
  const input = buildSenseCompoundChoiceInput({ sense, translations, kwonCandidatesByGloss: choices });

  assert.match(input.prompt, /limited inventory of existing atoms/u);
  assert.match(input.prompt, /If fewer than two fit, return uncertain with an empty atoms array/u);
  assert.match(input.prompt, /A compound must contain at least two different atoms/u);
  assert.match(input.prompt, /one atom from each of two or three different source parts/u);
  assert.match(input.prompt, /Two atoms from the same source part do not satisfy the minimum/u);
  assert.match(input.prompt, /Pyash compounds are head-final/u);
  assert.match(input.prompt, /last atom is the head/u);
  assert.match(input.prompt, /bird snake.*type of snake/u);
  assert.match(input.prompt, /Snake bird.*type of bird/u);
  assert.match(input.prompt, /"atoms":\["atom1","atom2"\]/u);
  assert.match(input.prompt, /"verdict":"uncertain","atoms":\[\]/u);
  assert.match(input.prompt, /"atoms":\["existing atom word"\]/u);
  assert.match(input.prompt, /each atom's linked meaning/u);
  const optionsStart = input.prompt.indexOf("COMPONENT OPTIONS:\n") + "COMPONENT OPTIONS:\n".length;
  const optionsEnd = input.prompt.indexOf("\nExample:", optionsStart);
  const componentOptions = JSON.parse(input.prompt.slice(optionsStart, optionsEnd));
  assert.deepEqual(componentOptions, [
    {
      source: "赋",
      gloss: "bestow / assign",
      atoms: ["donate", "yeah", "assigned", "unspecified", "attaching", "impose"],
      atomMeanings: {
        donate: "give to a charity or good cause",
        yeah: "yes",
        assigned: "designated to a role",
        unspecified: "not specified",
        attaching: "joining or fastening",
        impose: "force something onto"
      }
    },
    {
      source: "予",
      gloss: "give",
      atoms: ["giving", "yeah"],
      atomMeanings: { giving: "cause to have, in the abstract or physical sense", yeah: "yes" }
    }
  ]);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["donate", "assigned"]
  }), { input }), /distinct parts of one source decomposition/u);
  assert.match(input.prompt, /give to a charity or good cause/u);
  assert.match(input.prompt, /designated to a role/u);
  assert.doesNotMatch(input.prompt, /sourceLanguage|Chinese:|赋 \/ bestow|component choice\]/u);
  assert.doesNotMatch(input.prompt, /v:\d{8}-v|sense-compound-[a-f0-9]{12}/u);
  assert.doesNotMatch(input.prompt, /donate \+ giving|giving \+ donate/u);
  assert.equal(input.responseFormat.oneOf[0].properties.atoms.minItems, 2);
  assert.equal(input.responseFormat.oneOf[1].properties.atoms.maxItems, 0);
});

test("component-choice response resolves only offered atoms and preserves head-final order", () => {
  const atom = (word, sequence, definition, gloss) => ({
    word,
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: [sequence],
    componentLayers: [16],
    mappingKind: "word-suggestion",
    mappingCoverageType: "atomic",
    mappingLookupGloss: gloss,
    mappingLookupSenseEvidence: [{ source: `v:${sequence}`, pos: "v", lemmas: [gloss], definition: `${gloss} meaning` }],
    mappingSuggestedWord: word,
    linkedSense: { source: `v:${sequence}`, pos: "v", lemmas: [word], definition }
  });
  const sense = { senseId: "n:00000010-n", pos: "n", lemma: "friendship", lemmas: ["friendship"], gloss: "a relationship between friends" };
  const translations = [{
    language: "chinese", surface: "朋友关系", composition: "compound", compositionEvidence: "friend plus relationship",
    components: [
      { surface: "朋友", gloss: "friend/companion", role: "lexical" },
      { surface: "关系", gloss: "relationship", role: "lexical" }
    ]
  }];
  const choices = new Map([
    ["friend", [atom("friend", "hfre", "a person attached by affection", "friend")]],
    ["companion", []],
    ["relationship", [
      atom("relationship", "hlak", "a relation between entities", "relationship"),
      atom("friend", "hfre", "a relation between entities", "relationship")
    ]]
  ]);
  const input = buildSenseCompoundChoiceInput({ sense, translations, kwonCandidatesByGloss: choices });
  const selectedResponse = JSON.stringify({
    verdict: "compound",
    atoms: ["friend", "relationship"]
  });
  const parsed = parseSenseCompoundChoiceResponse(`provider note\n${selectedResponse}\ncompletion marker`, { input });
  const providerWrapped = parseSenseCompoundChoiceResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: selectedResponse,
    done: true
  }), { input });
  assert.deepEqual(providerWrapped.selectedComponents.map((component) => component.word), ["friend", "relationship"]);
  const candidate = buildSenseDerivedCompoundCandidateFromChoice({
    sense,
    selectedComponents: parsed.selectedComponents,
    translations,
    candidateRevision: "sense-component-choice-v6",
    rationale: parsed.rationale
  });

  assert.deepEqual(candidate.pyashSequence, ["hfre", "hlak"]);
  assert.deepEqual(candidate.componentGlosses, ["friend", "relationship"]);
  assert.deepEqual(candidate.sourceComponentIndexesByLanguage.chinese, [0, 1]);
  assert.equal(candidate.compositionRationale, "Selected existing atoms: friend + relationship");
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound", atoms: ["invented", "relationship"]
  }), { input }), /not an available atom/u);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["friend"]
  }), { input }), /must select two or three atom words/u);
  assert.throws(() => parseSenseCompoundChoiceResponse("not JSON", { input }), /no bounded JSON object/u);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: "provider response was truncated"
  }), { input }), /wrapped component-choice response has no bounded JSON object/u);
  assert.equal(parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "uncertain",
    atoms: []
  }), { input }).verdict, "uncertain");
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound", atoms: ["friend", "friend"]
  }), { input }), /repeats an atom word/u);
});

test("sense translation response parses bounded noisy JSON and keeps only requested languages", () => {
  const response = parseWordNetSenseTranslationResponse(`provider note\n${JSON.stringify({
    senseId: "n:00000010-n",
    translations: [
      { language: "chinese", surface: "朋友关系", composition: "compound", components: [
        { surface: "朋友", gloss: "friend", role: "lexical" },
        { surface: "关系", gloss: "relationship", role: "lexical" }
      ], compositionEvidence: "friend + relationship means friendship" },
      { language: "french", surface: "amitié", composition: "simple", components: [], compositionEvidence: "single lexical item" }
    ]
  })}`, { senseId: "n:00000010-n", languages: ["chinese", "french"] });

  assert.equal(response.valid, true);
  assert.deepEqual(response.missingLanguages, []);
  assert.equal(response.translations[0].components[1].gloss, "relationship");
  const simpleWithExplanatoryParts = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "一个",
      composition: "simple",
      compositionEvidence: "",
      components: [
        { surface: "一", gloss: "one", role: "lexical" },
        { surface: "个", gloss: "general noun classifier", role: "grammatical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(simpleWithExplanatoryParts.translations[0].composition, "simple");
  assert.deepEqual(simpleWithExplanatoryParts.translations[0].components, []);
  const affixSplit = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "french",
      surface: "découvrir",
      composition: "compound",
      compositionEvidence: "un- + cover means discover",
      components: [
        { surface: "dé-", gloss: "un-", role: "bound" },
        { surface: "-couvrir", gloss: "cover", role: "bound" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["french"] });
  assert.equal(affixSplit.translations[0].composition, "uncertain");
  assert.deepEqual(affixSplit.translations[0].components, []);
  assert.equal(affixSplit.translations[0].compositionEvidence, "decomposition contains a bound-morpheme marker");
  const classifier = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "一个",
      composition: "compound",
      compositionEvidence: "one + classifier expresses a single unit",
      components: [
        { surface: "一", gloss: "one", role: "lexical" },
        { surface: "个", gloss: "classifier", role: "grammatical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(classifier.translations[0].composition, "uncertain");
  assert.deepEqual(classifier.translations[0].components, []);
  assert.match(classifier.translations[0].compositionEvidence, /grammatical, bound, or unverified component/u);
  const unsupportedComposition = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "发现",
      composition: "compound",
      compositionEvidence: "",
      components: [
        { surface: "发", gloss: "send", role: "lexical" },
        { surface: "现", gloss: "appear", role: "lexical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(unsupportedComposition.translations[0].composition, "uncertain");
  assert.deepEqual(unsupportedComposition.translations[0].components, []);
  const wrapped = parseWordNetSenseTranslationResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: JSON.stringify({
      senseId: "n:00000010-n",
      translations: [{ language: "chinese", surface: "朋友关系", composition: "simple", components: [], compositionEvidence: "single lexical item" }]
    }),
    done: true
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(wrapped.translations[0].surface, "朋友关系");
  assert.throws(() => parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [
      { language: "chinese", surface: "甲乙", composition: "compound", components: [
        { surface: "甲", gloss: "a", role: "lexical" }, { surface: "乙", gloss: "b", role: "lexical" }
      ], compositionEvidence: "a + b composes the sense" },
      { language: "chinese", surface: "甲乙", composition: "simple", components: [], compositionEvidence: "single lexical item" }
    ]
  }), { senseId: "n:00000010-n", languages: ["chinese"] }), /duplicate language/u);
});

test("sense translation cache round-trips by stable sense and prompt identity", () => {
  const record = {
    id: senseTranslationKey({
      senseId: "n:00000010-n",
      wordNetHash: "wordnet-hash",
      promptRevision: "sense-translation-v1"
    }),
    senseId: "n:00000010-n",
    wordNetHash: "wordnet-hash",
    promptRevision: "sense-translation-v1",
    status: "complete",
    translations: [{
      language: "chinese",
      surface: "朋友关系",
      composition: "compound",
      components: [
        { surface: "朋友", gloss: "friend" },
        { surface: "关系", gloss: "relationship" }
      ]
    }]
  };
  const parsed = parseWordNetSenseTranslationCache(renderWordNetSenseTranslationCache([record]));

  assert.deepEqual(parsed.records, [record]);
  assert.equal(parsed.bySense.get(record.senseId).id, record.id);
});

test("sense compounds map only linked atom choices and put the WordNet head last", () => {
  const sense = {
    senseId: "n:00000010-n",
    pos: "n",
    lemma: "friendship",
    lemmas: ["friendship"],
    gloss: "a relationship between friends",
    frequencyRank: 1200,
    tagCount: 4
  };
  const linked = {
    friend: [{
      word: "friend",
      coverageType: "atomic",
      pyashSequence: ["hfre"],
      componentLayers: [16],
      linkedSense: { source: "n:00000030-n", pos: "n", lemmas: ["friend"], definition: "a person attached to another by affection" }
    }],
    relationship: [
      {
        word: "relationship",
        coverageType: "atomic",
        pyashSequence: ["hlak"],
        componentLayers: [16],
        linkedSense: { source: "n:00000020-n", pos: "n", lemmas: ["relationship"], definition: "a relation between people" }
      },
      {
        word: "unlinked relation synonym",
        coverageType: "atomic",
        pyashSequence: ["hbad"],
        componentLayers: [16]
      },
      {
        word: "relationship compound",
        coverageType: "compound",
        pyashSequence: ["hfre", "hlak"],
        linkedSense: { source: "n:00000020-n", pos: "n", lemmas: ["relationship"], definition: "a relation between people" }
      },
      {
        word: "relationship duplicate",
        coverageType: "atomic",
        pyashSequence: ["hdu7"],
        status: "deprecated-duplicate",
        linkedSense: { source: "n:00000020-n", pos: "n", lemmas: ["relationship"], definition: "a relation between people" }
      }
    ]
  };
  const candidates = buildSenseDerivedCompoundCandidates({
    sense,
    translations: [
      {
        language: "chinese",
        surface: "朋友关系",
        composition: "compound",
        compositionEvidence: "friend + relationship expresses friendship",
        components: [
          { surface: "朋友", gloss: "friend", role: "lexical" },
          { surface: "关系", gloss: "relationship", role: "lexical" }
        ]
      },
      {
        language: "french",
        surface: "relation amicale",
        composition: "compound",
        compositionEvidence: "friendly + relationship expresses friendship",
        components: [
          { surface: "amicale", gloss: "friend", role: "lexical" },
          { surface: "relation", gloss: "relationship", role: "lexical" }
        ]
      }
    ],
    kwonCandidatesByGloss: new Map(Object.entries(linked)),
    relations: [{ source: "n:00000010-n", target: "n:00000020-n", relation: "hypernym" }]
  });

  assert.equal(candidates.length, 2);
  const relationshipHead = candidates.find((candidate) => candidate.pyashSequence.join(" ") === "hfre hlak");
  const friendHead = candidates.find((candidate) => candidate.pyashSequence.join(" ") === "hlak hfre");
  assert.ok(relationshipHead);
  assert.ok(friendHead);
  assert.deepEqual(relationshipHead.sourceLanguages, ["chinese", "french"]);
  assert.deepEqual(relationshipHead.componentGlosses, ["friend", "relationship"]);
  assert.deepEqual(relationshipHead.sourceComponentGlossesByLanguage, {
    chinese: ["friend", "relationship"],
    french: ["friend", "relationship"]
  });
  assert.deepEqual(relationshipHead.sourceTranslationGlossesByLanguage, {
    chinese: ["friend", "relationship"],
    french: ["friend", "relationship"]
  });
  assert.deepEqual(relationshipHead.sourceComponentIndexesByLanguage, {
    chinese: [0, 1],
    french: [0, 1]
  });
  assert.deepEqual(friendHead.sourceComponentGlossesByLanguage, {
    chinese: ["relationship", "friend"],
    french: ["relationship", "friend"]
  });
  assert.deepEqual(friendHead.sourceTranslationGlossesByLanguage, {
    chinese: ["friend", "relationship"],
    french: ["friend", "relationship"]
  });
  assert.deepEqual(friendHead.sourceComponentIndexesByLanguage, {
    chinese: [1, 0],
    french: [1, 0]
  });
  assert.match(buildCompoundVerificationPrompt({ record: relationshipHead, candidates }), /SOURCE LANGUAGE DECOMPOSITIONS/u);
  assert.equal(relationshipHead.targetSenseEvidence[0].compatibleHeadSenseIds[0], "n:00000020-n");
  assert.equal(relationshipHead.headRelationPolicy, "advisory");
  assert.equal(friendHead.headRelationPolicy, "advisory");
});

test("compound candidates preserve alternate linked senses for the same component atom", () => {
  const candidates = buildSenseDerivedCompoundCandidates({
    sense: {
      senseId: "v:00000050-v",
      pos: "v",
      lemma: "handle",
      lemmas: ["handle"],
      gloss: "take responsibility for"
    },
    translations: [{
      language: "chinese",
      surface: "负责",
      composition: "compound",
      compositionEvidence: "bear + responsibility means be responsible",
      components: [
        { surface: "负", gloss: "bear", role: "lexical" },
        { surface: "责", gloss: "responsibility", role: "lexical" }
      ]
    }],
    kwonCandidatesByGloss: new Map([
      ["bear", [
        {
          word: "bear",
          coverageType: "atomic",
          pyashSequence: ["cyas"],
          componentLayers: [16],
          linkedSense: { source: "n:00000051-n", pos: "n", lemmas: ["bear"], definition: "a large mammal" }
        },
        {
          word: "bear",
          coverageType: "atomic",
          pyashSequence: ["cyas"],
          componentLayers: [16],
          linkedSense: { source: "v:00000052-v", pos: "v", lemmas: ["bear"], definition: "carry or support" }
        }
      ]],
      ["responsibility", [{
        word: "duty",
        coverageType: "atomic",
        pyashSequence: ["hdut"],
        componentLayers: [16],
        linkedSense: { source: "n:00000053-n", pos: "n", lemmas: ["responsibility", "duty"], definition: "a responsibility" }
      }]]
    ])
  });

  const bearHead = candidates.find((candidate) => candidate.pyashSequence.join(" ") === "cyas hdut");
  assert.ok(bearHead);
  assert.deepEqual(
    bearHead.componentSenseEvidence.filter((evidence) => evidence.component === "bear").map((evidence) => evidence.source),
    ["n:00000051-n", "v:00000052-v"]
  );
  assert.deepEqual(bearHead.sourceComponentGlossesByLanguage.chinese, ["bear", "responsibility"]);
});

test("worklist keeps unresolved senses without requiring a POS-matched linked head", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      { source: "n:00000010-n", pos: "n", synset: "00000010-n", lemmas: ["rare target"], gloss: "a rare target", candidates: [{ english30kRank: 3000, tagCount: 1 }] },
      { source: "n:00000011-n", pos: "n", synset: "00000011-n", lemmas: ["common target"], gloss: "a common target", candidates: [{ english30kRank: 20, tagCount: 2 }] },
      { source: "n:00000012-n", pos: "n", synset: "00000012-n", lemmas: ["no head"], gloss: "unrelated meaning" },
      { source: "n:00000020-n", pos: "n", synset: "00000020-n", lemmas: ["already linked"], gloss: "already assigned" }
    ],
    relations: [
      { source: "n:00000010-n", target: "n:00000080-n", relation: "hypernym" },
      { source: "n:00000080-n", target: "n:00000090-n", relation: "hypernym" },
      { source: "n:00000011-n", target: "n:00000090-n", relation: "hypernym" }
    ],
    linkedSenseIds: ["n:00000020-n"],
    linkedAtomicSenses: [
      { source: "n:00000090-n", targetKind: "atom", pyashSequence: ["hfoo"] },
      { source: "n:00000091-n", targetKind: "compound", pyashSequence: ["hfoo", "hbar"] }
    ]
  });

  assert.deepEqual(rows.map((row) => row.senseId), ["n:00000011-n", "n:00000010-n", "n:00000012-n"]);
  assert.equal(rows[0].compatibleHeadSenseIds, undefined);
  assert.equal(rows[0].frequencyRank, 20);
  assert.equal(rows[1].frequencyRank, 3000);
});

test("tag-count worklist prioritizes the strongest unlinked sense and uses rank for ties", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      { source: "n:00000010-n", pos: "n", synset: "00000010-n", lemmas: ["common"], gloss: "common meaning", candidates: [{ english30kRank: 1, tagCount: 1 }] },
      { source: "n:00000011-n", pos: "n", synset: "00000011-n", lemmas: ["highest"], gloss: "highest tagged meaning", candidates: [{ english30kRank: 9000, tagCount: 226 }] },
      { source: "n:00000012-n", pos: "n", synset: "00000012-n", lemmas: ["less tagged"], gloss: "less tagged meaning", candidates: [{ english30kRank: 800, tagCount: 10 }] },
      { source: "n:00000013-n", pos: "n", synset: "00000013-n", lemmas: ["rank tie winner"], gloss: "rank tie winner meaning", candidates: [{ english30kRank: 20, tagCount: 10 }] },
      { source: "n:00000014-n", pos: "n", synset: "00000014-n", lemmas: ["unknown count"], gloss: "unknown tag count", candidates: [{ english30kRank: 2 }] },
      { source: "n:00000015-n", pos: "n", synset: "00000015-n", lemmas: ["linked"], gloss: "already assigned", candidates: [{ english30kRank: 3, tagCount: 999 }] }
    ],
    linkedSenseIds: ["n:00000015-n"],
    order: "tag-count-descending"
  });

  assert.deepEqual(rows.map((row) => row.senseId), [
    "n:00000011-n",
    "n:00000013-n",
    "n:00000012-n",
    "n:00000010-n",
    "n:00000014-n"
  ]);
});

test("tag-count floor keeps only senses with at least the configured count", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      { source: "n:00000030-n", pos: "n", lemmas: ["three"], gloss: "three tags", candidates: [{ rank: 30, tagCount: 3 }] },
      { source: "n:00000020-n", pos: "n", lemmas: ["two"], gloss: "two tags", candidates: [{ rank: 20, tagCount: 2 }] },
      { source: "n:00000010-n", pos: "n", lemmas: ["one"], gloss: "one tag", candidates: [{ rank: 10, tagCount: 1 }] },
      { source: "n:00000000-n", pos: "n", lemmas: ["untagged"], gloss: "no tag count" }
    ],
    order: "tag-count-descending",
    minimumTagCount: 2
  });

  assert.deepEqual(rows.map((row) => [row.senseId, row.tagCount]), [
    ["n:00000030-n", 3],
    ["n:00000020-n", 2]
  ]);
});

test("a linked sense for one part of speech does not suppress a residual sense for another", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      { source: "n:05878677-n", pos: "n", synset: "05878677-n", lemmas: ["one"], gloss: "a single person or thing" },
      { source: "s:02193977-s", pos: "s", synset: "02193977-s", lemmas: ["one"], gloss: "being a single unit" }
    ],
    linkedSenseIds: ["s:02193977-s"],
    linkedAtomicSenses: [
      { source: "s:02193977-s", target: "one", targetKind: "atom", pyashSequence: ["hyik"] }
    ]
  });

  assert.deepEqual(rows.map((row) => row.senseId), ["n:05878677-n"]);
});

test("component gloss alternatives are queried independently", () => {
  assert.deepEqual(componentGlossAlternatives("seat / rank"), ["seat", "rank"]);
  assert.deepEqual(componentGlossAlternatives("chair"), ["chair"]);
  assert.deepEqual(componentGlossAlternatives("un-"), ["un"]);
});

test("compound candidates may use a head sense with a different part of speech and no hypernym edge", () => {
  const candidates = buildSenseDerivedCompoundCandidates({
    sense: {
      senseId: "n:00000040-n",
      pos: "n",
      lemma: "ranking",
      lemmas: ["ranking"],
      gloss: "a position in an ordered scale"
    },
    translations: [{
      language: "chinese",
      surface: "等级",
      composition: "compound",
      compositionEvidence: "equal + rank identifies an ordered position",
      components: [
        { surface: "等", gloss: "equal", role: "lexical" },
        { surface: "级", gloss: "rank", role: "lexical" }
      ]
    }],
    kwonCandidatesByGloss: new Map([
      ["equal", [{
        word: "equal",
        coverageType: "atomic",
        pyashSequence: ["hfoo"],
        componentLayers: [16],
        linkedSense: { source: "a:00000041-a", pos: "a", lemmas: ["equal"], definition: "having the same quantity" }
      }]],
      ["rank", [{
        word: "rank",
        coverageType: "atomic",
        pyashSequence: ["hbar"],
        componentLayers: [16],
        linkedSense: { source: "n:00000042-n", pos: "n", lemmas: ["rank"], definition: "a position in a scale" }
      }]]
    ]),
    relations: []
  });

  assert.equal(candidates.length, 2);
  const adjectiveHead = candidates.find((candidate) => candidate.head === "equal");
  assert.ok(adjectiveHead);
  assert.deepEqual(adjectiveHead.pyashSequence, ["hbar", "hfoo"]);
  assert.equal(adjectiveHead.targetSenseEvidence[0].pos, "n");
  assert.equal(adjectiveHead.componentSenseEvidence.at(-1).pos, "a");
  assert.deepEqual(adjectiveHead.targetSenseEvidence[0].compatibleHeadSenseIds, []);
  assert.equal(adjectiveHead.headRelationPolicy, "advisory");
});

test("Kwon component resolution admits only active linked atomic mappings", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "relation",
      mappings: [
        { word: "relation", coverageType: "atomic", kind: "root", pyacSequence: ["hrel"] },
        { word: "relation compound", coverageType: "compound", kind: "compound", pyacSequence: ["hfoo", "hrel"] },
        { word: "unlinked", coverageType: "atomic", kind: "root", status: "deprecated-duplicate", pyacSequence: ["hunl"] }
      ]
    }],
    activeAtomEntries: [
      { source: "n:00000030-n", target: "relation", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["hrel"], lemmas: ["relation", "obsolete synonym"], definition: "a connection" },
      { source: "n:00000031-n", target: "duplicate", targetPartOfSpeech: "n", targetKind: "atom", status: "deprecated-duplicate", pyashSequence: ["hunl"], lemmas: ["unlinked"], definition: "not active in Kwon" }
    ],
    layerByWord: new Map([["hrel", 16], ["hunl", 16]]),
    deprecatedSurfaces: ["obsolete synonym"]
  });

  assert.deepEqual(mapped.get("relation").map((row) => row.word), ["relation"]);
});

test("unresolved word suggestions cannot override a linked WordNet word sense", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "accord",
      status: "unresolved",
      wordSuggestions: ["accordions"],
      mappings: [{ word: "accordions", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["kfo7n"] }]
    }],
    linkedWordNetSenses: [{
      input: "accord",
      source: "n:06786235-n",
      target: "treaty",
      targetPartOfSpeech: "n",
      lemmas: ["accord", "pact", "treaty"],
      gloss: "a written agreement between two states or sovereigns",
      pyashSequence: ["tyot"]
    }],
    activeAtomEntries: [
      { source: "n:02675461-n", target: "accordions", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["kfo7n"], lemmas: ["accordion", "squeeze box"], definition: "a portable box-shaped free-reed instrument" },
      { source: "n:06786235-n", target: "treaty", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["tyot"], lemmas: ["accord", "pact", "treaty"], definition: "a written agreement between two states or sovereigns" }
    ],
    layerByWord: new Map([["kfo7n", 32], ["tyot", 16]]),
    wordnetIndex: {
      lookup: (word) => word === "accord"
        ? [{ pos: "n", synset: "06786235-n", lemma: "accord", gloss: "a written agreement between two states or sovereigns" }]
        : [],
      bySynset: new Map([["n:06786235-n", [{ lemma: "accord" }, { lemma: "pact" }, { lemma: "treaty" }]]])
    }
  });

  assert.deepEqual(mapped.get("accord").map((row) => [row.word, row.linkedSense.source]), [
    ["treaty", "n:06786235-n"]
  ]);
});

test("WordNet fallback returns at most four linked senses when vocab_suggest has no term", () => {
  const senses = ["seat", "chair", "bench", "throne", "stool", "office"].map((lemma, index) => ({
    pos: "n",
    synset: `0000008${index}-n`,
    lemma: "rank",
    gloss: `rank meaning ${index + 1}`
  }));
  const activeAtomEntries = senses.map((sense, index) => ({
    source: `${sense.pos}:${sense.synset}`,
    target: ["seat", "chair", "bench", "throne", "stool", "office"][index],
    targetPartOfSpeech: "n",
    targetKind: "atom",
    pyashSequence: [`h${index}xx`],
    lemmas: ["rank"],
    definition: sense.gloss
  }));
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [],
    componentGlosses: ["rank"],
    activeAtomEntries,
    layerByWord: new Map(activeAtomEntries.map((entry, index) => [entry.pyashSequence[0], 16 + index])),
    wordnetIndex: {
      lookup: (gloss) => gloss === "rank" ? senses : [],
      bySynset: new Map(senses.map((sense) => [`${sense.pos}:${sense.synset}`, [{ lemma: "rank" }]]))
    }
  });

  assert.deepEqual(mapped.get("rank").map((choice) => [choice.word, choice.mappingKind]), [
    ["seat", "wordnet-synset"],
    ["chair", "wordnet-synset"],
    ["bench", "wordnet-synset"],
    ["throne", "wordnet-synset"]
  ]);
  assert.equal(mapped.get("rank")[0].mappingLookupSenseEvidence[0].source, "n:00000080-n");
});

test("WordNet fallback is skipped when vocab_suggest already supplies a term", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "set",
      wordSuggestions: ["establish"],
      mappings: []
    }],
    componentGlosses: ["set"],
    activeAtomEntries: [{
      source: "v:00000385-v",
      target: "haircut",
      targetPartOfSpeech: "v",
      targetKind: "atom",
      pyashSequence: ["hbraf"],
      lemmas: ["set"],
      definition: "arrange attractively"
    }],
    layerByWord: new Map([["hbraf", 24]]),
    wordnetIndex: {
      lookup: (gloss) => gloss === "set"
        ? [{ pos: "v", synset: "00000385-v", lemma: "set", gloss: "arrange attractively" }]
        : []
    }
  });

  assert.deepEqual(mapped.get("set"), []);
});

test("vocab_suggest candidates exclude unrelated linked WordNet senses", () => {
  const senses = ["hand", "devote"].map((target, index) => ({
    input: "give",
    source: `v:0000000${index}-v`,
    target,
    targetPartOfSpeech: "v",
    gloss: `set sense ${index + 1}`,
    lemmas: [target, "set"],
    pyashSequence: [`h${index}xx`],
    active: true,
    english30kRank: 10 + index
  }));
  const candidates = [
    { word: "giving", source: "v:00000002-v", sequence: "kwin", kind: "lemma", coverageType: "lemma", definition: "cause to have" },
    { word: "yeah", source: "r:00000003-r", sequence: "dwam", kind: "word-suggestion", coverageType: "atomic", definition: "not only so, but" }
  ];
  const activeAtomEntries = [...senses.map((sense) => ({
    source: sense.source,
    target: sense.target,
    targetPartOfSpeech: sense.targetPartOfSpeech,
    targetKind: "atom",
    pyashSequence: sense.pyashSequence,
    lemmas: sense.lemmas,
    definition: sense.gloss
  })), ...candidates.map((candidate) => ({
    source: candidate.source,
    target: candidate.word,
    targetPartOfSpeech: candidate.source[0],
    targetKind: "atom",
    pyashSequence: [candidate.sequence],
    lemmas: [candidate.word],
    definition: candidate.definition
  }))];
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "give",
      status: "covered",
      wordSuggestions: candidates.map((candidate) => candidate.word),
      mappings: candidates.map((candidate) => ({
        word: candidate.word,
        coverageType: candidate.coverageType,
        kind: candidate.kind,
        pyacSequence: [candidate.sequence]
      }))
    }],
    linkedWordNetSenses: senses,
    componentGlosses: ["give"],
    activeAtomEntries,
    layerByWord: new Map(activeAtomEntries.map((entry) => [entry.pyashSequence[0], 16])),
    wordnetIndex: {
      lookup: (gloss) => gloss === "give"
        ? [{ pos: "v", synset: "00000002-v", lemma: "give" }]
        : []
    }
  });

  assert.deepEqual(mapped.get("give").map((choice) => [choice.word, choice.mappingKind]), [
    ["giving", "lemma"],
    ["yeah", "word-suggestion"]
  ]);
});

test("vocab_suggest candidates take precedence over broad WordNet aliases", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "set",
      wordSuggestions: ["firmly"],
      mappings: [{ word: "firmly", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hret"] }]
    }],
    componentGlosses: ["set"],
    activeAtomEntries: [{
      source: "v:00000385-v",
      target: "haircut",
      targetPartOfSpeech: "v",
      targetKind: "atom",
      pyashSequence: ["hbraf"],
      lemmas: ["set"],
      definition: "arrange attractively"
    }, {
      source: "r:00000513-r",
      target: "firmly",
      targetPartOfSpeech: "r",
      targetKind: "atom",
      pyashSequence: ["hret"],
      lemmas: ["firmly"],
      definition: "with resolute determination"
    }],
    layerByWord: new Map([["hbraf", 24], ["hret", 19]]),
    wordnetIndex: {
      lookup: (gloss) => gloss === "set"
        ? [{ pos: "v", synset: "00000385-v", lemma: "set", gloss: "arrange attractively" }]
        : []
    }
  });

  assert.deepEqual(mapped.get("set").map((choice) => [choice.word, choice.mappingKind]), [
    ["firmly", "word-suggestion"]
  ]);
});

test("Kwon component choices rank direct and WordNet-aligned mappings before noisy suggestions", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "like",
      mappings: [
        { word: "how", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hhow"] },
        { word: "love", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hlov"] },
        { word: "distant", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hdst"] },
        { word: "similar", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hsim"] },
        { word: "like", coverageType: "root", kind: "root", pyacSequence: ["hlik"] }
      ]
    }],
    activeAtomEntries: [
      { source: "v:00000101-v", target: "how", targetPartOfSpeech: "v", targetKind: "atom", pyashSequence: ["hhow"], lemmas: ["how"], definition: "talk profusely" },
      { source: "n:00000102-n", target: "love", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["hlov"], lemmas: ["love"], definition: "a strong positive emotion" },
      { source: "a:00000103-a", target: "distant", targetPartOfSpeech: "a", targetKind: "atom", pyashSequence: ["hdst"], lemmas: ["distant"], definition: "far away" },
      { source: "a:00000100-a", target: "similar", targetPartOfSpeech: "a", targetKind: "atom", pyashSequence: ["hsim"], lemmas: ["similar"], definition: "resembling or alike" },
      { source: "a:00000104-a", target: "like", targetPartOfSpeech: "a", targetKind: "atom", pyashSequence: ["hlik"], lemmas: ["like"], definition: "resembling or similar" }
    ],
    layerByWord: new Map([["hhow", 16], ["hlov", 16], ["hdst", 16], ["hsim", 16], ["hlik", 16]]),
    wordnetIndex: {
      lookup: (gloss) => gloss === "like"
        ? [{ pos: "a", synset: "00000100-a", lemma: "like", gloss: "resembling or similar" }]
        : []
    }
  });
  const rankedWords = mapped.get("like").map((row) => row.word);
  assert.equal(rankedWords[0], "like");
  assert.ok(rankedWords.indexOf("similar") < rankedWords.indexOf("how"));
  assert.equal(mapped.get("like")[0].mappingKind, "root");
});

test("word-suggestion candidates retain provenance for sense verification", () => {
  const choices = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "responsibility",
      mappings: [{ word: "duty", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hdut"] }]
    }],
    activeAtomEntries: [{
      source: "n:00000071-n",
      target: "duty",
      targetPartOfSpeech: "n",
      targetKind: "atom",
      pyashSequence: ["hdut"],
      lemmas: ["duty"],
      definition: "a state or condition of being required to do something"
    }],
    layerByWord: new Map([["hdut", 16]])
  });
  const candidates = buildSenseDerivedCompoundCandidates({
    sense: { senseId: "v:00000072-v", pos: "v", lemma: "shoulder", lemmas: ["shoulder"], gloss: "take on a responsibility" },
    translations: [{
      language: "chinese",
      surface: "承担责任",
      composition: "compound",
      compositionEvidence: "undertake + responsibility means assume responsibility",
      components: [
        { surface: "undertake", gloss: "bear", role: "lexical" },
        { surface: "responsibility", gloss: "responsibility", role: "lexical" }
      ]
    }],
    kwonCandidatesByGloss: new Map([
      ["bear", [{ word: "bear", coverageType: "atomic", pyashSequence: ["hbar"], componentLayers: [16], linkedSense: { source: "v:00000073-v", pos: "v", lemmas: ["bear"], definition: "carry or support" } }]],
      ["responsibility", choices.get("responsibility")]
    ])
  });
  const candidate = candidates.find((row) => row.pyashSequence.at(-1) === "hdut");
  assert.ok(candidate);
  assert.equal(classifyCompoundCertainty(candidate).certainty, "llm");
  const evidence = candidate.componentSenseEvidence.find((row) => row.component === "duty");
  assert.equal(evidence.mappingKind, "word-suggestion");
  assert.equal(evidence.mappingLookupGloss, "responsibility");
  assert.equal(evidence.mappingSuggestedWord, "duty");
  const prompt = buildCompoundVerificationPrompt({ record: candidate, candidates: [candidate] });
  assert.match(prompt, /mappingKind":"word-suggestion"/u);
  assert.match(prompt, /mappingLookupGloss":"responsibility"/u);
  assert.match(prompt, /spelling alone is insufficient/u);
});

test("word-suggestion verification receives source WordNet gloss evidence", () => {
  const choices = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "consciousness",
      mappings: [{ word: "unconscious", coverageType: "atomic", kind: "word-suggestion", pyacSequence: ["hunc"] }]
    }],
    activeAtomEntries: [{
      source: "a:00000074-a",
      target: "unconscious",
      targetPartOfSpeech: "a",
      targetKind: "atom",
      pyashSequence: ["hunc"],
      lemmas: ["unconscious"],
      definition: "not conscious"
    }],
    layerByWord: new Map([["hunc", 16]]),
    wordnetIndex: {
      lookup: (gloss) => gloss === "consciousness"
        ? [{ pos: "n", synset: "00000075-n", lemma: "consciousness", gloss: "the state of being conscious" }]
        : []
    }
  });
  const candidates = buildSenseDerivedCompoundCandidates({
    sense: { senseId: "v:00000076-v", pos: "v", lemma: "realise", lemmas: ["realise"], gloss: "become aware of mentally" },
    translations: [{
      language: "chinese",
      surface: "意识到",
      composition: "compound",
      compositionEvidence: "consciousness + reach means become aware",
      components: [
        { surface: "意识", gloss: "consciousness", role: "lexical" },
        { surface: "到", gloss: "reach", role: "lexical" }
      ]
    }],
    kwonCandidatesByGloss: new Map([
      ["consciousness", choices.get("consciousness")],
      ["reach", [{ word: "reach", coverageType: "atomic", pyashSequence: ["hrea"], componentLayers: [16], linkedSense: { source: "v:00000077-v", pos: "v", lemmas: ["reach"], definition: "arrive at a destination" } }]]
    ])
  });
  const candidate = candidates.find((row) => row.componentSenseEvidence.some((evidence) => evidence.component === "unconscious"));
  assert.ok(candidate);
  const prompt = buildCompoundVerificationPrompt({ record: candidate, candidates: [candidate] });
  assert.match(prompt, /sourceGlossEvidence.*the state of being conscious/u);
  assert.match(prompt, /"definition":"not conscious"/u);
  assert.match(prompt, /compare source-gloss meaning and polarity/u);
});

test("component aliases require matching WordNet sense evidence", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "cover",
      mappings: [{ word: "cove", coverageType: "lemma", kind: "lemma", pyacSequence: ["kcav"] }]
    }, {
      input: "result",
      mappings: [{ word: "consequence", coverageType: "dictionary-alias", kind: "dictionary-alias", pyacSequence: ["ksik"] }]
    }],
    activeAtomEntries: [
      { source: "n:00000060-n", target: "cove", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["kcav"], lemmas: ["cove"], definition: "a small inlet" },
      { source: "n:00000061-n", target: "consequence", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["ksik"], lemmas: ["consequence", "result"], definition: "a result" }
    ],
    layerByWord: new Map([["kcav", 16], ["ksik", 16]]),
    wordnetIndex: {
      lookup: (gloss) => gloss === "cover"
        ? [{ pos: "v", synset: "00000062-v", lemma: "cover" }]
        : gloss === "result"
          ? [{ pos: "n", synset: "00000061-n", lemma: "result" }]
          : []
    }
  });

  assert.deepEqual(mapped.get("cover"), []);
  assert.deepEqual(mapped.get("result").map((row) => row.word), ["consequence"]);
});

test("translation wave queues a bounded wave before awaiting and repairs malformed output once", async () => {
  const events = [];
  const senseByHandle = new Map();
  const malformedSent = new Set();
  const senses = ["n:00000010-n", "n:00000011-n"].map((senseId) => ({
    senseId,
    pos: "n",
    lemma: "target",
    gloss: "a target"
  }));
  const result = await translateWordNetSenseWave({
    senses,
    wordNetHash: "source-hash",
    languages: ["chinese", "french"],
    parallelism: 2,
    submit: async ({ sense, handleId, attempt }) => {
      events.push(`submit:${sense.senseId}:${attempt}`);
      senseByHandle.set(`${handleId}-translate-${attempt}`, sense);
      return { status: "queued", handleId: `${handleId}-translate-${attempt}` };
    },
    awaitHandle: async (handleId) => {
      events.push(`await:${handleId}`);
      const sense = senseByHandle.get(handleId);
      if (sense.senseId.endsWith("10-n") && !malformedSent.has(handleId.split("-translate-")[0])) {
        malformedSent.add(handleId.split("-translate-")[0]);
        return "noise without json";
      }
      return JSON.stringify({
        senseId: sense?.senseId ?? "n:00000010-n",
        translations: ["chinese", "french"].map((language) => ({
          language,
          surface: language === "chinese" ? "甲乙" : "alpha beta",
          composition: "compound",
          compositionEvidence: "first + second jointly express the requested sense",
          components: [
            { surface: "甲", gloss: "first", role: "lexical" },
            { surface: "乙", gloss: "second", role: "lexical" }
          ]
        }))
      });
    }
  });

  assert.deepEqual(events.slice(0, 2).map((event) => event.split(":")[0]), ["submit", "submit"]);
  assert.equal(result.submittedCount, 3);
  assert.equal(result.completedCount, 2);
  assert.equal(result.failures.length, 0);
});

test("translation wave submits and awaits concurrently while serializing stable checkpoints", async () => {
  const senses = ["n:00000020-n", "n:00000021-n"].map((senseId) => ({
    senseId,
    pos: "n",
    lemma: "target",
    gloss: "a target"
  }));
  const senseByHandle = new Map();
  const submitBarrier = barrierForTwo();
  const awaitBarrier = barrierForTwo();
  const cacheSnapshots = [];
  let submitActive = 0;
  let maxSubmitActive = 0;
  let awaitActive = 0;
  let maxAwaitActive = 0;
  let cacheActive = 0;
  let maxCacheActive = 0;
  const result = await translateWordNetSenseWave({
    senses,
    wordNetHash: "source-hash",
    languages: ["chinese"],
    parallelism: 2,
    submit: async ({ sense, handleId, attempt }) => {
      submitActive += 1;
      maxSubmitActive = Math.max(maxSubmitActive, submitActive);
      senseByHandle.set(`${handleId}-translate-${attempt}`, sense);
      await submitBarrier.wait();
      submitActive -= 1;
      return { status: "queued" };
    },
    awaitHandle: async (handleId) => {
      awaitActive += 1;
      maxAwaitActive = Math.max(maxAwaitActive, awaitActive);
      await awaitBarrier.wait();
      awaitActive -= 1;
      const sense = senseByHandle.get(handleId);
      return JSON.stringify({
        senseId: sense.senseId,
        translations: [{
          language: "chinese",
          surface: "甲乙",
          composition: "compound",
          compositionEvidence: "first + second jointly express the requested sense",
          components: [
            { surface: "甲", gloss: "first", role: "lexical" },
            { surface: "乙", gloss: "second", role: "lexical" }
          ]
        }]
      });
    },
    onCache: async (records) => {
      cacheActive += 1;
      maxCacheActive = Math.max(maxCacheActive, cacheActive);
      cacheSnapshots.push(records.map((record) => record.senseId));
      await new Promise((resolve) => setTimeout(resolve, 5));
      cacheActive -= 1;
    }
  });

  assert.equal(maxSubmitActive, 2);
  assert.equal(maxAwaitActive, 2);
  assert.equal(maxCacheActive, 1);
  assert.ok(cacheSnapshots.every((ids) => ids.every((id, index) => index === 0 || ids[index - 1].localeCompare(id) <= 0)));
  assert.deepEqual(result.records.map((record) => record.senseId), senses.map((sense) => sense.senseId));
  assert.equal(result.submittedCount, 2);
  assert.equal(result.completedCount, 2);
  assert.deepEqual(result.failures, []);
});

function barrierForTwo() {
  let starts = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return {
    async wait() {
      starts += 1;
      if (starts === 2) release();
      await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 30))]);
    }
  };
}

test("failed sense response keeps bounded evidence and sends sense-id correction on its one retry", async () => {
  const submissions = [];
  const result = await translateWordNetSenseWave({
    senses: [{ senseId: "n:00000044-n", pos: "n", lemma: "friendship", gloss: "a relationship" }],
    wordNetHash: "source-hash",
    languages: ["chinese"],
    submit: async (request) => {
      submissions.push(request);
      return { status: "queued" };
    },
    awaitHandle: async () => JSON.stringify({ senseId: "n:00000045-n", translations: [] })
  });

  assert.equal(result.submittedCount, 2);
  assert.match(submissions[1].repairReason, /n:00000044-n/u);
  assert.match(submissions[1].repairReason, /n:00000045-n/u);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].attempts, 2);
  assert.ok(result.failures[0].response.length <= 2000);
  assert.match(result.failures[0].error, /n:00000045-n/u);
});
