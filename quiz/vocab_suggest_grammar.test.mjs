import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";
import {
  buildKwonLinkedAtomicChoices,
  buildSenseCompoundChoiceInput
} from "../program/library/translation/english_wordnet_sense_compounds.mjs";

test("vocab_suggest reports indefinite pronouns as fused Pyac words", async () => {
  const lines = [];
  const result = await runVocabSuggest([
    "someone", "anyone", "everyone", "nobody", "something", "anything", "everything", "nothing", "another"
  ], { report: (line) => lines.push(String(line)) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  const output = lines.join("\n");
  for (const [surface, pyac] of [
    ["someone", "cyahtlih"],
    ["anyone", "cyahtlah"],
    ["everyone", "cyahwi"],
    ["nobody", "cyahno"],
    ["something", "yatlih"],
    ["anything", "yatlah"],
    ["everything", "yawi"],
    ["nothing", "yano"],
    ["another", "clahtlih"]
  ]) {
    assert.match(output, new RegExp(`${surface}: grammar -> ${pyac}`, "u"));
  }
});

test("vocab_suggest reports both lexical and grammar forms for example", async () => {
  const lines = [];
  const result = await runVocabSuggest(["example"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  const output = lines.join("\n");
  assert.match(output, /example: root -> tlam \(English30k rank 1032\)/u);
  assert.match(output, /example: grammar -> fluh \(English30k rank 1032\)/u);
});

test("vocab_suggest reports grammar and lexical root forms for inside", async () => {
  const lines = [];
  const result = await runVocabSuggest(["inside"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  const output = lines.join("\n");
  assert.match(output, /inside: root -> lwak \(English30k rank 1583\)/u);
  assert.match(output, /inside: grammar -> lwah \(English30k rank 1583\)/u);
  assert.doesNotMatch(output, /^inside: ok$/mu);
});

test("vocab_suggest reports the English gloss for an accepted Pyac atom", async () => {
  const lines = [];
  const result = await runVocabSuggest(["twum"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.match(lines.join("\n"), /^twum: brain$/mu);
});

test("vocab_suggest shows linked WordNet glosses for English anchors and Pyac atoms", async () => {
  const englishLines = [];
  const englishResult = await runVocabSuggest(["touch"], { report: (line) => englishLines.push(String(line)) });
  assert.match(englishLines.join("\n"), /touch: WordNet n:00856168-n .* -> touch \(tcum\)/u);
  assert.equal(englishResult.linkedWordNetSenses.find((entry) => entry.source === "n:00856168-n")?.target, "touch");
  assert.match(englishResult.linkedWordNetSenses.find((entry) => entry.source === "n:00856168-n")?.gloss ?? "", /manual stimulation/u);

  const pyacLines = [];
  await runVocabSuggest(["tcum"], { report: (line) => pyacLines.push(String(line)) });
  assert.match(pyacLines.join("\n"), /tcum: WordNet n:00856168-n .* -> touch \(tcum\)/u);
});

test("vocab_suggest keeps a repository-directory-named token on the vocabulary path", async () => {
  const lines = [];
  const result = await runVocabSuggest(["container"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.match(lines.join("\n"), /^container: WordNet n:03099154-n .* -> containers \(hven\)$/mu);
  assert.match(lines.join("\n"), /^container: lemma contain -> hzan \(English30k rank \d+\)$/mu);
});

test("vocab_suggest returns separate English suggestions and Pyac mappings", async () => {
  const result = await runVocabSuggest(["baffled", "bewildered"], { report: () => {} });
  const records = new Map(result.suggestionRecords.map((record) => [record.input, record]));
  const baffled = records.get("baffled");
  const bewildered = records.get("bewildered");
  assert.deepEqual(baffled.wordSuggestions, ["mystified"]);
  assert.deepEqual(baffled.mappings[0], {
    word: "mystified",
    pyac: "hmi2f",
    pyacSequence: ["hmi2f"],
    kind: "dictionary-alias",
    coverageType: "dictionary-alias",
    status: "covered-dictionary-alias",
    rank: 7439,
    source: "vocab-suggest"
  });
  assert.deepEqual(bewildered.wordSuggestions, ["panicked", "mystified", "crazily"]);
  assert.equal(bewildered.mappings.find((mapping) => mapping.word === "mystified")?.pyac, "hmi2f");
});

test("vocab_suggest retains blacklist alternatives beside canonical compound readings", async () => {
  const lines = [];
  const result = await runVocabSuggest(["accord"], { report: (line) => lines.push(String(line)) });
  const accord = result.suggestionRecords.find((record) => record.input === "accord");
  assert.deepEqual(accord.wordSuggestions, ["treaty", "coincidence", "chord", "heart"]);
  assert.equal(accord.suggestionSource, "blacklist");
  assert.match(lines.join("\n"), /accord blocked, instead: treaty, coincidence, chord, heart/u);
  assert.doesNotMatch(lines.join("\n"), /accordions/u);

  const meet = await runVocabSuggest(["meet"], { report: () => {} });
  const meetSuggestions = meet.suggestionRecords.find((record) => record.input === "meet");
  assert.equal(meetSuggestions.suggestionSource, "blacklist");
  assert.deepEqual(meetSuggestions.wordSuggestions.slice(-2), ["see", "visit"]);
});

test("compound prompt keeps distinct atom choices from every exact Kwon alternative", async () => {
  const words = ["accord", "treaty", "coincidence", "chord", "heart", "meet", "see", "visit"];
  const result = await runVocabSuggest(words.flatMap((word) => ["--text", word]), { report: () => {} });
  const activeAtomEntries = result.linkedWordNetSenses.map((sense) => ({
    source: sense.source,
    target: sense.target,
    targetPartOfSpeech: sense.targetPartOfSpeech,
    targetKind: "atom",
    pyashSequence: sense.pyashSequence,
    lemmas: sense.lemmas,
    definition: sense.gloss
  }));
  const kwonCandidatesByGloss = buildKwonLinkedAtomicChoices({
    suggestions: result.suggestionRecords,
    linkedWordNetSenses: result.linkedWordNetSenses,
    componentGlosses: ["accord", "meet"],
    activeAtomEntries,
    layerByWord: new Map(activeAtomEntries.map((entry) => [entry.pyashSequence[0], 16]))
  });
  const choiceInput = buildSenseCompoundChoiceInput({
    sense: { senseId: "n:00000001-n", pos: "n", lemma: "sample", definition: "a sample target" },
    translations: [{
      language: "test-language",
      surface: "part-a-part-b",
      composition: "compound",
      components: [
        { surface: "part-a", gloss: "accord", role: "lexical" },
        { surface: "part-b", gloss: "meet", role: "lexical" }
      ]
    }],
    kwonCandidatesByGloss
  });

  assert.ok(choiceInput);
  assert.deepEqual(
    choiceInput.sourceOptions.filter((choice) => choice.sourceGloss === "accord").map((choice) => choice.word),
    ["treaty", "coincidence", "chord", "heart"]
  );
  assert.match(choiceInput.prompt, /"coincidence"/u);
  assert.match(choiceInput.prompt, /"heart"/u);
});
