import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordNetSenseTranslationPrompt,
  buildSenseDerivedCompoundCandidates,
  parseWordNetSenseTranslationResponse,
  parseWordNetSenseTranslationCache,
  renderWordNetSenseTranslationCache,
  senseTranslationKey,
  buildSenseCompoundWorklist,
  buildKwonLinkedAtomicChoices,
  translateWordNetSenseWave
} from "../program/library/translation/english_wordnet_sense_compounds.mjs";

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
});

test("sense translation response parses bounded noisy JSON and keeps only requested languages", () => {
  const response = parseWordNetSenseTranslationResponse(`provider note\n${JSON.stringify({
    senseId: "n:00000010-n",
    translations: [
      { language: "chinese", surface: "朋友关系", composition: "compound", components: [
        { surface: "朋友", gloss: "friend" }, { surface: "关系", gloss: "relationship" }
      ] },
      { language: "french", surface: "amitié", composition: "simple", components: [] }
    ]
  })}`, { senseId: "n:00000010-n", languages: ["chinese", "french"] });

  assert.equal(response.valid, true);
  assert.deepEqual(response.missingLanguages, []);
  assert.equal(response.translations[0].components[1].gloss, "relationship");
  const wrapped = parseWordNetSenseTranslationResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: JSON.stringify({
      senseId: "n:00000010-n",
      translations: [{ language: "chinese", surface: "朋友关系", composition: "simple", components: [] }]
    }),
    done: true
  }), { senseId: "n:00000010-n", languages: ["chinese"] });
  assert.equal(wrapped.translations[0].surface, "朋友关系");
  assert.throws(() => parseWordNetSenseTranslationResponse(JSON.stringify({
    senseId: "n:00000010-n",
    translations: [
      { language: "chinese", surface: "甲乙", composition: "compound", components: [
        { surface: "甲", gloss: "a" }, { surface: "乙", gloss: "b" }
      ] },
      { language: "chinese", surface: "甲乙", composition: "simple", components: [] }
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
        components: [
          { surface: "朋友", gloss: "friend" },
          { surface: "关系", gloss: "relationship" }
        ]
      },
      {
        language: "french",
        surface: "relation amicale",
        composition: "compound",
        components: [
          { surface: "amicale", gloss: "friend" },
          { surface: "relation", gloss: "relationship" }
        ]
      }
    ],
    kwonCandidatesByGloss: new Map(Object.entries(linked)),
    relations: [{ source: "n:00000010-n", target: "n:00000020-n", relation: "hypernym" }]
  });

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].pyashSequence, ["hfre", "hlak"]);
  assert.deepEqual(candidates[0].sourceLanguages, ["chinese", "french"]);
  assert.deepEqual(candidates[0].componentGlosses, ["friend", "relationship"]);
  assert.equal(candidates[0].targetSenseEvidence[0].compatibleHeadSenseIds[0], "n:00000020-n");
});

test("worklist keeps only unresolved senses with a linked atomic WordNet head and ranks by frequency", () => {
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

  assert.deepEqual(rows.map((row) => row.senseId), ["n:00000011-n", "n:00000010-n"]);
  assert.equal(rows[0].compatibleHeadSenseIds[0], "n:00000090-n");
  assert.equal(rows[0].frequencyRank, 20);
  assert.equal(rows[1].frequencyRank, 3000);
});

test("Kwon component resolution admits only active linked atomic mappings", () => {
  const mapped = buildKwonLinkedAtomicChoices({
    suggestions: [{
      input: "relation",
      mappings: [
        { word: "relation", coverageType: "atomic", pyacSequence: ["hrel"] },
        { word: "relation compound", coverageType: "compound", pyacSequence: ["hfoo", "hrel"] },
        { word: "unlinked", coverageType: "atomic", status: "deprecated-duplicate", pyacSequence: ["hunl"] }
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
          components: [{ surface: "甲", gloss: "first" }, { surface: "乙", gloss: "second" }]
        }))
      });
    }
  });

  assert.deepEqual(events.slice(0, 2).map((event) => event.split(":")[0]), ["submit", "submit"]);
  assert.equal(result.submittedCount, 3);
  assert.equal(result.completedCount, 2);
  assert.equal(result.failures.length, 0);
});

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
  assert.ok(result.failures[0].response.length <= 2000);
  assert.match(result.failures[0].error, /n:00000045-n/u);
});
