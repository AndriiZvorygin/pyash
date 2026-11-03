import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { clearSignatureHandlers, registerSignatureHandler } from "../program/bridge/signature.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { runWordNetSenseCompoundRefinery } from "../program/library/translation/wordnet_sense_compound_refinery.mjs";
import { parseWordNetSenseTranslationCache } from "../program/library/translation/english_wordnet_sense_compounds.mjs";

test("sense compound refinery links, composes, verifies and records one complete sense", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-compounds-"));
  const priorFixture = process.env.PYA_MIND_RESPONSE;
  delete process.env.PYA_MIND_RESPONSE;
  forget();
  clearSignatureHandlers();
  for (const signature of builtInSignatures) registerSignatureHandler(signature);
  const sense = {
    source: "n:00000010-n",
    senseId: "n:00000010-n",
    pos: "n",
    synset: "00000010-n",
    lemmas: ["friendship"],
    gloss: "a relationship between friends; sample gloss omitted",
    candidates: [{ lemma: "friendship", rank: 1200, tagCount: 4 }]
  };
  const senseByHandle = new Map();
  const recordedPromotions = [];
  let translationSubmitCount = 0;
  const suggestedTerms = [];
  const dependencies = {
    prepareAllocation: async () => ({
      sourceHash: "wordnet-test-hash",
      coverageHash: "coverage-test-hash",
      allocationConfig: { "compound-verification-revision": "test-revision" },
      allocation: { residual: [sense], assignments: [] },
      preservedTargetIds: [],
      wordnetIndex: {
        relations: [{ source: "n:00000010-n", target: "n:00000030-n", relation: "hypernym" }]
      },
      resolveWord: (word) => ({
        coverageType: "atomic",
        canonicalEnglish: word,
        pyashSequence: word === "friend" ? ["hfre"] : ["hlak"]
      })
    }),
    loadBridges: async () => ({
      entries: [
        { source: "n:00000020-n", target: "friend", targetPartOfSpeech: "n", certainty: "deterministic", evidence: "test", lemmas: ["friend"], definition: "a person attached by affection" },
        { source: "n:00000030-n", target: "relationship", targetPartOfSpeech: "n", certainty: "deterministic", evidence: "test", lemmas: ["relationship"], definition: "a relation between entities" }
      ]
    }),
    loadLayerIndex: async () => ({ byWord: new Map([["hfre", 16], ["hlak", 16]]) }),
    loadLemmaCatalog: async () => ({ entries: [] }),
    translationTransport: {
      async submit({ sense: target, languages, handleId, attempt }) {
        translationSubmitCount += 1;
        const id = `${handleId}-translate-${attempt}`;
        senseByHandle.set(id, { sense: target, languages });
        return { status: "queued", handleId: id };
      },
      async await(handleId) {
        const { sense: target, languages: requestedLanguages } = senseByHandle.get(handleId);
        const languages = translationSubmitCount === 1 ? requestedLanguages.slice(0, 1) : requestedLanguages;
        return JSON.stringify({
          senseId: target.senseId,
          translations: languages.map((language) => ({
            language,
            surface: `${language} compound`,
            composition: "compound",
            components: [
              { surface: `${language} friend`, gloss: language === "chinese" ? "friend/companion" : "friend" },
              { surface: `${language} relationship`, gloss: "relationship" }
            ]
          }))
        });
      }
    },
    suggestVocabulary: async (args) => {
      suggestedTerms.push(...args.filter((value) => value !== "--text"));
      return {
        suggestionRecords: ["friend", "relationship"].map((word) => ({
          input: word,
          mappings: [{
            word,
            coverageType: "atomic",
            status: "covered",
            pyacSequence: [word === "friend" ? "hfre" : "hlak"]
          }]
        }))
      };
    },
    loadDecisions: async () => ({ rows: [] }),
    decisionsPath: path.join(artifactRoot, "decisions.pya"),
    verifyCandidates: async (records, onRecord) => {
      for (const record of records) {
        const modifier = record.componentGlosses[0];
        await onRecord({ record: {
          ...record,
          status: "accepted-llm",
          verificationSenseId: record.senseId,
          verificationHeadSenseId: record.componentSenseEvidence.at(-1).source,
          verificationHeadRelation: "supported",
          verificationModifierSenseIds: [record.componentSenseEvidence.find((row) => row.component === modifier).source],
          verificationModifierEvidence: ["literal modifier in the source compound"],
          verificationModifierRelations: ["literal"]
        } });
      }
    },
    promoteAccepted: async (decisions) => {
      const promoted = decisions.map((decision) => ({ ...decision, promotionStatus: "promoted-to-derived-index" }));
      recordedPromotions.push(...promoted);
      return { decisions: promoted, promotions: promoted, conflicts: [] };
    }
  };
  try {
    const result = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      dependencies
    });

    assert.equal(result.selectedSenseCount, 1);
    assert.equal(result.candidateCount, 0);
    assert.equal(result.result["accepted-count"], 0);
    assert.equal(result.remainingSenseCount, 1);
    const cacheSource = await readFile(path.join(result.artifactDirectory, "sense-translations.pya"), "utf8");
    const progressSource = await readFile(path.join(result.artifactDirectory, "progress.pya"), "utf8");
    assert.equal(parseWordNetSenseTranslationCache(cacheSource).bySense.get(sense.senseId).status, "partial");
    assert.match(progressSource, /retry/u);
    const resumed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      dependencies
    });
    assert.equal(resumed.selectedSenseCount, 1);
    assert.equal(resumed.candidateCount, 2);
    assert.equal(resumed.result["accepted-count"], 2);
    assert.equal(resumed.remainingSenseCount, 0);
    assert.equal(resumed.result["remaining-sense-count"], 0);
    assert.equal(translationSubmitCount, 2);
    assert.ok(suggestedTerms.includes("friend"));
    assert.ok(suggestedTerms.includes("companion"));
    assert.deepEqual(recordedPromotions.map((record) => record.pyashSequence), [
      ["hfre", "hlak"],
      ["hlak", "hfre"]
    ]);
    const completeCache = await readFile(path.join(resumed.artifactDirectory, "sense-translations.pya"), "utf8");
    const candidateSource = await readFile(path.join(resumed.artifactDirectory, "compound-candidates.pya"), "utf8");
    const completeProgress = await readFile(path.join(resumed.artifactDirectory, "progress.pya"), "utf8");
    assert.equal(parseWordNetSenseTranslationCache(completeCache).bySense.get(sense.senseId).status, "complete");
    assert.match(candidateSource, /friendship/u);
    assert.match(completeProgress, /accepted/u);
  } finally {
    if (priorFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = priorFixture;
    forget();
    clearSignatureHandlers();
    for (const signature of builtInSignatures) registerSignatureHandler(signature);
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
