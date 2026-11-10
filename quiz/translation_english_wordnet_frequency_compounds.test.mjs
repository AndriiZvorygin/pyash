import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedDecisionsForRevision,
  acceptedDecision,
  groupWordNetCompoundCandidates,
  promoteAcceptedCompounds,
  promoteAcceptedCompoundRecords,
  selectCurrentRevisionCompounds,
  wordNetCompoundDecisionRecord
} from "../command/wordnet_frequency_compound_sweep.mjs";
import {
  atomSenseEntriesForReselection,
  buildWordNetHeadRelationIndex,
  compoundWorklist,
  hasWordNetHeadSenseRelation
} from "../command/wordnet_frequency_allocate.mjs";
import {
  buildCompoundVerificationPrompt,
  parseCompoundVerificationResponse
} from "../program/library/translation/compound_verification.mjs";
import {
  parseEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisions
} from "../program/library/translation/english_wordnet_compound_decisions.mjs";
import {
  buildEnglishWordNetCompoundGlosses,
  parseEnglishWordNetCompoundGlosses,
  renderEnglishWordNetCompoundGlosses
} from "../program/library/translation/english_wordnet_compound_glosses.mjs";
import { parseCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import { renderDerivedCompoundCoveragePya } from "../program/library/translation/compound_coverage.mjs";

function row(id, target, sourceSurfaces, pyashSequence) {
  return {
    id,
    verificationRecord: {
      id,
      target,
      sourceSurfaces,
      pyashSequence,
      sourceMorphemes: ["brain", "storm"],
      status: "candidate-closed"
    }
  };
}

test("targeted atom reselection reopens a circular bridge definition generically", () => {
  const entry = {
    source: "v:02029675-v",
    target: "escort",
    targetPartOfSpeech: "v",
    evidence: "frequency-first anchor allocation",
    gloss: "accompany as an escort; example: escort someone to a ball"
  };
  const resolveWord = (word) => word === "escort"
    ? { coverageType: "atomic", pyashSequence: ["srot"] }
    : null;

  assert.deepEqual(atomSenseEntriesForReselection(
    [entry],
    ["atom:srot:v"],
    resolveWord
  ), [entry]);
  assert.deepEqual(atomSenseEntriesForReselection(
    [entry],
    ["atom:other:v"],
    resolveWord
  ), []);
});

test("WordNet hypernym evidence remains same-part-of-speech and directed", () => {
  const index = buildWordNetHeadRelationIndex([
    { source: "n:00000001-n", target: "n:00000002-n", relation: "hypernym" },
    { source: "n:00000002-n", target: "n:00000003-n", relation: "hypernym" },
    { source: "n:00000004-n", target: "n:00000005-n", relation: "similar" },
    { source: "a:00000006-a", target: "a:00000007-a", relation: "hypernym" }
  ]);

  assert.equal(hasWordNetHeadSenseRelation("n:00000001-n", "n:00000003-n", index), true);
  assert.equal(hasWordNetHeadSenseRelation("n:00000001-n", "n:00000002-n", index), true);
  assert.equal(hasWordNetHeadSenseRelation("n:00000003-n", "n:00000001-n", index), false);
  assert.equal(hasWordNetHeadSenseRelation("n:00000001-n", "v:00000002-v", index), false);
  assert.equal(hasWordNetHeadSenseRelation("n:00000004-n", "n:00000005-n", index), false);
  assert.equal(hasWordNetHeadSenseRelation("a:00000006-a", "a:00000007-a", index), true);
});

test("compound verifier batches retain alternate decompositions in one decision group", () => {
  const candidates = [
    row("candidate-one", "brainstorm", { zh: "头脑风暴" }, ["twum", "hfup"]),
    row("candidate-two", "brainstorm", { zh: "头脑风暴" }, ["twum", "hfun"]),
    row("candidate-three", "brainstorm", { fr: "remue-méninges" }, ["twum", "hmot"])
  ];

  const groups = groupWordNetCompoundCandidates(candidates);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((record) => record.id), ["candidate-one", "candidate-two"]);
  assert.deepEqual(groups[1].map((record) => record.id), ["candidate-three"]);
});

test("compound verification groups run in English30k rank order", () => {
  const lowFrequency = row("low-frequency", "apple-compound", { en: "apple-compound" }, ["appl", "fruit"]);
  lowFrequency.verificationRecord.frequencyRank = 900;
  lowFrequency.verificationRecord.frequencyTagCount = 1;
  const highFrequency = row("high-frequency", "zebra-compound", { en: "zebra-compound" }, ["zebr", "animal"]);
  highFrequency.verificationRecord.frequencyRank = 20;
  highFrequency.verificationRecord.frequencyTagCount = 0;

  assert.deepEqual(
    groupWordNetCompoundCandidates([lowFrequency, highFrequency]).map((group) => group[0].target),
    ["zebra-compound", "apple-compound"]
  );
});

test("completed compound decisions are skipped without dropping unresolved alternatives", () => {
  const candidates = [
    row("candidate-one", "brainstorm", { zh: "头脑风暴" }, ["twum", "hfup"]),
    row("candidate-two", "brainstorm", { zh: "头脑风暴" }, ["twum", "hfun"]),
    row("candidate-three", "brainstorm", { fr: "remue-méninges" }, ["twum", "hmot"])
  ];

  const groups = groupWordNetCompoundCandidates(candidates, new Set(["candidate-three"]));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((record) => record.id), ["candidate-one", "candidate-two"]);
});

test("compound candidates are emitted in English30k frequency order", () => {
  const residual = [
    { source: "n:00000010-n", pos: "n", synset: "00000010-n", lemmas: ["zebra"], gloss: "zebra", candidates: [] },
    { source: "n:00000011-n", pos: "n", synset: "00000011-n", lemmas: ["apple"], gloss: "apple", candidates: [] }
  ];
  const candidates = [
    { id: "zebra", target: "zebra", aliases: [], pyashSequence: ["zebra", "animal"], componentGlosses: ["zebra", "animal"] },
    { id: "apple", target: "apple", aliases: [], pyashSequence: ["apple", "fruit"], componentGlosses: ["apple", "fruit"] }
  ];
  const worklist = compoundWorklist(residual, candidates, [], [], new Map(), "v1", {
    rankForEnglish: (word) => word === "zebra" ? 10 : 200
  });

  assert.deepEqual(worklist.map((row) => row.target), ["zebra", "apple"]);
  assert.deepEqual(worklist.map((row) => row.frequencyRank), [10, 200]);
  assert.deepEqual(worklist.map((row) => row.verificationRecord.frequencyRank), [10, 200]);
});

test("an active atomic anchor keeps its covered lemma out of compound verification", () => {
  const residual = [{
    source: "v:02029675-v", pos: "v", synset: "02029675-v", lemmas: ["escort"],
    gloss: "accompany as an escort", candidates: []
  }];
  const candidates = [{
    id: "escort-compound", target: "escort", aliases: [], pyashSequence: ["srot", "hgo"],
    componentGlosses: ["escort", "go"]
  }];
  const resolveWord = (lemma) => lemma === "escort"
    ? { coverageType: "atomic", pyashSequence: ["srot"] }
    : null;
  const worklist = compoundWorklist(residual, candidates, [], [], new Map(), "v1", {
    resolveWord,
    activeAtomicTargetIds: ["atom:srot:v"]
  });

  assert.deepEqual(worklist, []);
});

test("a compound target reserved for a verb remains available to a noun sense", () => {
  const residual = [{
    source: "n:00031563-n", pos: "n", synset: "00031563-n", lemmas: ["group"],
    gloss: "entities considered as a unit", candidates: []
  }];
  const candidates = [{
    id: "group-compound", target: "group", aliases: [], pyashSequence: ["kcat", "kcot"],
    componentGlosses: ["together", "gather"]
  }];
  const verbTargetId = "compound:kcat+kcot:v";
  const nounTargetId = "compound:kcat+kcot:n";

  const nounWorklist = compoundWorklist(residual, candidates, [verbTargetId], [], new Map(), "v1");
  assert.equal(nounWorklist[0].disposition, "ready-for-housekeeper-verification");

  const reservedNounWorklist = compoundWorklist(residual, candidates, [nounTargetId], [], new Map(), "v1");
  assert.equal(reservedNounWorklist[0].disposition, "target-identity-already-linked");
});

test("derived compound round trips retain decision revision and audit links", () => {
  const record = {
    id: "brainstorm",
    surface: "brainstorm",
    target: "brainstorm",
    morphemes: ["brain", "storm"],
    sourceMorphemes: ["brain", "storm"],
    componentGlosses: ["brain", "storm"],
    pyashSequence: ["twum", "hfup"],
    componentLayers: [16, 16],
    maxLayer: 16,
    head: "storm",
    decisionRevision: "wordnet-modifier-literalness-v9",
    verificationDecisionIds: ["candidate-brainstorm-1", "candidate-brainstorm-2"],
    confidence: "verified-wordnet-compound",
    provenance: "WordNet frequency compound verification through Housekeeper",
    status: "accepted-llm"
  };
  const parsed = parseCompoundLexicon(renderDerivedCompoundCoveragePya([record], {
    name: "translation_compounds_derived_curated"
  }), {
    name: "translation_compounds_derived_curated",
    language: "canonical"
  });
  const current = selectCurrentRevisionCompounds(parsed, "wordnet-modifier-literalness-v9");

  assert.equal(current.length, 1);
  assert.deepEqual(current[0].verificationDecisionIds, ["candidate-brainstorm-1", "candidate-brainstorm-2"]);
});

test("verified compound index groups entries by synset and preserves same-target senses", () => {
  const record = (senseId, target, pyashSequence) => ({
    id: `${senseId}:${target}`,
    senseId,
    targetPartOfSpeech: senseId.slice(0, 1),
    target,
    surface: target,
    sourceMorphemes: ["accord", "agree"],
    morphemes: ["accord", "agree"],
    componentGlosses: ["accord", "agree"],
    pyashSequence,
    componentLayers: [16, 16],
    maxLayer: 16,
    head: "agree",
    decisionRevision: "v9",
    verificationDecisionId: `decision:${senseId}:${target}`,
    verificationDecisionIds: [`decision:${senseId}:${target}`],
    confidence: "verified-wordnet-compound",
    provenance: "WordNet frequency compound verification through Housekeeper",
    status: "accepted-llm"
  });
  const source = renderDerivedCompoundCoveragePya([
    record("v:00000001-v", "conform to", ["kfo7n", "tyik"]),
    record("v:00000001-v", "follow", ["kfo7n", "rwit"]),
    record("v:00000002-v", "conform to", ["kfo7n", "mwac"])
  ], { name: "translation_compounds_derived_curated" });
  const parsed = parseCompoundLexicon(source, {
    name: "translation_compounds_derived_curated",
    language: "canonical"
  });

  assert.equal((source.match(/su text "v:0000000[12]-v"/gu) ?? []).length, 2);
  assert.deepEqual(parsed.map((entry) => [entry.senseId, entry.target, entry.pyashSequence]), [
    ["v:00000001-v", "conform to", ["kfo7n", "tyik"]],
    ["v:00000001-v", "follow", ["kfo7n", "rwit"]],
    ["v:00000002-v", "conform to", ["kfo7n", "mwac"]]
  ]);
});

test("compound promotion keys records by synset while retaining target and sequence guards", () => {
  const accepted = ({ candidateId, target, senseId, pyashSequence }) => ({
    candidateId,
    target,
    senseId,
    verificationSenseId: senseId,
    targetPartOfSpeech: senseId.slice(0, 1),
    status: "accepted-llm",
    sourceMorphemes: ["accord", "agree"],
    componentGlosses: ["accord", "agree"],
    pyashSequence,
    componentLayers: [16, 16],
    maxLayer: 16,
    headRelationPolicy: "advisory",
    verificationComposition: "literal",
    verificationMethod: "wordnet-sense-component-choice",
    verificationComponentSenseIds: ["n:00000010-n", "v:00000011-v"],
    verificationSourceGlosses: ["accord", "agree"],
    verificationComponentMeanings: ["an agreement", "be in accord"],
    verificationHeadSenseId: "v:00000011-v",
    verificationRationale: "The component senses compose the target sense.",
    componentSenseEvidence: [
      { component: "accord", source: "n:00000010-n", definition: "an agreement", mappingLookupGloss: "accord" },
      { component: "agree", source: "v:00000011-v", definition: "be in accord", mappingLookupGloss: "agree" }
    ]
  });
  const existing = [{
    senseId: "v:00000001-v",
    targetPartOfSpeech: "v",
    target: "conform to",
    pyashSequence: ["accord", "satisfied"],
    decisionRevision: "v9",
    verificationDecisionId: "old-decision",
    verificationDecisionIds: ["old-decision"]
  }];
  const otherSense = accepted({
    candidateId: "new-sense",
    target: "conform to",
    senseId: "v:00000002-v",
    pyashSequence: ["accord", "agree"]
  });
  const result = promoteAcceptedCompoundRecords(existing, [otherSense], { decisionRevision: "v9" });

  assert.equal(result.decisions[0].promotionStatus, "promoted-to-derived-index");
  assert.deepEqual(result.records.map((row) => row.senseId), ["v:00000001-v", "v:00000002-v"]);

  const competingMeaning = accepted({
    candidateId: "different-sequence-same-sense",
    target: "conform to",
    senseId: "v:00000001-v",
    pyashSequence: ["accord", "agree"]
  });
  const conflict = promoteAcceptedCompoundRecords(existing, [competingMeaning], { decisionRevision: "v9" });
  assert.equal(conflict.decisions[0].promotionStatus, "sense-target-record-conflict");
});

test("compound sequence ownership is specific to part of speech", () => {
  const decision = (candidateId, target, senseId) => ({
    candidateId,
    target,
    senseId,
    verificationSenseId: senseId,
    targetPartOfSpeech: senseId.slice(0, 1),
    status: "accepted-llm",
    sourceMorphemes: ["together", "gather"],
    componentGlosses: ["together", "gather"],
    pyashSequence: ["kcat", "kcot"],
    componentLayers: [16, 16],
    maxLayer: 16,
    headRelationPolicy: "advisory",
    verificationComposition: "literal",
    verificationMethod: "wordnet-sense-component-choice",
    verificationComponentSenseIds: ["n:00000010-n", "v:00000011-v"],
    verificationSourceGlosses: ["together", "gather"],
    verificationComponentMeanings: ["close together", "collect"],
    verificationHeadSenseId: "v:00000011-v",
    verificationRationale: "The components compose the selected target sense.",
    componentSenseEvidence: [
      { component: "together", source: "n:00000010-n", definition: "close together", mappingLookupGloss: "together" },
      { component: "gather", source: "v:00000011-v", definition: "collect", mappingLookupGloss: "gather" }
    ],
    verificationDecisionId: candidateId,
    verificationDecisionIds: [candidateId]
  });
  const existing = [{
    senseId: "v:00368338-v",
    targetPartOfSpeech: "v",
    target: "merge",
    pyashSequence: ["kcat", "kcot"],
    decisionRevision: "v9"
  }];

  const noun = promoteAcceptedCompoundRecords(
    existing,
    [decision("noun-group", "group", "n:00031563-n")],
    { decisionRevision: "v9" }
  );
  assert.equal(noun.decisions[0].promotionStatus, "promoted-to-derived-index");
  assert.deepEqual(noun.records.map((record) => [record.target, record.targetPartOfSpeech]), [
    ["merge", "v"],
    ["group", "n"]
  ]);

  const samePartOfSpeech = promoteAcceptedCompoundRecords(
    noun.records,
    [decision("noun-cluster", "cluster", "n:00031563-n")],
    { decisionRevision: "v9" }
  );
  assert.equal(samePartOfSpeech.decisions[0].promotionStatus, "target-identity-conflict");
});

test("resume restores all accepted decisions in the active revision, including non-residual targets", () => {
  const accepted = (candidateId, decisionRevision) => ({
    candidateId,
    decisionRevision,
    status: "accepted-llm",
    componentGlosses: ["red", "flower"],
    verificationSenseId: "n:00000001-n",
    verificationHeadSenseId: "n:00000002-n",
    verificationHeadRelation: "supported",
    verificationModifierSenseIds: ["a:00000003-a"],
    verificationModifierEvidence: ["red describes flower literally"],
    verificationModifierRelations: ["literal"],
    componentSenseEvidence: [{ component: "red", source: "a:00000003-a" }]
  });
  const rows = [
    accepted("still-residual", "v9"),
    accepted("already-covered", "v9"),
    accepted("old-revision", "v8"),
    { ...accepted("uncertain", "v9"), status: "uncertain-llm" }
  ];

  assert.deepEqual(
    acceptedDecisionsForRevision(rows, "v9").map((record) => record.candidateId),
    ["still-residual", "already-covered"]
  );
});

test("a revision refresh retains only compounds accepted under the current verifier contract", () => {
  const current = { target: "current", decisionRevision: "wordnet-modifier-literalness-v9" };
  const stale = { target: "stale", decisionRevision: "wordnet-v7" };
  assert.deepEqual(selectCurrentRevisionCompounds([stale, current], "wordnet-modifier-literalness-v9"), [current]);
  assert.throws(() => selectCurrentRevisionCompounds([current], ""), /revision is required/u);
});

test("promoting a new verifier revision preserves older verified compound records", async () => {
  const previous = [{
    senseId: "n:00000001-n",
    targetPartOfSpeech: "n",
    target: "older compound",
    pyashSequence: ["old", "head"],
    decisionRevision: "wordnet-modifier-literalness-v9",
    verificationDecisionId: "older-decision",
    verificationDecisionIds: ["older-decision"]
  }];
  let written;

  const result = await promoteAcceptedCompounds([], {
    decisionRevision: "wordnet-modifier-literalness-v10",
    readExisting: async () => previous,
    writeRecords: async (records) => { written = records; }
  });

  assert.deepEqual(written, previous);
  assert.equal(result.activeCount, 1);
});

test("deterministic compound outcomes persist their verification status as the decision", () => {
  const decision = wordNetCompoundDecisionRecord({
    id: "known-ending",
    target: "acceptant",
    pyashSequence: ["ksap", "mrim"],
    status: "candidate-closed",
    verificationStatus: "rejected-deterministic"
  });

  assert.equal(decision.status, "rejected-deterministic");
  assert.equal(decision.coverageStatus, "candidate-closed");
  assert.equal(parseEnglishWordNetCompoundDecisions(renderEnglishWordNetCompoundDecisions([decision])).rows[0].status, "rejected-deterministic");

  const legacyRow = {
    candidateId: "legacy-ending",
    target: "acceptant",
    pyashSequence: ["ksap", "mrim"],
    status: "candidate-closed",
    verificationStatus: "rejected-deterministic"
  };
  const normalized = parseEnglishWordNetCompoundDecisions(renderEnglishWordNetCompoundDecisions([legacyRow])).rows[0];
  assert.equal(normalized.status, "rejected-deterministic");
  assert.equal(normalized.coverageStatus, "candidate-closed");

  const notSelected = {
    candidateId: "not-selected-alternative",
    target: "blackbird",
    pyashSequence: ["hblack", "hbird"],
    status: "not-selected-llm"
  };
  assert.equal(acceptedDecision(notSelected), false);
  assert.equal(
    parseEnglishWordNetCompoundDecisions(renderEnglishWordNetCompoundDecisions([notSelected])).rows[0].status,
    "not-selected-llm"
  );
});

test("compound promotion validates cited senses and applies an advisory head-relation policy", () => {
  const base = {
    status: "accepted-llm",
    decisionRevision: "wordnet-modifier-literalness-v9",
    componentGlosses: ["friend", "ship"],
    componentSenseEvidence: [
      { component: "friend", source: "n:00000003-n" },
      { component: "ship", source: "n:00000002-n" }
    ],
    verificationSenseId: "n:00000001-n",
    verificationHeadSenseId: "n:00000002-n",
    verificationHeadRelation: "supported",
    verificationModifierSenseIds: ["n:00000003-n"],
    verificationModifierEvidence: ["friend identifies the relationship"],
    verificationModifierRelations: ["literal"]
  };

  assert.equal(acceptedDecision(base), true);
  assert.equal(acceptedDecision({ ...base, verificationHeadRelation: "unsupported" }), false);
  assert.equal(acceptedDecision({ ...base, verificationHeadSenseId: "" }), false);
  assert.equal(acceptedDecision({ ...base, verificationSenseId: "" }), false);
  assert.equal(acceptedDecision({ ...base, verificationModifierEvidence: [] }), false);
  assert.equal(acceptedDecision({ ...base, verificationModifierSenseIds: ["n:99999999-n"] }), false);
  assert.equal(acceptedDecision({ ...base, verificationModifierRelations: ["metaphorical"] }), false);
  assert.equal(acceptedDecision({ status: "accepted-llm", decisionRevision: "legacy-v1" }), false);
  assert.equal(acceptedDecision({ ...base, decisionRevision: "wordnet-directed-head-relation-v7" }), true);
  assert.equal(acceptedDecision({ ...base, headRelationPolicy: "advisory", verificationHeadRelation: "unsupported" }), true);
  assert.equal(acceptedDecision({ ...base, headRelationPolicy: "advisory", verificationHeadSenseId: "" }), false);
});

test("compound promotion accepts compact linked-sense proofs and requires source gloss proof for suggestions", () => {
  const base = {
    status: "accepted-llm",
    decisionRevision: "wordnet-modifier-literalness-v9",
    headRelationPolicy: "advisory",
    componentGlosses: ["friend", "ship"],
    componentSenseEvidence: [
      {
        component: "friend",
        source: "n:00000003-n",
        mappingKind: "word-suggestion",
        mappingLookupSenseEvidence: [{ source: "n:00000004-n", definition: "a person regarded with affection" }]
      },
      { component: "ship", source: "n:00000002-n" }
    ],
    verificationSenseId: "n:00000001-n",
    verificationHeadSenseId: "n:00000002-n",
    verificationComposition: "literal",
    verificationComponentSenseIds: ["n:00000003-n", "n:00000002-n"],
    verificationSourceGlossSenseIds: ["n:00000004-n", ""]
  };
  assert.equal(acceptedDecision(base), true);
  assert.equal(acceptedDecision({ ...base, verificationComposition: "uncertain" }), false);
  assert.equal(acceptedDecision({ ...base, verificationHeadSenseId: "n:00000003-n" }), false);
  assert.equal(acceptedDecision({ ...base, verificationSourceGlossSenseIds: ["", ""] }), false);
  assert.equal(acceptedDecision({ ...base, verificationComponentSenseIds: ["n:99999999-n", "n:00000002-n"] }), false);
});

test("component-choice promotion requires the chosen atoms to match offered source gloss evidence", () => {
  const base = {
    status: "accepted-llm",
    verificationStatus: "accepted-llm",
    verificationMethod: "wordnet-sense-component-choice",
    verificationComposition: "literal",
    verificationRationale: "Friend relationship expresses friendship.",
    headRelationPolicy: "advisory",
    componentGlosses: ["friend", "relationship"],
    componentSenseEvidence: [
      { component: "friend", source: "n:00000003-n", definition: "a person attached by affection", mappingLookupGloss: "friend" },
      { component: "relationship", source: "n:00000002-n", definition: "a relation between entities", mappingLookupGloss: "relationship" }
    ],
    verificationSenseId: "n:00000001-n",
    verificationComponentSenseIds: ["n:00000003-n", "n:00000002-n"],
    verificationSourceGlosses: ["friend", "relationship"],
    verificationComponentMeanings: ["a person attached by affection", "a relation between entities"],
    verificationHeadSenseId: "n:00000002-n"
  };

  assert.equal(acceptedDecision(base), true);
  assert.equal(acceptedDecision({ ...base, verificationSourceGlosses: ["donate", "relationship"] }), false);
  assert.equal(acceptedDecision({ ...base, verificationComponentMeanings: ["yes", "a relation between entities"] }), false);
  assert.equal(acceptedDecision({ ...base, verificationComponentSenseIds: ["n:99999999-n", "n:00000002-n"] }), false);
  assert.equal(acceptedDecision({ ...base, verificationRationale: "" }), false);
  assert.equal(acceptedDecision({ ...base, verificationMethod: "separate-verifier" }), false);
});

test("component-choice evidence accepts a recorded bare infinitive lemma lookup", () => {
  const decision = {
    status: "accepted-llm",
    verificationMethod: "wordnet-sense-component-choice",
    verificationComposition: "literal",
    verificationRationale: "Object plus obtain expresses acquisition.",
    headRelationPolicy: "advisory",
    componentGlosses: ["object", "obtain"],
    componentSenseEvidence: [
      { component: "object", source: "n:00000010-n", definition: "a tangible entity", mappingLookupGloss: "object" },
      { component: "obtain", source: "v:00000011-v", definition: "come into possession", mappingLookupGloss: "obtain" }
    ],
    verificationSenseId: "v:00000012-v",
    verificationComponentSenseIds: ["n:00000010-n", "v:00000011-v"],
    verificationSourceGlosses: ["object", "to obtain"],
    verificationComponentMeanings: ["a tangible entity", "come into possession"],
    verificationHeadSenseId: "v:00000011-v"
  };

  assert.equal(acceptedDecision(decision), true);
  assert.equal(acceptedDecision({ ...decision, verificationSourceGlosses: ["object", "to purchase"] }), false);
});

test("compound worklist supplies bounded WordNet definitions without usage examples", () => {
  const residual = [
    {
      source: "n:00000001-n",
      pos: "n",
      synset: "00000001-n",
      lemmas: ["friendship"],
      gloss: "a relationship between friends; their friendship lasted decades",
      candidates: [{ lemma: "friendship", rank: 30, tagCount: 2 }]
    },
    {
      source: "n:00000002-n",
      pos: "n",
      synset: "00000002-n",
      lemmas: ["friendship"],
      gloss: "a social relation; example text that should be trimmed",
      candidates: [{ lemma: "friendship", rank: 60, tagCount: 1 }]
    }
  ];
  const candidates = [{
    id: "friendship-candidate",
    target: "friendship",
    aliases: [],
    pyashSequence: ["friend", "ship"],
    componentGlosses: ["friend", "ship"],
    sourceSurfaces: { zh: "友谊" },
    status: "candidate-closed"
  }];
  const wordnetIndex = {
    relations: [
      { source: "n:00000001-n", target: "n:00000004-n", relation: "hypernym" }
    ],
    senses(component) {
      if (component === "friend") return [{
        pos: "n",
        synset: "00000003-n",
        lemmas: ["friend"],
        gloss: "a person you know well and regard with affection; example removed"
      }];
      if (component === "ship") return [
        { pos: "n", synset: "00000004-n", lemmas: ["ship"], gloss: "a vessel that carries people or goods" },
        { pos: "n", synset: "00000005-n", lemmas: ["ship"], gloss: "a large amount; example removed" }
      ];
      return [];
    }
  };
  const worklist = compoundWorklist(residual, candidates, [], [], new Map(), "sense-v2", {
    wordnetIndex,
    senseTagCounts: new Map([["n:00000004-n", 8], ["n:00000005-n", 2]])
  });

  assert.equal(worklist.length, 1);
  assert.deepEqual(worklist[0].verificationRecord.targetSenseEvidence, [
    {
      source: "n:00000001-n",
      pos: "n",
      lemmas: ["friendship"],
      definition: "a relationship between friends",
      headRelationPolicy: "advisory",
      compatibleHeadSenseIds: ["n:00000004-n"]
    },
    {
      source: "n:00000002-n",
      pos: "n",
      lemmas: ["friendship"],
      definition: "a social relation",
      headRelationPolicy: "advisory",
      compatibleHeadSenseIds: []
    }
  ]);
  assert.deepEqual(worklist[0].verificationRecord.componentSenseEvidence, [
    { component: "friend", source: "n:00000003-n", lemmas: ["friend"], definition: "a person you know well and regard with affection" },
    { component: "ship", source: "n:00000004-n", lemmas: ["ship"], definition: "a vessel that carries people or goods" },
    { component: "ship", source: "n:00000005-n", lemmas: ["ship"], definition: "a large amount" }
  ]);
  assert.equal(worklist[0].disposition, "ready-for-housekeeper-verification");

  const stale = compoundWorklist(residual, candidates, [], [], new Map([
    ["friendship-candidate", { status: "accepted-llm", decisionRevision: "sense-v1" }]
  ]), "sense-v2", {
    wordnetIndex,
    senseTagCounts: new Map([ ["n:00000004-n", 8], ["n:00000005-n", 2] ])
  });
  assert.equal(stale[0].disposition, "ready-for-housekeeper-verification");
  const current = compoundWorklist(residual, candidates, [], [], new Map([
    ["friendship-candidate", { status: "accepted-llm", decisionRevision: "sense-v2" }]
  ]), "sense-v2", {
    wordnetIndex,
    senseTagCounts: new Map([ ["n:00000004-n", 8], ["n:00000005-n", 2] ])
  });
  assert.equal(current[0].disposition, "already-accepted-llm");

  const withoutHeadRelation = compoundWorklist([{
    source: "n:00000009-n",
    pos: "n",
    synset: "00000009-n",
    lemmas: ["unrelated"],
    gloss: "a meaning with no WordNet head relation",
    candidates: [{ lemma: "unrelated", rank: 90, tagCount: 0 }]
  }], [{
    ...candidates[0],
    id: "unrelated-candidate",
    target: "unrelated"
  }], [], [], new Map(), "sense-v2", {
    wordnetIndex,
    senseTagCounts: new Map()
  });
  assert.equal(withoutHeadRelation[0].disposition, "ready-for-housekeeper-verification");
  assert.equal(withoutHeadRelation[0].verificationRecord.headRelationPolicy, "advisory");
  assert.deepEqual(withoutHeadRelation[0].verificationRecord.targetSenseEvidence[0].compatibleHeadSenseIds, []);
});

test("compound prompt requires evidence from a supplied target sense", () => {
  const candidate = {
    id: "friendship-candidate",
    target: "friendship",
    sourceMorphemes: ["friend", "ship"],
    componentGlosses: ["friend", "ship"],
    pyashSequence: ["hfre", "hship"],
    componentSenseEvidence: [
      { component: "friend", source: "n:00000003-n", lemmas: ["friend"], definition: "a person regarded with affection" },
      { component: "ship", source: "n:00000004-n", lemmas: ["ship"], definition: "a vessel" }
    ],
    targetSenseEvidence: [{
      source: "n:00000001-n",
      pos: "n",
      lemmas: ["friendship"],
      definition: "a relationship between friends",
      compatibleHeadSenseIds: ["n:00000004-n"]
    }]
  };
  const prompt = buildCompoundVerificationPrompt({ record: candidate, candidates: [candidate] });
  assert.match(prompt, /a relationship between friends/u);
  assert.match(prompt, /a vessel/u);
  assert.match(prompt, /targetSenseId/u);
  assert.match(prompt, /WordNet definitions for each component/u);
  assert.match(prompt, /componentSenseIds/u);
  assert.match(prompt, /sourceGlossSenseIds/u);
  assert.match(prompt, /part-of-speech labels help choose senses but do not decide/iu);
  assert.doesNotMatch(prompt, /TARGET RECORD:/u);
  assert.doesNotMatch(prompt, /modifierEvidence/u);

  const response = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "The definition identifies a kind of ship."
  }), { candidates: [candidate] });
  assert.equal(response.valid, true);
  assert.equal(response.supportingSenseId, "n:00000001-n");
  assert.equal(response.supportingHeadSenseId, "n:00000004-n");
  assert.deepEqual(response.supportingModifierSenseIds, ["n:00000003-n"]);
  assert.deepEqual(response.supportingModifierEvidence, ["friend describes the relationship participants"]);
  assert.deepEqual(response.supportingModifierRelations, ["literal"]);
  assert.equal(response.headRelationSupported, true);

  const metaphoricalModifier = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["metaphorical"],
    rationale: "The components compose the target."
  }), { candidates: [candidate] });
  assert.equal(metaphoricalModifier.valid, true);
  assert.equal(metaphoricalModifier.verdict, "uncertain");
  assert.match(metaphoricalModifier.rationale, /non-literal/u);

  const figurativeRationale = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "The modifier contributes metaphorically to the target."
  }), { candidates: [candidate] });
  assert.equal(figurativeRationale.valid, true);
  assert.equal(figurativeRationale.verdict, "uncertain");

  const missingModifierCitation = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: [],
    modifierEvidence: [],
    modifierRelations: [],
    rationale: "The definition identifies a kind of ship."
  }), { candidates: [candidate] });
  assert.equal(missingModifierCitation.valid, false);
  assert.match(missingModifierCitation.reason, /each modifier/u);

  const inventedModifierCitation = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:99999999-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "The definition identifies a kind of ship."
  }), { candidates: [candidate] });
  assert.equal(inventedModifierCitation.valid, false);
  assert.match(inventedModifierCitation.reason, /modifier/u);

  const unsupportedHeadRelation = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000005-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "This related sense seems semantically associated."
  }), {
    candidates: [{
      ...candidate,
      componentSenseEvidence: [
        ...candidate.componentSenseEvidence,
        { component: "ship", source: "n:00000005-n", lemmas: ["ship"], definition: "a large amount" }
      ]
    }]
  });
  assert.equal(unsupportedHeadRelation.valid, true);
  assert.equal(unsupportedHeadRelation.verdict, "uncertain");
  assert.equal(unsupportedHeadRelation.headRelationSupported, false);
  assert.match(unsupportedHeadRelation.rationale, /no WordNet head relation/u);

  const missingEvidence = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:99999999-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "No supplied sense supports this."
  }), { candidates: [candidate] });
  assert.equal(missingEvidence.valid, false);
  assert.match(missingEvidence.reason, /supplied target sense/u);

  const inventedHead = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:99999999-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "The final component is a ship."
  }), { candidates: [candidate] });
  assert.equal(inventedHead.valid, false);
  assert.match(inventedHead.reason, /final component/u);

  const rationaleCitation = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000001-n",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["friend describes the relationship participants"],
    modifierRelations: ["literal"],
    rationale: "Sense n:00000001-n and head n:00000004-n support this definition."
  }), { candidates: [candidate] });
  assert.equal(rationaleCitation.valid, true);
  assert.equal(rationaleCitation.supportingSenseId, "n:00000001-n");

  const malformedNoise = parseCompoundVerificationResponse(
    `provider preamble\n{"verdict":"accept","candidateId":"${candidate.id}",`,
    { candidates: [candidate] }
  );
  assert.equal(malformedNoise.valid, false);
});

test("compact compound evidence validates ordered component senses and source-gloss polarity", () => {
  const candidate = {
    id: "conscious-state",
    target: "consciousness",
    componentGlosses: ["aware", "state"],
    pyashSequence: ["hawa", "hsta"],
    headRelationPolicy: "advisory",
    componentSenseEvidence: [
      {
        component: "aware",
        source: "a:00000001-a",
        pos: "a",
        lemmas: ["aware"],
        definition: "having knowledge",
        mappingKind: "word-suggestion",
        mappingLookupGloss: "consciousness",
        mappingLookupSenseEvidence: [{
          source: "n:00000003-n",
          pos: "n",
          lemmas: ["consciousness"],
          definition: "an alert cognitive state"
        }]
      },
      {
        component: "state",
        source: "n:00000002-n",
        pos: "n",
        lemmas: ["state"],
        definition: "a condition"
      },
      {
        component: "aware",
        source: "a:00000004-a",
        pos: "a",
        lemmas: ["unconscious"],
        definition: "not conscious",
        mappingKind: "word-suggestion",
        mappingLookupGloss: "consciousness",
        mappingLookupSenseEvidence: [{
          source: "n:00000003-n",
          pos: "n",
          lemmas: ["consciousness"],
          definition: "an alert cognitive state"
        }]
      }
    ],
    targetSenseEvidence: [{
      source: "n:00000005-n",
      pos: "n",
      definition: "an alert cognitive state"
    }]
  };
  const acceptedPayload = {
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000005-n",
    componentSenseIds: ["a:00000001-a", "n:00000002-n"],
    sourceGlossSenseIds: ["n:00000003-n", ""],
    composition: "literal",
    rationale: "The parts directly compose the target."
  };
  const accepted = parseCompoundVerificationResponse(JSON.stringify(acceptedPayload), { candidates: [candidate] });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.verdict, "accept");
  assert.deepEqual(accepted.supportingComponentSenseIds, ["a:00000001-a", "n:00000002-n"]);
  assert.deepEqual(accepted.supportingSourceGlossSenseIds, ["n:00000003-n", ""]);

  const missingGlossCitation = parseCompoundVerificationResponse(JSON.stringify({
    ...acceptedPayload,
    sourceGlossSenseIds: ["", ""]
  }), { candidates: [candidate] });
  assert.equal(missingGlossCitation.valid, false);
  assert.match(missingGlossCitation.reason, /word-suggestion component/u);

  const wrongOrder = parseCompoundVerificationResponse(JSON.stringify({
    ...acceptedPayload,
    componentSenseIds: ["n:00000002-n", "a:00000001-a"]
  }), { candidates: [candidate] });
  assert.equal(wrongOrder.valid, false);
  assert.match(wrongOrder.reason, /linked sense for component/u);

  const reversedPolarity = parseCompoundVerificationResponse(JSON.stringify({
    ...acceptedPayload,
    componentSenseIds: ["a:00000004-a", "n:00000002-n"]
  }), { candidates: [candidate] });
  assert.equal(reversedPolarity.valid, true);
  assert.equal(reversedPolarity.verdict, "reject");
  assert.match(reversedPolarity.rationale, /reverses source gloss polarity/u);

  const nonliteral = parseCompoundVerificationResponse(JSON.stringify({
    ...acceptedPayload,
    composition: "nonliteral"
  }), { candidates: [candidate] });
  assert.equal(nonliteral.valid, true);
  assert.equal(nonliteral.verdict, "uncertain");
});

test("compound verifier exposes POS evidence without using it as an eligibility gate", () => {
  const candidate = {
    id: "bear-duty-candidate",
    target: "attend",
    targetPartOfSpeech: "v",
    sourceMorphemes: ["duty", "bear"],
    componentGlosses: ["duty", "bear"],
    pyashSequence: ["duty", "bear"],
    sourceLanguages: ["chinese", "french", "russian", "hindi"],
    sourceComponentGlossesByLanguage: {
      chinese: ["bear", "responsibility"],
      french: ["carry", "responsibility"],
      russian: ["bear", "duty"],
      hindi: ["bear", "responsibility"]
    },
    sourceTranslationMorphemesByLanguage: { chinese: ["bear", "responsibility"] },
    sourceTranslationGlossesByLanguage: { chinese: ["bear", "responsibility"] },
    sourceComponentIndexesByLanguage: { chinese: [1, 0] },
    componentSenseEvidence: [
      { component: "duty", source: "n:00000003-n", pos: "n", lemmas: ["duty"], definition: "an obligation" },
      { component: "bear", source: "n:00000004-n", pos: "n", lemmas: ["bear"], definition: "a large mammal" },
      { component: "bear", source: "v:00000005-v", pos: "v", lemmas: ["bear"], definition: "have or carry" }
    ],
    targetSenseEvidence: [{ source: "v:00000001-v", pos: "v", lemmas: ["attend"], definition: "take charge of" }]
  };
  const prompt = buildCompoundVerificationPrompt({ record: candidate, candidates: [candidate] });
  assert.match(prompt, /TARGET: .*"pos":"v"/u);
  assert.match(prompt, /part-of-speech labels help choose senses but do not decide whether a compound is eligible/iu);
  assert.match(prompt, /SOURCE LANGUAGE DECOMPOSITIONS/u);
  assert.match(prompt, /spelling alone is insufficient/u);
  assert.match(prompt, /"language":"chinese"/u);
  assert.match(prompt, /"sourceComponentIndexes":\{"chinese":\[1,0\]/u);
  assert.match(prompt, /"surface":"responsibility","gloss":"responsibility"/u);
  const matchingHeadPos = prompt.indexOf('"id":"v:00000005-v","pos":"v"');
  const unrelatedHeadPos = prompt.indexOf('"id":"n:00000004-n","pos":"n"');
  assert.ok(matchingHeadPos >= 0 && unrelatedHeadPos > matchingHeadPos);
  assert.match(prompt, /"id":"n:00000003-n","pos":"n"/u);

  const wrongPos = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "v:00000001-v",
    headSenseId: "n:00000004-n",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["duty contributes an obligation"],
    modifierRelations: ["literal"],
    rationale: "The parts compose the target."
  }), { candidates: [candidate] });
  assert.equal(wrongPos.valid, true);

  const matchingPos = parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    headKind: "lexical-head",
    targetSenseId: "v:00000001-v",
    headSenseId: "v:00000005-v",
    modifierSenseIds: ["n:00000003-n"],
    modifierEvidence: ["duty contributes an obligation"],
    modifierRelations: ["literal"],
    rationale: "The parts compose the target."
  }), { candidates: [candidate] });
  assert.equal(matchingPos.valid, true);
});

test("compound decision revisions retain prior verdict summaries and re-open stale candidates", () => {
  const prior = wordNetCompoundDecisionRecord({
    id: "candidate-old",
    target: "friendship",
    pyashSequence: ["hfre", "hship"],
    status: "accepted-llm",
    decisionRevision: "sense-v1"
  });
  const current = wordNetCompoundDecisionRecord({
    ...prior,
    status: "rejected-llm",
    decisionRevision: "sense-v2",
    previousDecision: { decisionRevision: prior.decisionRevision, status: prior.status }
  });
  const parsed = parseEnglishWordNetCompoundDecisions(renderEnglishWordNetCompoundDecisions([current])).rows[0];
  assert.equal(parsed.status, "rejected-llm");
  assert.deepEqual(parsed.previousDecision, { decisionRevision: "sense-v1", status: "accepted-llm" });
});

test("WordNet compound gloss index projects canonical senses and preserves definitions", () => {
  const decision = {
    candidateId: "sense-compound-111111111111111111111111",
    target: "brighten",
    senseId: "v:02777127-v",
    status: "accepted-llm",
    pyashSequence: ["kwan", "hbin"],
    targetSenseEvidence: [{
      source: "v:02777127-v",
      pos: "v",
      lemmas: ["brighten", "clear", "clear up", "light up"],
      definition: "become clear"
    }]
  };
  const record = {
    senseId: decision.senseId,
    target: decision.target,
    targetPartOfSpeech: "v",
    pyashSequence: decision.pyashSequence,
    verificationDecisionIds: [decision.candidateId]
  };
  const glosses = buildEnglishWordNetCompoundGlosses([record], [decision]);
  const rendered = renderEnglishWordNetCompoundGlosses(glosses);
  const parsed = parseEnglishWordNetCompoundGlosses(rendered);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.format, "english-wordnet-compound-sense-glosses-v2");
  assert.ok(rendered.includes(`su text "${decision.candidateId}"`));
  assert.ok(!rendered.includes(`su text "${decision.senseId} | ${decision.target} | become clear"`));
  assert.throws(
    () => parseEnglishWordNetCompoundGlosses(rendered.replace("glosses-v2", "glosses-v1")),
    (error) => error?.code === "invalid-english-wordnet-compound-glosses"
  );
  assert.deepEqual(parsed.records[0], {
    senseId: decision.senseId,
    target: decision.target,
    partOfSpeech: "v",
    lemmas: ["brighten", "clear", "clear up", "light up"],
    definition: "become clear",
    pyashSequence: ["kwan", "hbin"],
    decisionId: decision.candidateId
  });
});

test("WordNet compound gloss rows reject duplicate decision identities", () => {
  const record = {
    senseId: "v:02777127-v",
    target: "brighten",
    definition: "become clear",
    decisionId: "sense-compound-111111111111111111111111"
  };
  assert.throws(
    () => renderEnglishWordNetCompoundGlosses([record, { ...record }]),
    (error) => error?.code === "invalid-english-wordnet-compound-glosses"
  );
});
