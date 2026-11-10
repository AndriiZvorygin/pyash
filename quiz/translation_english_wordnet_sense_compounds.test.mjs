import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordNetSenseTranslationPrompt,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  buildSenseDerivedCompoundCandidates,
  buildSenseCompoundChoiceInput,
  parseSenseCompoundChoiceResponse,
  buildSenseDerivedCompoundCandidateFromChoice,
  parseWordNetSenseTranslationResponse,
  parseWordNetSenseTranslationResponsePartial,
  parseWordNetSenseTranslationCache,
  renderWordNetSenseTranslationCache,
  mergeWordNetSenseTranslationFailures,
  hasCompositionSourceTranslations,
  senseTranslationKey,
  buildSenseCompoundWorklist,
  buildKwonLinkedAtomicChoices,
  componentGlossAlternatives,
  componentGlossLookupAlternatives,
  mapComponentGlossChoices,
  wordNetLemmaComponentTranslations,
  translateWordNetSenseWave
} from "../program/library/translation/english_wordnet_sense_compounds.mjs";
import {
  buildCompoundVerificationPrompt,
  classifyCompoundCertainty
} from "../program/library/translation/compound_verification.mjs";
import { acceptedDecision } from "../command/wordnet_frequency_compound_sweep.mjs";

const languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES;

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
  assert.match(prompt, /PART OF SPEECH: n/u);
  assert.match(prompt, /SENSE WORD: friendship/u);
  assert.match(prompt, /SENSE LEMMAS: \["friendship"\]/u);
  assert.match(prompt, /Use its definition to preserve this sense; translate the ordinary lexical meaning/u);
  assert.match(prompt, /DEFINITION: a relationship between friends/u);
  assert.match(prompt, /a relationship between friends/u);
  assert.doesNotMatch(prompt, /their friendship lasted years/u);
  assert.doesNotMatch(prompt, /hfre|hlak|hbad/u);
  assert.deepEqual(languages, ["chinese", "hindi", "russian", "german", "japanese", "korean", "finnish"]);
  assert.doesNotMatch(prompt, /"english"/u);
  assert.match(prompt, /"chinese","hindi","russian","german","japanese","korean","finnish"/u);
  assert.match(prompt, /decompose every translation containing two or more Han characters/u);
  assert.match(prompt, /component surfaces must cover every character of the translation surface exactly once/u);
  assert.match(prompt, /smallest meaningful lexical morphemes/u);
  assert.match(prompt, /at least two lexical components jointly express/u);
  assert.doesNotMatch(prompt, /do not need to cover every character/u);
  assert.match(prompt, /Do not insert spaces inside the Chinese translation or component surfaces/u);
  assert.match(prompt, /one best translation surface/u);
  assert.match(prompt, /Chinese multi-character translations cannot be simple or have empty components/u);
  assert.match(prompt, /exactly one translation row and one best translation surface for each requested language/u);
  assert.match(prompt, /at most three entries\. A compound requires at least two lexical components/u);
  assert.match(prompt, /Do not split prefixes, suffixes, inflectional endings, or grammatical material/u);
  assert.match(prompt, /A classifier, article, particle/u);
  assert.match(prompt, /compositionEvidence/u);
  assert.match(prompt, /For each part, provide up to three distinct concise English lexical glosses/u);
});

test("English source compounds come from WordNet lemmas without requesting an English translation", () => {
  const sense = {
    senseId: "n:09263527-n",
    pos: "n",
    lemma: "chain",
    lemmas: ["chain", "chemical chain"],
    gloss: "(chemistry) a series of linked atoms (generally in an organic molecule)"
  };
  const prompt = buildWordNetSenseTranslationPrompt({ sense, languages });

  assert.equal(languages.includes("english"), false);
  assert.doesNotMatch(prompt, /LANGUAGES: \[[^\]]*"english"/u);
  assert.deepEqual(wordNetLemmaComponentTranslations(sense).map(({ surface, components }) => ({
    surface,
    parts: components.map((component) => component.surface)
  })), [{ surface: "chemical chain", parts: ["chemical", "chain"] }]);
});

test("English compound sense translation preserves chemical-chain components", () => {
  const response = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:09263527-n",
    translations: [{
      language: "english",
      surface: "chemical chain",
      composition: "compound",
      compositionEvidence: "chemical specifies the domain and chain is the structural head",
      components: [
        { surface: "chemical", gloss: "chemical", role: "lexical" },
        { surface: "chain", gloss: "chain", role: "lexical" }
      ]
    }]
  }), { senseId: "n:09263527-n", languages: ["english"] });

  assert.equal(response.valid, true);
  assert.deepEqual(response.translations[0].components.map((component) => component.surface), ["chemical", "chain"]);
});

test("a multiword WordNet lemma supplies English compound atoms independently of translated wording", () => {
  const sense = {
    senseId: "n:09263527-n",
    pos: "n",
    lemma: "chain",
    lemmas: ["chain", "chemical chain"],
    definition: "(chemistry) a series of linked atoms (generally in an organic molecule)",
    targetHead: { coverageType: "atomic", word: "series", pyashSequence: ["slis"], componentLayer: 16 }
  };
  const translations = wordNetLemmaComponentTranslations(sense);
  const chemical = {
    word: "chemical",
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: ["ryik"],
    componentLayers: [16],
    linkedSense: { source: "a:02703361-a", pos: "a", lemmas: ["chemical"], definition: "relating to or used in chemistry" }
  };
  const series = {
    word: "chain",
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: ["slis"],
    componentLayers: [16],
    linkedSense: { source: "n:03038685-n", pos: "n", lemmas: ["chain"], definition: "a series of things depending on each other" }
  };
  const input = buildSenseCompoundChoiceInput({
    sense,
    translations,
    kwonCandidatesByGloss: new Map([["chemical", [chemical]], ["chain", [series]]])
  });

  assert.deepEqual(translations.map((translation) => translation.surface), ["chemical chain"]);
  assert.deepEqual(input.sourceOptions.map((option) => [option.word, option.sourcePart]), [["chemical", "chemical"]]);
  const selected = parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["chemical"]
  }), { input });
  const candidate = buildSenseDerivedCompoundCandidateFromChoice({
    sense,
    selectedComponents: selected.selectedComponents,
    translations,
    candidateRevision: "sense-component-choice-v10",
    rationale: selected.rationale
  });
  assert.deepEqual(candidate.pyashSequence, ["ryik", "slis"]);
  assert.deepEqual(candidate.sourceSurfaces, { english: "chemical chain" });
});

test("component-choice prompt offers gloss-linked atoms without binding choices to a translation", () => {
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
  }, {
    language: "hindi",
    surface: "दान देना",
    composition: "compound",
    compositionEvidence: "दान means aid; देना means provide.",
    components: [
      { surface: "दान", gloss: "aid", role: "lexical" },
      { surface: "देना", gloss: "supplied", role: "lexical" }
    ]
  }];
  const choices = new Map([
    ["bestow", [atom("donate", "hdon", "give to a charity or good cause", "bestow"), atom("yeah", "dwam", "yes", "bestow")]],
    ["assign", [atom("assigned", "ysad", "designated to a role", "assign"), atom("unspecified", "ysun", "not specified", "assign"), atom("attaching", "ytac", "joining or fastening", "assign"), atom("impose", "ypom", "force something onto", "assign")]],
    ["give", [atom("giving", "kwin", "cause to have, in the abstract or physical sense", "give"), atom("yeah", "dwam", "yes", "give")]],
    ["aid", [atom("aid", "haid", "help or support", "aid")]],
    ["supplied", [atom("supplied", "hsup", "provided for use", "supplied")]]
  ]);
  const sense = { senseId: "v:00120124-v", pos: "v", lemma: "get", gloss: "give certain properties to something" };
  const input = buildSenseCompoundChoiceInput({ sense, translations, kwonCandidatesByGloss: choices });

  assert.match(input.prompt, /limited inventory of existing atoms/u);
  assert.match(input.prompt, /If fewer than two available atoms fit, return uncertain with an empty atoms array/u);
  assert.match(input.prompt, /Choose exactly two distinct atoms in Pyash head-final order/u);
  assert.match(input.prompt, /Atoms may be combined across gloss groups/u);
  assert.doesNotMatch(input.prompt, /single translation|same source part|TRANSLATION COMPONENT OPTIONS/u);
  assert.match(input.prompt, /Pyash compounds are head-final/u);
  assert.match(input.prompt, /final atom is the semantic head/u);
  assert.doesNotMatch(input.prompt, /all atoms from a single object/u);
  assert.match(input.prompt, /bird snake.*type of snake/u);
  assert.match(input.prompt, /Snake bird.*type of bird/u);
  assert.match(input.prompt, /"atoms":\["atom1","atom2"\]/u);
  assert.match(input.prompt, /"verdict":"uncertain","atoms":\[\]/u);
  assert.match(input.prompt, /"atoms":\["atom word"\]/u);
  assert.match(input.prompt, /their linked meanings/u);
  const optionsStart = input.prompt.indexOf("AVAILABLE ATOM OPTIONS:\n") + "AVAILABLE ATOM OPTIONS:\n".length;
  const optionsEnd = input.prompt.indexOf("\nExample:", optionsStart);
  const componentOptions = JSON.parse(input.prompt.slice(optionsStart, optionsEnd));
  assert.deepEqual(componentOptions, [
    { gloss: "bestow", atoms: ["donate", "yeah"], atomMeanings: { donate: "give to a charity or good cause", yeah: "yes" } },
    { gloss: "assign", atoms: ["assigned", "unspecified", "attaching", "impose"], atomMeanings: {
      assigned: "designated to a role", unspecified: "not specified", attaching: "joining or fastening", impose: "force something onto"
    } },
    { gloss: "give", atoms: ["giving", "yeah"], atomMeanings: { giving: "cause to have, in the abstract or physical sense", yeah: "yes" } },
    { gloss: "aid", atoms: ["aid"], atomMeanings: { aid: "help or support" } },
    { gloss: "supplied", atoms: ["supplied"], atomMeanings: { supplied: "provided for use" } }
  ]);
  assert.match(input.prompt, /give to a charity or good cause/u);
  assert.match(input.prompt, /designated to a role/u);
  assert.doesNotMatch(input.prompt, /sourceLanguage|source language|translation|Chinese:|赋 \/ bestow|component choice\]/u);
  assert.doesNotMatch(input.prompt, /v:\d{8}-v|sense-compound-[a-f0-9]{12}/u);
  assert.equal(input.responseFormat.oneOf[0].properties.atoms.minItems, 2);
  assert.equal(input.responseFormat.oneOf[0].properties.atoms.maxItems, 2);
  assert.equal(input.responseFormat.oneOf[0].properties.translation, undefined);
  assert.equal(input.responseFormat.oneOf[1].properties.atoms.maxItems, 0);

  const parsed = parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["donate", "aid"]
  }), { input });
  const onePartInput = buildSenseCompoundChoiceInput({
    sense,
    translations: [translations[0]],
    kwonCandidatesByGloss: new Map([
      ["bestow", choices.get("bestow")],
      ["assign", choices.get("assign")]
    ])
  });
  assert.ok(onePartInput);
  const sameSourcePart = parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["donate", "assigned"]
  }), { input: onePartInput });
  assert.deepEqual(sameSourcePart.selectedComponents.map((component) => component.sourcePart), ["赋", "赋"]);
  const samePartCandidate = buildSenseDerivedCompoundCandidateFromChoice({
    sense,
    selectedComponents: sameSourcePart.selectedComponents,
    translations: [translations[0]],
    candidateRevision: "sense-component-choice-v10",
    rationale: sameSourcePart.rationale
  });
  assert.deepEqual(samePartCandidate.sourceComponentIndexesByLanguage.chinese, [0, 0]);
  assert.equal(buildSenseCompoundChoiceInput({
    sense,
    translations: [translations[0]],
    kwonCandidatesByGloss: new Map([["bestow", choices.get("bestow").slice(0, 1)]])
  }), null);
  const candidate = buildSenseDerivedCompoundCandidateFromChoice({
    sense,
    selectedComponents: parsed.selectedComponents,
    translations,
    candidateRevision: "sense-component-choice-v10",
    rationale: parsed.rationale
  });
  assert.deepEqual(candidate.componentGlosses, ["donate", "aid"]);
  assert.deepEqual(candidate.sourceLanguages, ["chinese", "hindi"]);
  assert.deepEqual(candidate.sourceMorphemesByLanguage, { chinese: ["赋"], hindi: ["दान"] });
  assert.deepEqual(candidate.sourceCandidateComponentIndexesByLanguage, { chinese: [0], hindi: [1] });
  const verificationPrompt = buildCompoundVerificationPrompt({ record: candidate });
  assert.ok(verificationPrompt.includes('"pyashComponents":[{"word":"donate"'));
  assert.ok(verificationPrompt.includes('"word":"aid"'));
  assert.ok(verificationPrompt.includes('"sourceComponentIndexes":{"chinese":[0,null],"hindi":[null,0]}'));
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    translation: "irrelevant",
    atoms: ["donate", "aid"]
  }), { input }), /only verdict and an atoms array/u);
});

test("component-choice prompt trims lower-priority options to its safe budget and keeps the response schema aligned", () => {
  const atom = (word, definition, index) => ({
    word,
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: [`w${index}`],
    componentLayers: [16],
    linkedSense: { source: `n:${String(index).padStart(8, "0")}-n`, pos: "n", lemmas: [word], definition }
  });
  const translations = [];
  const choices = new Map();
  let index = 1;
  for (let group = 0; group < 48; group += 1) {
    const gloss = `component gloss ${group}`;
    translations.push({
      language: `language-${group}`,
      surface: `surface ${group}`,
      composition: "compound",
      components: [
        { surface: `part ${group}`, gloss, role: "lexical" },
        { surface: `head ${group}`, gloss: `head gloss ${group}`, role: "lexical" }
      ]
    });
    const longMeaning = `${"linked atom meaning ".repeat(12)}${group}`;
    choices.set(gloss, Array.from({ length: 4 }, (_, choice) => atom(`atom-${group}-${choice}`, longMeaning, index++)));
    choices.set(`head gloss ${group}`, [atom(`head-atom-${group}`, longMeaning, index++)]);
  }
  const input = buildSenseCompoundChoiceInput({
    sense: { senseId: "n:00000010-n", pos: "n", lemma: "target", gloss: "a target meaning" },
    translations,
    kwonCandidatesByGloss: choices
  });

  assert.ok(input);
  assert.ok(input.prompt.length <= 8000);
  assert.equal(input.promptTruncated, true);
  assert.ok(input.omittedOptionCount > 0);
  const optionsStart = input.prompt.indexOf("AVAILABLE ATOM OPTIONS:\n") + "AVAILABLE ATOM OPTIONS:\n".length;
  const displayedGroupEnds = [input.prompt.indexOf("\nLower-priority", optionsStart), input.prompt.indexOf("\nExample:", optionsStart)]
    .filter((offset) => offset >= 0);
  const displayedGroups = JSON.parse(input.prompt.slice(optionsStart, Math.min(...displayedGroupEnds)));
  const displayedWords = [...new Set(displayedGroups.flatMap((group) => group.atoms))].sort();
  assert.deepEqual(input.responseFormat.oneOf[0].properties.atoms.items.enum.slice().sort(), displayedWords);
  assert.deepEqual([...new Set(input.sourceOptions.map((option) => option.word))].sort(), displayedWords);
  assert.doesNotMatch(input.prompt, /atom-47-3/u);
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
    ["friend", [
      atom("friend", "hfre", "a person attached by affection", "friend"),
      atom("affection", "haff", "a feeling of fondness", "friend")
    ]],
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
  assert.deepEqual(candidate.sourceCandidateComponentIndexesByLanguage.chinese, [0, 1]);
  assert.equal(candidate.compositionRationale, "Selected existing atoms: friend + relationship");
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound", atoms: ["invented", "relationship"]
  }), { input }), /not an available atom/u);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["friend"]
  }), { input }), /must select exactly two atom words/u);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["friend", "relationship", "affection"]
  }), { input }), /must select exactly two atom words/u);
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

test("an existing lexical target stays the mandatory head of a new sense compound", () => {
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
  const sense = {
    senseId: "a:00000020-a",
    pos: "a",
    lemma: "better",
    lemmas: ["better"],
    definition: "changed for the better in health or fitness",
    targetHead: {
      coverageType: "atomic",
      word: "better",
      pyashSequence: ["pcac"],
      componentLayer: 16
    }
  };
  const translations = [{
    language: "chinese",
    surface: "好转",
    composition: "compound",
    compositionEvidence: "health plus change expresses improvement",
    components: [
      { surface: "好", gloss: "good/healthy", role: "lexical" },
      { surface: "转", gloss: "turn/change", role: "lexical" }
    ]
  }];
  const choices = new Map([
    ["healthy", [atom("health", "hhea", "a healthy state", "healthy")]],
    ["good", [atom("health", "hhea", "a healthy state", "good")]],
    ["change", [
      atom("change", "hcha", "the act of changing", "change"),
      atom("better", "pcac", "of superior quality", "change")
    ]],
    ["turn", [atom("change", "hcha", "the act of changing", "turn")]]
  ]);
  const input = buildSenseCompoundChoiceInput({ sense, translations, kwonCandidatesByGloss: choices });

  assert.match(input.prompt, /existing lexical head better \(pcac\)/u);
  assert.match(input.prompt, /Choose one distinct modifier atom/u);
  assert.match(input.prompt, /Keep that exact word as the final atom/u);
  assert.equal(input.sourceOptions.some((option) => option.pyashSequence[0] === "pcac"), false);
  assert.equal(input.responseFormat.oneOf[0].properties.atoms.minItems, 1);
  assert.equal(input.responseFormat.oneOf[0].properties.atoms.maxItems, 1);

  const parsed = parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["health"]
  }), { input });
  const candidate = buildSenseDerivedCompoundCandidateFromChoice({
    sense,
    selectedComponents: parsed.selectedComponents,
    translations,
    candidateRevision: "sense-component-choice-v7",
    rationale: parsed.rationale
  });

  assert.deepEqual(candidate.pyashSequence, ["hhea", "pcac"]);
  assert.deepEqual(candidate.componentGlosses, ["health", "better"]);
  assert.equal(candidate.head, "better");
  assert.deepEqual(candidate.modifiers, ["health"]);
  assert.equal(candidate.targetHeadEvidence.word, "better");
  assert.equal(acceptedDecision({ ...candidate, status: "accepted-llm" }), true);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["better"]
  }), { input }), /not an available atom/u);
});

test("a known two-word compound head removes same-POS modifiers already in use", () => {
  const atom = (word, sequence, definition, gloss) => ({
    word,
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: [sequence],
    componentLayers: [16],
    linkedSense: { source: `n:${sequence}`, pos: "n", lemmas: [word], definition },
    mappingLookupGloss: gloss,
    mappingSuggestedWord: word
  });
  const sense = {
    senseId: "a:00000023-a",
    pos: "a",
    lemma: "better",
    definition: "improved in quality",
    targetHead: { coverageType: "atomic", word: "better", pyashSequence: ["pcac"], componentLayer: 16 }
  };
  const translations = [{
    language: "english",
    surface: "healthy improvement",
    composition: "compound",
    components: [
      { surface: "healthy", gloss: "healthy", role: "lexical" },
      { surface: "improvement", gloss: "improvement", role: "lexical" }
    ]
  }];
  const choices = new Map([
    ["healthy", [atom("health", "hhea", "a state of health", "healthy")]],
    ["improvement", [atom("change", "hcha", "an improvement or change", "improvement")]]
  ]);

  const samePosConflict = buildSenseCompoundChoiceInput({
    sense,
    translations,
    kwonCandidatesByGloss: choices,
    reservedTargetIds: new Set(["compound:hhea+pcac:a"])
  });
  assert.deepEqual(samePosConflict.sourceOptions.map((option) => option.word), ["change"]);
  assert.doesNotMatch(samePosConflict.prompt, /health/u);
  assert.deepEqual(samePosConflict.responseFormat.oneOf[0].properties.atoms.items.enum, ["change"]);
  assert.throws(() => parseSenseCompoundChoiceResponse(JSON.stringify({
    verdict: "compound",
    atoms: ["health"]
  }), { input: samePosConflict }), /not an available atom/u);

  const otherPosOnly = buildSenseCompoundChoiceInput({
    sense,
    translations,
    kwonCandidatesByGloss: choices,
    reservedTargetIds: ["compound:hhea+pcac:v"]
  });
  assert.deepEqual(otherPosOnly.sourceOptions.map((option) => option.word), ["health", "change"]);
});

test("one unmapped source part does not hide another eligible modifier for an existing head", () => {
  const change = {
    word: "change",
    coverageType: "atomic",
    status: "active-linked-atom",
    pyashSequence: ["hcha"],
    componentLayers: [16],
    mappingKind: "word-suggestion",
    mappingCoverageType: "atomic",
    mappingLookupGloss: "change",
    mappingLookupSenseEvidence: [{ source: "v:00000001-v", pos: "v", lemmas: ["change"], definition: "change meaning" }],
    linkedSense: { source: "v:00000001-v", pos: "v", lemmas: ["change"], definition: "make different" }
  };
  const translations = [{
    language: "chinese",
    surface: "合适",
    composition: "compound",
    components: [
      { surface: "合", gloss: "correspond", role: "lexical" },
      { surface: "适", gloss: "change", role: "lexical" }
    ]
  }];
  const sense = {
    senseId: "a:00000021-a",
    pos: "a",
    lemma: "better",
    definition: "changed for the better",
    targetHead: { coverageType: "atomic", word: "better", pyashSequence: ["pcac"], componentLayer: 16 }
  };
  const input = buildSenseCompoundChoiceInput({
    sense,
    translations,
    kwonCandidatesByGloss: new Map([["change", [change]]])
  });

  assert.ok(input);
  assert.deepEqual(input.sourceOptions.map((option) => [option.sourcePart, option.word]), [["适", "change"]]);
  assert.equal(buildSenseCompoundChoiceInput({
    sense: { senseId: "n:00000022-n", pos: "n", lemma: "change", definition: "a change" },
    translations,
    kwonCandidatesByGloss: new Map([["change", [change]]])
  }), null);
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
  assert.throws(() => parseWordNetSenseTranslationResponse(JSON.stringify({
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
  }), { senseId: "n:00000010-n", languages: ["chinese"] }), /must be decomposed/u);
  const twoCharacterDecomposition = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "思考",
      composition: "compound",
      compositionEvidence: "思 contributes thought and 考 contributes consideration.",
      components: [
        { surface: "思", gloss: "think; thought", role: "lexical" },
        { surface: "考", gloss: "consider; examine", role: "lexical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.deepEqual(twoCharacterDecomposition.translations[0].components.map(({ surface }) => surface), ["思", "考"]);
  assert.throws(() => parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "综 合 征",
      composition: "compound",
      compositionEvidence: "general pattern plus sign expresses a syndrome",
      components: [
        { surface: "综", gloss: "general pattern", role: "lexical" },
        { surface: "征", gloss: "sign", role: "lexical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] }), /cover every character/u);

  const cartridgeDecomposition = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:02975150-n",
    translations: [{
      language: "chinese",
      surface: "子弹壳",
      composition: "compound",
      compositionEvidence: "子弹 is bullet and 壳 is casing or shell.",
      components: [
        { surface: "子弹", gloss: "bullet", role: "lexical" },
        { surface: "壳", gloss: "casing; shell", role: "lexical" }
      ]
    }]
  }), { senseId: "n:02975150-n", languages: ["chinese"] });
  assert.equal(cartridgeDecomposition.translations[0].composition, "compound");
  assert.deepEqual(cartridgeDecomposition.translations[0].components.map(({ surface }) => surface), ["子弹", "壳"]);

  const lexicalCompoundWithGrammar = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "a:00951310-a",
    translations: [{
      language: "chinese",
      surface: "外部的",
      composition: "compound",
      compositionEvidence: "外 means outside and 部 means part; 的 marks adjectival form.",
      components: [
        { surface: "外", gloss: "outside", role: "lexical" },
        { surface: "部", gloss: "part", role: "lexical" },
        { surface: "的", gloss: "adjectival marker", role: "grammatical" }
      ]
    }]
  }), { senseId: "a:00951310-a", languages: ["chinese"] });
  assert.equal(lexicalCompoundWithGrammar.translations[0].composition, "compound");
  assert.deepEqual(lexicalCompoundWithGrammar.translations[0].components.map(({ surface }) => surface), ["外", "部", "的"]);

  const whitespaceChinese = parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [{
      language: "chinese",
      surface: "纸 皮 书",
      composition: "compound",
      compositionEvidence: "paper cover plus book",
      components: [
        { surface: "纸 ", gloss: "paper", role: "lexical" },
        { surface: "皮", gloss: "cover", role: "lexical" },
        { surface: "书", gloss: "book", role: "lexical" }
      ]
    }]
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(whitespaceChinese.translations[0].composition, "compound");
  assert.equal(whitespaceChinese.translations[0].surface, "纸皮书");
  assert.deepEqual(whitespaceChinese.translations[0].components.map(({ surface }) => surface), ["纸", "皮", "书"]);
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
  assert.deepEqual(affixSplit.translations[0].components.map(({ surface }) => surface), ["dé-", "-couvrir"]);
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
  assert.deepEqual(classifier.translations[0].components.map(({ surface }) => surface), ["一", "个"]);
  assert.match(classifier.translations[0].compositionEvidence, /at least two lexical components/u);
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
  assert.deepEqual(unsupportedComposition.translations[0].components.map(({ surface }) => surface), ["发", "现"]);
  assert.throws(() => parseWordNetSenseTranslationResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: JSON.stringify({
      senseId: "n:00000010-n",
      translations: [{ language: "chinese", surface: "朋友关系", composition: "simple", components: [], compositionEvidence: "single lexical item" }]
    }),
    done: true
  }), { senseId: "n:00000010-n", languages: ["chinese"] }), /must be decomposed/u);
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

test("partial sense parsing keeps valid languages and isolates malformed rows", () => {
  const result = parseWordNetSenseTranslationResponsePartial(JSON.stringify({
    senseId: "n:00000070-n",
    translations: [
      {
        language: "chinese",
        surface: "朋友关系",
        composition: "compound",
        compositionEvidence: "friend + relationship",
        components: [
          { surface: "朋友", gloss: "friend", role: "lexical" },
          { surface: "关系", gloss: "relationship", role: "lexical" }
        ]
      },
      {
        language: "hindi",
        surface: "मुद्दा",
        composition: "uncertain",
        compositionEvidence: "possible single lexical item",
        components: [{ surface: "मुद्दा", gloss: "matter", role: "lexical" }]
      },
      {
        language: "french",
        surface: "amitié",
        composition: "simple",
        compositionEvidence: "single lexical item",
        components: []
      }
    ]
  }), { senseId: "n:00000070-n", languages: ["chinese", "hindi", "french"] });

  assert.deepEqual(result.translations.map((row) => row.language), ["chinese", "french"]);
  assert.deepEqual(result.failures.map(({ language, error }) => [language, error]), [
    ["hindi", "uncertain translation decomposition must be empty or contain two or three parts"]
  ]);
});

test("partial sense parsing invalidates only a duplicated language", () => {
  const result = parseWordNetSenseTranslationResponsePartial(JSON.stringify({
    senseId: "n:00000071-n",
    translations: [
      { language: "chinese", surface: "朋友关系", composition: "compound", compositionEvidence: "friend + relationship", components: [
        { surface: "朋友", gloss: "friend", role: "lexical" }, { surface: "关系", gloss: "relationship", role: "lexical" }
      ] },
      { language: "french", surface: "amitié", composition: "simple", compositionEvidence: "single lexical item", components: [] },
      { language: "french", surface: "amour amical", composition: "simple", compositionEvidence: "alternate wording", components: [] }
    ]
  }), { senseId: "n:00000071-n", languages: ["chinese", "french"] });

  assert.deepEqual(result.translations.map((row) => row.language), ["chinese"]);
  assert.deepEqual(result.failures.map(({ language, error }) => [language, error]), [
    ["french", "sense translation response contains a duplicate language"]
  ]);
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

test("English-rank queue includes only Princeton-intersection synsets and ranks every lemma", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      {
        source: "n:00000031-n",
        pos: "n",
        lemmas: ["uncommon alias", "common alias"],
        gloss: "a Princeton-matched zero-tag sense",
        tagCount: 0,
        princetonMatched: true
      },
      {
        source: "n:00000032-n",
        pos: "n",
        lemmas: ["less common"],
        gloss: "another Princeton-matched zero-tag sense",
        tagCount: 0,
        princetonMatched: true
      },
      {
        source: "n:00000033-n",
        pos: "n",
        lemmas: ["one tagged"],
        gloss: "a Princeton-matched sense with one tag",
        tagCount: 1,
        princetonMatched: true
      },
      {
        source: "n:00000035-n",
        pos: "n",
        lemmas: ["matched but key changed"],
        gloss: "a synset in both resources with no exact lexical-key count",
        princetonMatched: true
      },
      {
        source: "n:00000034-n",
        pos: "n",
        lemmas: ["not in Princeton"],
        gloss: "a WordNet-only sense"
      }
    ],
    rankForEnglish: (lemma) => ({
      "common alias": 12,
      "uncommon alias": 400,
      "less common": 45,
      "one tagged": 90,
      "matched but key changed": 70,
      "not in Princeton": 1
    }[lemma] ?? Number.POSITIVE_INFINITY),
    order: "english30k-rank",
    minimumTagCount: 0,
    requirePrincetonIntersection: true
  });

  assert.deepEqual(rows.map(({ senseId, frequencyRank, tagCount }) => [senseId, frequencyRank, tagCount]), [
    ["n:00000031-n", 12, 0],
    ["n:00000032-n", 45, 0],
    ["n:00000035-n", 70, -1],
    ["n:00000033-n", 90, 1]
  ]);
});

test("compound worklist keeps existing lexical heads, and excludes grammar-covered targets", () => {
  const rows = buildSenseCompoundWorklist({
    residualSenses: [
      { source: "a:00000021-a", pos: "a", lemmas: ["better"], gloss: "changed for the better" },
      { source: "r:00000022-r", pos: "r", lemmas: ["more"], gloss: "comparative degree" },
      { source: "r:00000026-r", pos: "r", lemmas: ["most"], gloss: "superlative degree" },
      { source: "n:00000024-n", pos: "n", lemmas: ["compound target"], gloss: "already covered by an accepted compound" },
      { source: "a:00000025-a", pos: "a", lemmas: ["improved"], gloss: "of better quality" },
      { source: "a:00000023-a", pos: "a", lemmas: ["novel"], gloss: "new and original" }
    ],
    resolveTargetCoverage: (sense) => {
      if (sense.lemmas[0] === "better") return {
        coverageType: "atomic",
        canonicalEnglish: "better",
        pyashSequence: ["pcac"],
        componentLayer: 16
      };
      if (sense.lemmas[0] === "more") return {
        coverageType: "dictionary-alias",
        canonicalCoverageType: "grammar",
        canonicalEnglish: "comparative_degree_",
        pyashSequence: ["trah"]
      };
      if (sense.lemmas[0] === "most") return {
        coverageType: "grammar",
        canonicalEnglish: "superlative_degree_",
        pyashSequence: ["pluh"]
      };
      if (sense.lemmas[0] === "compound target") return {
        coverageType: "compound",
        canonicalEnglish: "compound target",
        pyashSequence: ["hmod", "hhea"]
      };
      if (sense.lemmas[0] === "improved") return {
        coverageType: "dictionary-alias",
        canonicalCoverageType: "atomic",
        canonicalEnglish: "better",
        pyashSequence: ["pcac"],
        componentLayer: 16
      };
      return null;
    }
  });

  assert.deepEqual(rows.map((row) => row.senseId), ["a:00000021-a", "a:00000023-a", "a:00000025-a"]);
  assert.deepEqual(rows[0].targetHead, {
    coverageType: "atomic",
    word: "better",
    pyashSequence: ["pcac"],
    componentLayer: 16
  });
  assert.equal(rows[1].targetHead, undefined);
  assert.deepEqual(rows[2].targetHead, {
    coverageType: "atomic",
    word: "better",
    pyashSequence: ["pcac"],
    componentLayer: 16
  });
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
  assert.deepEqual(componentGlossAlternatives("position|place"), ["position", "place"]);
  assert.deepEqual(componentGlossAlternatives("chair"), ["chair"]);
  assert.deepEqual(componentGlossAlternatives("un-"), ["un"]);
  assert.deepEqual(componentGlossLookupAlternatives("to obtain / to get"), ["obtain", "get"]);
  assert.deepEqual(componentGlossLookupAlternatives("dwelling unit/building structure"), [
    "dwelling unit", "dwelling", "unit", "building structure", "building", "structure"
  ]);
  assert.deepEqual(componentGlossLookupAlternatives("to obtain something"), [
    "to obtain something", "obtain", "something"
  ]);
});

test("pipe alternatives and phrase words resolve to their Kwon atom choices", () => {
  const place = {
    input: "place",
    status: "covered",
    mappings: [{ word: "place", coverageType: "atomic", kind: "root", pyacSequence: ["tcas"] }]
  };
  const building = {
    input: "building",
    status: "covered",
    mappings: [{ word: "building", coverageType: "atomic", kind: "root", pyacSequence: ["plit"] }]
  };
  const activeAtomEntries = [
    { source: "n:08682181-n", target: "place", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["tcas"], lemmas: ["place"], definition: "a point located with respect to surface features" },
    { source: "n:00000091-n", target: "building", targetPartOfSpeech: "n", targetKind: "atom", pyashSequence: ["plit"], lemmas: ["building"], definition: "a structure with a roof and walls" }
  ];
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [place, building],
    componentGlosses: ["position|place", "dwelling unit/building structure"],
    activeAtomEntries,
    layerByWord: new Map([["tcas", 16], ["plit", 16]])
  });
  const byGloss = mapComponentGlossChoices(
    ["position|place", "dwelling unit/building structure"],
    mapped
  );

  assert.deepEqual(byGloss.get("position|place").map((choice) => choice.word), ["place"]);
  assert.deepEqual(byGloss.get("dwelling unit/building structure").map((choice) => choice.word), ["building"]);
});

test("infinitive component glosses map selected atom choices back to their original words", () => {
  const obtain = {
    word: "obtain",
    pyashSequence: ["hobt"],
    linkedSense: { source: "v:00000043-v", pos: "v", lemmas: ["obtain"], definition: "come to have" }
  };
  const get = {
    word: "get",
    pyashSequence: ["hget"],
    linkedSense: { source: "v:00000044-v", pos: "v", lemmas: ["get"], definition: "come into possession" }
  };
  const byGloss = mapComponentGlossChoices(
    ["to obtain / to get"],
    new Map([["obtain", [obtain]], ["get", [get]]])
  );

  assert.deepEqual(byGloss.get("to obtain"), [obtain]);
  assert.deepEqual(byGloss.get("to get"), [get]);
  assert.deepEqual(byGloss.get("to obtain / to get"), [obtain, get]);
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

test("translation wave adds newly selected languages without retranslating compatible cached languages", async () => {
  const sense = {
    senseId: "n:09263527-n",
    pos: "n",
    lemma: "chain",
    lemmas: ["chain", "chemical chain"],
    gloss: "(chemistry) a series of linked atoms"
  };
  const priorLanguages = ["chinese", "french", "russian", "hindi"];
  const priorPromptRevision = "sense-translation-gloss-alternatives-v7";
  const cachedRecords = [{
    id: senseTranslationKey({
      senseId: sense.senseId,
      wordNetHash: "source-hash",
      promptRevision: priorPromptRevision,
      languages: priorLanguages
    }),
    senseId: sense.senseId,
    wordNetHash: "source-hash",
    promptRevision: priorPromptRevision,
    languages: priorLanguages,
    status: "complete",
    translations: priorLanguages.map((language) => ({
      language,
      surface: language,
      composition: "simple",
      compositionEvidence: "saved translation",
      components: []
    }))
  }];
  let requestedLanguages = [];
  const result = await translateWordNetSenseWave({
    senses: [sense],
    cachedRecords,
    wordNetHash: "source-hash",
    languages,
    promptRevision: "sense-translation-gloss-alternatives-v9",
    submit: async ({ languages: requested }) => {
      requestedLanguages = requested;
      return { status: "queued", handleId: "english-only-translation" };
    },
    awaitHandle: async () => JSON.stringify({
      senseId: sense.senseId,
      translations: requestedLanguages.map((language) => ({
        language,
        surface: `${language} chain`,
        composition: "simple",
        compositionEvidence: "single lexical expression",
        components: []
      }))
    })
  });

  assert.deepEqual(requestedLanguages, ["german", "japanese", "korean", "finnish"]);
  assert.equal(result.submittedCount, 1);
  assert.equal(result.records[0].status, "complete");
  assert.deepEqual(result.records[0].languages, languages);
  assert.deepEqual(result.records[0].translationPromptRevisionByLanguage, {
    chinese: priorPromptRevision,
    french: priorPromptRevision,
    russian: priorPromptRevision,
    hindi: priorPromptRevision,
    german: "sense-translation-gloss-alternatives-v9",
    japanese: "sense-translation-gloss-alternatives-v9",
    korean: "sense-translation-gloss-alternatives-v9",
    finnish: "sense-translation-gloss-alternatives-v9"
  });
});

test("translation wave caches valid languages and retries only invalid languages", async () => {
  const sense = { senseId: "n:00000072-n", pos: "n", lemma: "friendship", gloss: "a relationship between friends" };
  const requests = [];
  const failureEvents = [];
  const cacheSnapshots = [];
  const languageByHandle = new Map();
  const result = await translateWordNetSenseWave({
    senses: [sense],
    wordNetHash: "source-hash",
    languages: ["chinese", "hindi"],
    submit: async ({ handleId, attempt, languages: requested }) => {
      requests.push({ attempt, languages: [...requested] });
      languageByHandle.set(`${handleId}-translate-${attempt}`, requested);
      return { status: "queued" };
    },
    awaitHandle: async (handleId) => {
      const requested = languageByHandle.get(handleId);
      if (requested.includes("chinese")) {
        return JSON.stringify({
          senseId: sense.senseId,
          translations: [
            {
              language: "chinese", surface: "朋友关系", composition: "compound", compositionEvidence: "friend + relationship",
              components: [
                { surface: "朋友", gloss: "friend", role: "lexical" },
                { surface: "关系", gloss: "relationship", role: "lexical" }
              ]
            },
            {
              language: "hindi", surface: "मुद्दा", composition: "uncertain", compositionEvidence: "uncertain part",
              components: [{ surface: "मुद्दा", gloss: "matter", role: "lexical" }]
            }
          ]
        });
      }
      return JSON.stringify({
        senseId: sense.senseId,
        translations: [{ language: "hindi", surface: "मित्रता", composition: "simple", compositionEvidence: "one lexical word", components: [] }]
      });
    },
    onFailure: async (failure) => failureEvents.push(failure),
    onCache: async (records) => cacheSnapshots.push(records[0])
  });

  assert.deepEqual(requests, [
    { attempt: 1, languages: ["chinese", "hindi"] },
    { attempt: 2, languages: ["hindi"] }
  ]);
  assert.equal(cacheSnapshots[0].status, "partial");
  assert.deepEqual(cacheSnapshots[0].translations.map((row) => row.language), ["chinese"]);
  assert.equal(cacheSnapshots.at(-1).status, "complete");
  assert.deepEqual(result.records[0].translations.map((row) => row.language), ["chinese", "hindi"]);
  assert.equal(result.completedCount, 1);
  assert.deepEqual(failureEvents.map(({ language, attempts }) => [language, attempts]), [["hindi", 1]]);
  assert.deepEqual(result.failures, []);
});

test("translation wave retains partial translations and diagnoses each exhausted language", async () => {
  const sense = { senseId: "n:00000073-n", pos: "n", lemma: "friendship", gloss: "a relationship between friends" };
  const languageByHandle = new Map();
  const cached = [];
  const result = await translateWordNetSenseWave({
    senses: [sense],
    wordNetHash: "source-hash",
    languages: ["chinese", "hindi"],
    submit: async ({ handleId, attempt, languages: requested }) => {
      languageByHandle.set(`${handleId}-translate-${attempt}`, requested);
      return { status: "queued" };
    },
    awaitHandle: async (handleId) => {
      const requested = languageByHandle.get(handleId);
      const translations = [];
      if (requested.includes("chinese")) translations.push({
        language: "chinese", surface: "朋友关系", composition: "compound", compositionEvidence: "friend + relationship",
        components: [
          { surface: "朋友", gloss: "friend", role: "lexical" },
          { surface: "关系", gloss: "relationship", role: "lexical" }
        ]
      });
      translations.push({
        language: "hindi", surface: "मुद्दा", composition: "uncertain", compositionEvidence: "uncertain part",
        components: [{ surface: "मुद्दा", gloss: "matter", role: "lexical" }]
      });
      return JSON.stringify({ senseId: sense.senseId, translations });
    },
    onCache: async (records) => cached.push(records[0])
  });

  assert.equal(result.records[0].status, "partial");
  assert.deepEqual(result.records[0].translations.map((row) => row.language), ["chinese"]);
  assert.equal(cached.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].senseId, sense.senseId);
  assert.equal(result.failures[0].language, "hindi");
  assert.equal(result.failures[0].attempts, 2);
  assert.equal(result.failures[0].attemptErrors.length, 2);
  assert.match(result.failures[0].error, /uncertain translation decomposition/u);
});

test("cumulative translation failures retain attempts and mark recovered languages", () => {
  const existing = [{
    id: "translation-failure-hindi",
    senseId: "n:00000074-n",
    language: "hindi",
    status: "failed",
    attemptErrors: [{ id: "attempt-one", attempt: 1, error: "malformed row" }]
  }];
  const appended = mergeWordNetSenseTranslationFailures(existing, [{
    id: "translation-failure-hindi",
    senseId: "n:00000074-n",
    language: "hindi",
    status: "failed",
    attemptErrors: [{ id: "attempt-two", attempt: 2, error: "invalid segmentation" }]
  }]);
  const recovered = mergeWordNetSenseTranslationFailures(appended, [], {
    resolvedTranslations: [{ senseId: "n:00000074-n", translations: [{ language: "hindi" }] }]
  });

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "recovered");
  assert.equal(recovered[0].attemptErrors.length, 2);
  assert.deepEqual(recovered.flatMap((row) => row.attemptErrors.map((attempt) => attempt.id)).sort(), ["attempt-one", "attempt-two"]);
});

test("partial translations with useful components are eligible for composition", () => {
  const sense = { senseId: "n:00000075-n", lemmas: ["friendship"], lemma: "friendship" };
  assert.equal(hasCompositionSourceTranslations(sense, {
    status: "partial",
    translations: [{ language: "chinese", composition: "compound", components: [{}, {}] }]
  }), true);
  assert.equal(hasCompositionSourceTranslations(sense, {
    status: "partial",
    translations: [{ language: "french", composition: "simple", components: [] }]
  }), false);
  assert.equal(hasCompositionSourceTranslations({ ...sense, lemmas: ["self love"] }, {
    status: "partial",
    translations: [{ language: "french", composition: "simple", components: [] }]
  }), true);
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
