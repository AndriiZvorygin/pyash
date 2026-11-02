import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedDecisionsForRevision,
  acceptedDecision,
  groupWordNetCompoundCandidates,
  selectCurrentRevisionCompounds,
  wordNetCompoundDecisionRecord
} from "../command/wordnet_frequency_compound_sweep.mjs";
import {
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

test("compound head compatibility requires a same-part-of-speech directed hypernym path", () => {
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
});

test("WordNet compound promotion requires cited senses and a supported head relation", () => {
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
      compatibleHeadSenseIds: ["n:00000004-n"]
    },
    {
      source: "n:00000002-n",
      pos: "n",
      lemmas: ["friendship"],
      definition: "a social relation",
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
  assert.equal(withoutHeadRelation[0].disposition, "no-wordnet-head-evidence");
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
  assert.match(prompt, /literally a kind of the final component/u);
  assert.match(prompt, /targetSenseId/u);
  assert.match(prompt, /headSenseId/u);
  assert.match(prompt, /modifierSenseIds/u);
  assert.match(prompt, /modifierEvidence/u);
  assert.match(prompt, /classify that contribution as literal/u);
  assert.match(prompt, /metaphor, figurative meaning, symbolism, wordplay, or association/u);

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
