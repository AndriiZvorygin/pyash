import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
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
import { buildWordResolver } from "../command/wordnet_frequency_allocate.mjs";

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

test("frequency allocation configuration versions compound verification", async () => {
  const config = parseEnglishWordNetFrequencyAllocationConfig(
    await readFile(ENGLISH_WORDNET_FREQUENCY_ALLOCATION_CONFIG_URL, "utf8")
  );
  assert.equal(config["compound-verification-revision"], "wordnet-modifier-literalness-v9");
  assert.equal(config["compound-verification-batch-size"], 64);
  assert.match(config["alias-target-policy"], /grammatical targets remain residual/u);
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
