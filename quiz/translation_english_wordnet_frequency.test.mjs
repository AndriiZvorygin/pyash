import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildEnglishWordNetAtomCoverage,
  buildEnglishWordNetFrequencyAllocationRecords,
  ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL,
  allocateEnglishWordNetAnchors,
  joinOpenEnglishWordNetSenseFrequencies,
  parseEnglishWordNetFrequencyAllocationConfig,
  parseOpenEnglishWordNetEntrySenseFiles,
  parsePrincetonWordNetSenseIndex,
  reconcileEnglishWordNetFrequencyBridgeRows
} from "../program/library/translation/english_wordnet_frequency.mjs";
import {
  parseEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisions
} from "../program/library/translation/english_wordnet_compound_decisions.mjs";
import {
  buildWordResolver,
  partitionResolvableWordNetBridges
} from "../command/wordnet_frequency_allocate.mjs";
import { buildEnglishLemmaIndex } from "../program/library/translation/english_lemmas.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };

test("frequency anchor resolution rejects aliases whose canonical target is grammar", () => {
  const resources = {
    coverage: {
      byVariant: new Map([
        ["he", {
          coverageType: "dictionary-alias",
          canonicalEnglish: "it",
          pyashSequence: ["htit"]
        }],
        ["it", {
          coverageType: "grammar",
          canonicalEnglish: "it",
          pyashSequence: ["ya"]
        }]
      ])
    }
  };
  const resolveWord = buildWordResolver(resources, { accepted: [] });

  assert.equal(resolveWord("he"), null);
  assert.equal(resolveWord("it").coverageType, "grammar");
  const records = buildEnglishWordNetFrequencyAllocationRecords({
    wordnetIndex: {
      bySynset: new Map([
        ["n:00000001-n", [{ lemma: "he", gloss: "the fifth Hebrew letter" }]],
        ["n:00000002-n", [{ lemma: "it", gloss: "a pronoun" }]]
      ])
    },
    frequencyJoin: { entries: [] },
    rankForEnglish: () => 1,
    resolveWord
  });
  assert.ok(records.every((record) => record.candidates.length === 0));
});

test("frequency reconciliation preserves unresolved bridge evidence without treating grammar as a lexical anchor", () => {
  const calls = [];
  const result = partitionResolvableWordNetBridges([{
    source: "n:00000001-n",
    target: "day",
    targetPartOfSpeech: "n",
    certainty: "deterministic",
    evidence: "older selection"
  }, {
    source: "v:00000002-v",
    target: "day",
    certainty: "deterministic",
    evidence: "valid lexical mapping"
  }], (target, options) => {
    calls.push([target, options.partOfSpeech]);
    return options.partOfSpeech === "v"
      ? { coverageType: "atomic", canonicalEnglish: "day", pyashSequence: ["tcin"] }
      : { coverageType: "grammar", canonicalEnglish: "day", pyashSequence: ["tcin"] };
  });

  assert.deepEqual(calls, [["day", "n"], ["day", "v"]]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].source, "v:00000002-v");
  assert.deepEqual(result.unresolved.map(({ source, targetPartOfSpeech, status, reason }) => ({
    source, targetPartOfSpeech, status, reason
  })), [{
    source: "n:00000001-n",
    targetPartOfSpeech: "n",
    status: "stale-unresolvable-target",
    reason: "target has no lexical Pyac identity for its target part of speech"
  }]);
});

test("frequency allocation gives an atom independent adjective, satellite, noun, and verb slots", () => {
  const records = buildEnglishWordNetFrequencyAllocationRecords({
    wordnetIndex: {
      bySynset: new Map([
        ["a:00000070-a", [{ lemma: "draw", gloss: "an elongated shape" }]],
        ["n:00000071-n", [{ lemma: "draw", gloss: "a picture" }]],
        ["v:00000072-v", [{ lemma: "draw", gloss: "make a picture" }]],
        ["s:00000073-s", [{ lemma: "drawn", gloss: "elongated" }]]
      ])
    },
    frequencyJoin: { entries: [] },
    rankForEnglish: () => 10,
    resolveWord: (word) => word === "draw"
      ? { coverageType: "atomic", canonicalEnglish: "draw", pyashSequence: ["cyuk"] }
      : word === "drawn"
        ? { coverageType: "atomic", canonicalEnglish: "draw", pyashSequence: ["cyuk"] }
        : null
  });

  const candidateSlots = records.map((record) => record.candidates[0].targetId);
  assert.deepEqual(candidateSlots.sort(), ["atom:cyuk:a", "atom:cyuk:n", "atom:cyuk:s", "atom:cyuk:v"]);
  const allocation = allocateEnglishWordNetAnchors(records);
  assert.equal(allocation.assignments.length, 4);
  assert.equal(new Set(allocation.assignments.map((row) => row.targetId)).size, 4);
  assert.deepEqual(allocation.assignments.map((row) => row.targetPartOfSpeech).sort(), ["a", "n", "s", "v"]);
});

test("frequency resolver applies a homograph lemma mapping only in its declared part of speech", () => {
  const lemmaIndex = buildEnglishLemmaIndex({
    atomicEntries: pyashWords,
    catalogEntries: [{
      surface: "becoming",
      lemma: "draw",
      canonicalEnglish: "draw",
      kind: "inflectional",
      status: "accepted-curated",
      partOfSpeech: "v",
      evidence: "fixture POS-scoped mapping"
    }]
  });
  const resources = {
    coverage: {
      byVariant: new Map([[
        "becoming",
        { coverageType: "atomic", canonicalEnglish: "becoming", pyashSequence: ["hbin"] }
      ]])
    },
    lemmaIndex,
    wordnet: { index: { byLemma: new Map([["becoming", [{ pos: "v" }, { pos: "a" }]]]) } }
  };
  const resolveWord = buildWordResolver(resources, { accepted: [] });

  assert.deepEqual(resolveWord("becoming", { partOfSpeech: "v" }).pyashSequence, ["cyuk"]);
  assert.equal(resolveWord("becoming", { partOfSpeech: "v" }).canonicalEnglish, "draw");
  assert.deepEqual(resolveWord("becoming", { partOfSpeech: "a" }).pyashSequence, ["hbin"]);
  assert.deepEqual(resolveWord("becoming").pyashSequence, ["hbin"]);
});

test("atom coverage keeps a free verb slot open after the noun slot is linked", () => {
  const rows = buildEnglishWordNetAtomCoverage({
    atoms: [{ en: "draw", pya: "cyuk" }],
    resolveCoverage: () => ({ coverageType: "atomic" }),
    rankForEnglish: () => 20,
    wordnetRecords: [
      {
        source: "n:00000081-n", pos: "n", synset: "00000081-n", lemmas: ["draw"], gloss: "a picture",
        candidates: [{ targetKind: "atom", targetId: "atom:cyuk:n", targetPartOfSpeech: "n", pyashSequence: ["cyuk"], lemma: "draw", rank: 20 }]
      },
      {
        source: "v:00000082-v", pos: "v", synset: "00000082-v", lemmas: ["draw"], gloss: "make a picture",
        candidates: [{ targetKind: "atom", targetId: "atom:cyuk:v", targetPartOfSpeech: "v", pyashSequence: ["cyuk"], lemma: "draw", rank: 20 }]
      }
    ],
    bridgeRecords: [{
      source: "n:00000081-n", pos: "n", synset: "00000081-n", lemmas: ["draw"], gloss: "a picture",
      link: {
        targetId: "atom:cyuk:n", targetPartOfSpeech: "n", target: "draw", pyashSequence: ["cyuk"],
        certainty: "deterministic", evidence: "existing noun link"
      }
    }]
  });

  assert.equal(rows[0].status, "direct-candidates-unlinked");
  assert.equal(rows[0].links.length, 1);
  assert.deepEqual(rows[0].directCandidates.map((candidate) => [candidate.pos, candidate.availableTargetPartOfSpeech]), [
    ["n", false],
    ["v", true]
  ]);
});

test("frequency anchor resolution accepts only single-atom lemma mappings", () => {
  const resources = {
    coverage: {
      byVariant: new Map([
        ["seem", {
          coverageType: "lemma",
          canonicalEnglish: "seemed",
          pyashSequence: ["sri2t"]
        }],
        ["walked", {
          coverageType: "lemma",
          canonicalEnglish: "walking",
          pyashSequence: ["pfin", "ki"]
        }],
        ["draw", {
          coverageType: "atomic",
          canonicalEnglish: "draw",
          pyashSequence: ["cyuk"],
          lemmaKind: "anchor",
          lemmaPyashSequence: ["cyuk"]
        }],
        ["drew", {
          coverageType: "atomic",
          canonicalEnglish: "draw",
          pyashSequence: ["cyuk"],
          lemmaKind: "duplicate",
          lemmaPyashSequence: ["cyuk"]
        }],
        ["given", {
          coverageType: "atomic",
          canonicalEnglish: "giving",
          pyashSequence: ["kwin"],
          lemmaKind: "duplicate",
          lemmaPyashSequence: ["kwin"]
        }],
        ["giving", {
          coverageType: "atomic",
          canonicalEnglish: "giving",
          pyashSequence: ["kwin"],
          lemmaKind: "inflectional",
          lemmaPyashSequence: ["kwin"]
        }]
      ])
    }
  };
  const resolveWord = buildWordResolver(resources, { accepted: [] });
  const resolved = resolveWord("seem");
  assert.equal(resolved.coverageType, "atomic");
  assert.equal(resolved.canonicalEnglish, "seemed");
  assert.deepEqual(resolved.pyashSequence, ["sri2t"]);
  assert.equal(resolveWord("walked"), null);
  assert.equal(resolveWord("draw").canonicalEnglish, "draw");
  assert.deepEqual(resolveWord("draw").pyashSequence, ["cyuk"]);
  assert.equal(resolveWord("drew").canonicalEnglish, "draw");
  assert.deepEqual(resolveWord("drew").pyashSequence, ["cyuk"]);
  assert.equal(resolveWord("given").canonicalEnglish, "giving");
  assert.deepEqual(resolveWord("given").pyashSequence, ["kwin"]);
  assert.equal(resolveWord("giving").canonicalEnglish, "giving");
  assert.deepEqual(resolveWord("giving").pyashSequence, ["kwin"]);

  const records = buildEnglishWordNetFrequencyAllocationRecords({
    wordnetIndex: {
      bySynset: new Map([["v:02137900-v", [{ lemma: "seem", gloss: "give a certain impression" }]]])
    },
    frequencyJoin: { entries: [] },
    rankForEnglish: () => 200,
    resolveWord
  });
  assert.deepEqual(records[0].candidates.map((candidate) => ({
    target: candidate.target,
    targetId: candidate.targetId,
    pyashSequence: candidate.pyashSequence
  })), [{ target: "seemed", targetId: "atom:sri2t:v", pyashSequence: ["sri2t"] }]);
});

test("frequency anchor resolution keeps a lexical WordNet lemma separate from another part of speech's inflection", () => {
  const resources = {
    wordnet: {
      index: {
        byLemma: new Map([["thought", [{ pos: "n", lemma: "thought" }]]])
      }
    },
    coverage: {
      byVariant: new Map([
        ["thought", {
          coverageType: "atomic",
          canonicalEnglish: "think",
          pyashSequence: ["hcik"],
          lemmaKind: "irregular",
          lemmaPyashSequence: ["hcik"]
        }],
        ["idea", {
          coverageType: "dictionary-alias",
          canonicalEnglish: "concepts",
          pyashSequence: ["kfen"]
        }],
        ["concepts", {
          coverageType: "atomic",
          canonicalEnglish: "concepts",
          pyashSequence: ["kfen"]
        }]
      ])
    }
  };
  const resolveWord = buildWordResolver(resources, { accepted: [] });
  assert.equal(resolveWord("thought", { pos: "n" }), null);
  assert.deepEqual(resolveWord("thought", { pos: "v" }).pyashSequence, ["hcik"]);
  const records = buildEnglishWordNetFrequencyAllocationRecords({
    wordnetIndex: {
      bySynset: new Map([[
        "n:00000003-n",
        [{ lemma: "thought", gloss: "a thought" }, { lemma: "idea", gloss: "an idea" }]
      ]])
    },
    frequencyJoin: { entries: [] },
    rankForEnglish: (lemma) => ({ thought: 139, idea: 468 }[lemma]),
    resolveWord
  });
  assert.deepEqual(records[0].candidates.map((candidate) => ({
    lemma: candidate.lemma,
    target: candidate.target,
    pyashSequence: candidate.pyashSequence
  })), [{ lemma: "idea", target: "concepts", pyashSequence: ["kfen"] }]);
});

test("frequency anchor resolution preserves accepted compound mappings", () => {
  const resources = {
    coverage: {
      byVariant: new Map([[
        "bookshelf",
        {
          coverageType: "compound",
          canonicalEnglish: "bookshelf",
          pyashSequence: ["hpuk", "claf"],
          lemmaKind: "compound",
          lemmaPyashSequence: ["hpuk", "claf"]
        }
      ]])
    }
  };
  const resolveWord = buildWordResolver(resources, {
    accepted: [{
      target: "bookshelf",
      aliases: [],
      pyashSequence: ["hpuk", "claf"]
    }]
  });

  assert.deepEqual(resolveWord("bookshelf"), {
    coverageType: "compound",
    canonicalEnglish: "bookshelf",
    target: "bookshelf",
    pyashSequence: ["hpuk", "claf"],
    id: undefined
  });
});

test("frequency allocation configuration versions compound verification", async () => {
  const config = parseEnglishWordNetFrequencyAllocationConfig(
    await readFile(ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL, "utf8")
  );
  assert.equal(config["compound-verification-revision"], "wordnet-modifier-literalness-v9");
  assert.equal(config["compound-head-relation-policy"], "advisory");
  assert.equal(config["compound-verification-batch-size"], 64);
  assert.equal(config["compound-candidate-source"], "english30k-closed-wordnet-multiword-existing-atoms-v1");
  assert.equal(config["compound-candidate-order"], "english30k-rank-ascending-princeton-tag-count-descending");
  assert.equal(config["atom-coverage-format"], "english-wordnet-atom-coverage-v1");
  assert.equal(config["atom-coverage-scope"], "every distinct Pyac identity in pyashWords");
  assert.equal(config["atom-coverage-batch-size"], 500);
  assert.match(config["alias-target-policy"], /grammatical targets remain residual/u);
});

test("atom coverage inventories every Pyac identity and separates linked, candidate, grammar, and missing cases", () => {
  const rows = buildEnglishWordNetAtomCoverage({
    atoms: [
      { en: "bank", pya: "hban" },
      { en: "financial institution", pya: "hban" },
      { en: "the", pya: "dlih" },
      { en: "unmatched", pya: "hunm" },
      { en: "overlap", pya: "hovl" },
      { pya: "hmis" }
    ],
    resolveCoverage: (label) => ({
      bank: { coverageType: "atomic" },
      "financial institution": { coverageType: "atomic" },
      the: { coverageType: "grammar" },
      unmatched: { coverageType: "none" },
      overlap: { coverageType: "atomic" }
    })[label] ?? null,
    rankForEnglish: (label) => ({ bank: 100, "financial institution": 300 }[label] ?? Number.POSITIVE_INFINITY),
    wordnetRecords: [
      {
        source: "n:00000001-n",
        pos: "n",
        synset: "00000001-n",
        lemmas: ["bank"],
        gloss: "a financial institution; example gloss",
        candidates: [{ targetKind: "atom", targetId: "atom:hban", lemma: "bank", rank: 100, tagCount: 8 }]
      },
      {
        source: "v:00000002-v",
        pos: "v",
        synset: "00000002-v",
        lemmas: ["overlap"],
        gloss: "a candidate action",
        candidates: [{ targetKind: "atom", targetId: "atom:hovl", lemma: "overlap", rank: 50, tagCount: 2 }]
      },
      {
        source: "v:00000003-v",
        pos: "v",
        synset: "00000003-v",
        lemmas: ["unmatched"],
        gloss: "an unassigned candidate action",
        candidates: [{ targetKind: "atom", targetId: "atom:hunm", lemma: "unmatched", rank: null, tagCount: 0 }]
      }
    ],
    bridgeRecords: [{
      source: "n:00000001-n",
      pos: "n",
      synset: "00000001-n",
      lemmas: ["bank"],
      gloss: "a financial institution; example gloss",
      link: {
        targetId: "atom:hban",
        target: "bank",
        pyashSequence: ["hban"],
        certainty: "deterministic",
        evidence: "frequency-ranked test link"
      }
    }, {
      source: "v:00000002-v",
      pos: "v",
      synset: "00000002-v",
      lemmas: ["overlap"],
      gloss: "a candidate action",
      link: {
        targetId: "atom:another",
        target: "another anchor",
        pyashSequence: ["hanr"],
        certainty: "deterministic",
        evidence: "already linked test sense"
      }
    }]
  });

  assert.equal(rows.length, 5);
  const byPyac = new Map(rows.map((row) => [row.pyac, row]));
  assert.deepEqual(byPyac.get("hban").labels, ["bank", "financial institution"]);
  assert.equal(byPyac.get("hban").status, "linked");
  assert.equal(byPyac.get("hban").links[0].source, "n:00000001-n");
  assert.equal(byPyac.get("dlih").status, "grammar-no-lexical-sense");
  assert.equal(byPyac.get("hunm").status, "direct-candidates-unlinked");
  assert.equal(byPyac.get("hunm").directCandidates[0].definition, "an unassigned candidate action");
  assert.equal(byPyac.get("hovl").status, "direct-candidates-already-linked");
  assert.deepEqual(byPyac.get("hovl").directCandidates[0].activeTargetIds, ["atom:another"]);
  assert.equal(byPyac.get("hmis").status, "missing-english-gloss");
});

test("Princeton sense index parses tag counts without treating missing keys as zero", () => {
  const parsed = parsePrincetonWordNetSenseIndex([
    "bank%1:14:00:: 08420278 1 25",
    "bank%1:21:00:: 13397174 2 0",
    "bank%1:17:00:: 08061042 3 0"
  ].join("\n"));

  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.byKey.get("bank%1:14:00::").tagCount, 25);
  assert.equal(parsed.byKey.get("bank%1:21:00::").tagCount, 0);
});

test("OEWN frequency joins require the exact lexical sense key", () => {
  const entrySenses = parseOpenEnglishWordNetEntrySenseFiles([{
    name: "entries-b.json",
    source: JSON.stringify({
      bank: { n: { sense: [
        { id: "bank%1:14:00::", synset: "08420278-n" },
        { id: "bank%1:21:00::", synset: "13397174-n" }
      ] } },
      banks: { n: { sense: [
        { id: "banks%1:14:00::", synset: "08420278-n" }
      ] } }
    })
  }]);
  const frequency = parsePrincetonWordNetSenseIndex([
    "bank%1:14:00:: 08420278 1 25",
    "bank%1:21:00:: 13397174 2 0"
  ].join("\n"));

  const result = joinOpenEnglishWordNetSenseFrequencies({ entrySenses, frequency });
  assert.equal(result.matchedCount, 2);
  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.entries.find((row) => row.lemma === "banks").tagCount, null);
  assert.equal(result.entries.find((row) => row.synset === "08420278-n").tagCount, 25);
});

test("frequency allocation uses rank then tag count and leaves tied senses for compounds", () => {
  const records = [
    {
      source: "n:00000001-n",
      lemmas: ["bank"],
      candidates: [{ lemma: "bank", rank: 100, tagCount: 25, target: "bank", targetId: "atom:bank", pyashSequence: ["hban"] }]
    },
    {
      source: "n:00000002-n",
      lemmas: ["bank"],
      candidates: [{ lemma: "bank", rank: 100, tagCount: 0, target: "bank", targetId: "atom:bank", pyashSequence: ["hban"] }]
    },
    {
      source: "n:00000003-n",
      lemmas: ["bass"],
      candidates: [{ lemma: "bass", rank: 200, tagCount: 0, target: "bass", targetId: "atom:bass", pyashSequence: ["hbas"] }]
    },
    {
      source: "n:00000004-n",
      lemmas: ["bass"],
      candidates: [{ lemma: "bass", rank: 200, tagCount: 0, target: "bass", targetId: "atom:bass", pyashSequence: ["hbas"] }]
    }
  ];

  const result = allocateEnglishWordNetAnchors(records);
  assert.deepEqual(result.assignments.map(({ source, targetId }) => [source, targetId]), [
    ["n:00000001-n", "atom:bank"]
  ]);
  assert.equal(result.residual.find((row) => row.source === "n:00000002-n").reason, "candidate-anchors-assigned-to-higher-frequency-senses");
  assert.equal(result.residual.find((row) => row.source === "n:00000003-n").reason, "anchor-contested-by-equal-frequency-senses");
  assert.equal(result.residual.find((row) => row.source === "n:00000004-n").reason, "anchor-contested-by-equal-frequency-senses");
});

test("frequency allocation leaves same-synset lemma ties unresolved", () => {
  const result = allocateEnglishWordNetAnchors([
    {
      source: "n:00000005-n",
      lemmas: ["first", "second"],
      candidates: [
        { lemma: "first", rank: 20, tagCount: 4, senseKey: "first%1:00:00::", target: "first", targetId: "atom:first", pyashSequence: ["hfir"] },
        { lemma: "second", rank: 20, tagCount: 4, senseKey: "second%1:00:00::", target: "second", targetId: "atom:second", pyashSequence: ["hsec"] }
      ]
    },
    {
      source: "n:00000006-n",
      lemmas: ["known", "unranked"],
      candidates: [
        { lemma: "known", rank: 30, tagCount: 8, target: "known", targetId: "atom:known", pyashSequence: ["hknw"] },
        { lemma: "unranked", rank: 30, tagCount: null, target: "unranked", targetId: "atom:unranked", pyashSequence: ["hunr"] }
      ]
    },
    {
      source: "n:00000007-n",
      lemmas: ["winner", "runner-up"],
      candidates: [
        { lemma: "winner", rank: 40, tagCount: 9, senseKey: "winner%1:00:00::", target: "winner", targetId: "atom:winner", pyashSequence: ["hwin"] },
        { lemma: "runner-up", rank: 40, tagCount: 2, senseKey: "runner-up%1:00:00::", target: "runner-up", targetId: "atom:runner", pyashSequence: ["hrun"] }
      ]
    },
    {
      source: "v:00000008-v",
      lemmas: ["confuse"],
      candidates: [
        { lemma: "confuse", rank: 500, tagCount: 1, senseKey: "confuse%2:00:00::", target: "identity-confusion", targetId: "compound:hdif+hbun", pyashSequence: ["hdif", "hbun"] }
      ]
    }
  ]);

  assert.deepEqual(result.assignments.map((row) => [row.source, row.targetId, row.senseKey]), [
    ["n:00000007-n", "atom:winner", "winner%1:00:00::"],
    ["v:00000008-v", "compound:hdif+hbun", "confuse%2:00:00::"]
  ]);
  assert.equal(result.assignments.find((row) => row.source === "v:00000008-v").target, "identity-confusion");
  assert.equal(result.residual.find((row) => row.source === "n:00000005-n").reason, "english30k-and-wordnet-tag-count-tie-within-synset");
  assert.equal(result.residual.find((row) => row.source === "n:00000006-n").reason, "english30k-and-wordnet-tag-count-tie-within-synset");
});

test("frequency reconciliation preserves explicit Qwen atom-target sense selections", () => {
  const entry = {
    source: "n:00000001-n",
    target: "bank",
    certainty: "contextual",
    evidence: "atom-target sense selection; model qwen3.5:9b; run fixture; rationale: financial institution"
  };
  const result = reconcileEnglishWordNetFrequencyBridgeRows({
    existingEntries: [entry],
    assignments: [],
    resolveTarget: () => ({ pyashSequence: ["hban"] })
  });
  assert.deepEqual(result.preservedEntries, [entry]);
  assert.deepEqual(result.retainedModelEntries, []);
  assert.deepEqual(result.newAssignments, []);
});

test("frequency reconciliation resolves bridge targets in their target part of speech", () => {
  const calls = [];
  const source = "s:00000019-s";
  const result = reconcileEnglishWordNetFrequencyBridgeRows({
    existingEntries: [{
      source,
      target: "only",
      targetPartOfSpeech: "a",
      certainty: "contextual",
      evidence: "accepted by model qwen3.5:9b; sense-link sweep model-qwen"
    }],
    assignments: [{
      source,
      target: "only",
      targetId: "atom:htun:a",
      targetPartOfSpeech: "a",
      pyashSequence: ["htun"]
    }],
    resolveTarget: (target, options) => {
      calls.push([target, options.partOfSpeech]);
      return options.partOfSpeech === "a"
        ? { coverageType: "atomic", pyashSequence: ["htun"] }
        : { coverageType: "grammar", pyashSequence: ["ya"] };
    }
  });

  assert.deepEqual(calls, [["only", "a"]]);
  assert.deepEqual(result.retainedModelEntries.map((entry) => entry.source), [source]);
  assert.deepEqual(result.supersededModelEntries, []);
});

test("frequency allocation skips reserved targets and allows a sense to use its next ranked anchor", () => {
  const result = allocateEnglishWordNetAnchors([
    {
      source: "n:00000001-n",
      lemmas: ["common", "alternate"],
      candidates: [
        { lemma: "common", rank: 10, tagCount: 2, target: "common", targetId: "atom:common", pyashSequence: ["hcom"] },
        { lemma: "alternate", rank: 20, tagCount: 1, target: "alternate", targetId: "atom:alternate", pyashSequence: ["halt"] }
      ]
    }
  ], { reservedTargetIds: ["atom:common"] });

  assert.equal(result.assignments[0].targetId, "atom:alternate");
  assert.equal(result.residual.length, 0);
});

test("frequency allocation enforces one target and one assignment per synset", () => {
  const result = allocateEnglishWordNetAnchors([
    {
      source: "n:00000001-n",
      lemmas: ["common"],
      candidates: [{ lemma: "common", rank: 10, tagCount: 4, target: "common", targetId: "atom:common", pyashSequence: ["hcom"] }]
    },
    {
      source: "n:00000002-n",
      lemmas: ["common", "alternate"],
      candidates: [
        { lemma: "common", rank: 10, tagCount: 2, target: "common", targetId: "atom:common", pyashSequence: ["hcom"] },
        { lemma: "alternate", rank: 20, tagCount: 1, target: "alternate", targetId: "atom:alternate", pyashSequence: ["halt"] }
      ]
    }
  ]);

  assert.deepEqual(result.assignments.map(({ source, targetId }) => [source, targetId]), [
    ["n:00000001-n", "atom:common"],
    ["n:00000002-n", "atom:alternate"]
  ]);
  assert.equal(new Set(result.assignments.map((row) => row.targetId)).size, result.assignments.length);
  assert.equal(new Set(result.assignments.map((row) => row.source)).size, result.assignments.length);
});

test("frequency reconciliation preserves curated rows and keeps model rows only when allocation agrees", () => {
  const assignments = [
    { source: "n:00000001-n", target: "cat", targetId: "atom:cat", pyashSequence: ["hcat"], english30kRank: 20, tagCount: 8 },
    { source: "n:00000002-n", target: "bird", targetId: "atom:bird", pyashSequence: ["pyaf"], english30kRank: 40, tagCount: 3 }
  ];
  const result = reconcileEnglishWordNetFrequencyBridgeRows({
    existingEntries: [
      { source: "n:curated-n", target: "curated", certainty: "contextual", evidence: "curated evidence" },
      { source: "n:deterministic-n", target: "known", certainty: "deterministic", evidence: "unique edge anchor" },
      { source: "n:00000001-n", target: "cat", certainty: "contextual", evidence: "accepted by model qwen3.5:9b; sense-link sweep model-qwen" },
      { source: "n:00000002-n", target: "other", certainty: "contextual", evidence: "accepted by model qwen3.5:9b; sense-link sweep model-qwen" },
      { source: "n:old-n", target: "stale", certainty: "deterministic", evidence: "frequency-first anchor allocation from previous run" }
    ],
    assignments,
    resolveTarget: (target) => ({ pyashSequence: ({ cat: ["hcat"], other: ["hother"], known: ["hknown"] })[target] ?? [] })
  });

  assert.deepEqual(result.preservedEntries.map((row) => row.source), ["n:curated-n", "n:deterministic-n"]);
  assert.deepEqual(result.retainedModelEntries.map((row) => row.source), ["n:00000001-n"]);
  assert.equal(result.supersededModelEntries[0].source, "n:00000002-n");
  assert.equal(result.supersededModelEntries[0].reason, "frequency-allocation-selected-a-different-anchor");
  assert.deepEqual(result.newAssignments.map((row) => row.source), ["n:00000002-n"]);
});

test("compound decision evidence round-trips as a native Pyash map", () => {
  const rows = [{
    candidateId: "derived-compound-123",
    target: "brainstorm",
    pyashSequence: ["twum", "hfup"],
    status: "accepted-llm",
    verificationRationale: "components compose the source meaning",
    verificationModifierSenseIds: ["n:00000001-n"],
    verificationModifierEvidence: ["brain identifies the topic"],
    verificationModifierRelations: ["literal"]
  }];
  const parsed = parseEnglishWordNetCompoundDecisions(renderEnglishWordNetCompoundDecisions(rows));
  assert.deepEqual(parsed.rows, rows);
  assert.equal(parsed.byId.get(rows[0].candidateId).status, "accepted-llm");
});
