import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { clearSignatureHandlers, registerSignatureHandler } from "../program/bridge/signature.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildProgram } from "../program/program.mjs";
import {
  resolveWordNetSenseCompoundMaximumSenses,
  runWordNetSenseCompoundRefinery
} from "../program/library/translation/wordnet_sense_compound_refinery.mjs";
import { parseWordNetSenseTranslationCache } from "../program/library/translation/english_wordnet_sense_compounds.mjs";

test("sense compound launch overrides cannot exceed the configured batch limit", () => {
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64), 64);
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64, 16), 16);
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64, 100000), 64);
  assert.throws(() => resolveWordNetSenseCompoundMaximumSenses(64, 0), /positive integer/u);
});

test("sense compound refinery links, composes, decides, and records one complete sense", async () => {
  const artifactRows = (source) => buildProgram(source).sentences
    .filter((sentence) => String(sentence.su?.text ?? "").startsWith("component-composition-")
      && typeof sentence.ob?.text === "string")
    .map((sentence) => JSON.parse(sentence.ob.text));
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
  const savedDecisionBatchSizes = [];
  const compositionPrompts = [];
  let compositionResponseCount = 0;
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
            compositionEvidence: "friend + relationship composes friendship",
            components: [
              { surface: `${language} friend`, gloss: language === "chinese" ? "friend/companion" : "friend", role: "lexical" },
              { surface: `${language} relationship`, gloss: "relationship", role: "lexical" }
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
            kind: "root",
            status: "covered",
            pyacSequence: [word === "friend" ? "hfre" : "hlak"]
          }]
        }))
      };
    },
    loadDecisions: async () => ({ rows: [] }),
    saveDecisions: async (rows) => savedDecisionBatchSizes.push(rows.length),
    decisionsPath: path.join(artifactRoot, "decisions.pya"),
    composeSenseCompound: async ({ input }) => {
      compositionPrompts.push(input.prompt);
      compositionResponseCount += 1;
      if (compositionResponseCount === 1) {
        return JSON.stringify({
          verdict: "compound",
          atoms: [input.sourceOptions[0].word]
        });
      }
      return JSON.stringify({
        verdict: "compound",
        atoms: ["friend", "relationship"]
      });
    },
    verifyCandidates: async () => {
      throw new Error("the separate compound verifier must not run");
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
      configuration: {},
      dependencies
    });

    assert.equal(result.selectedSenseCount, 1);
    assert.equal(result.candidateCount, 0);
    assert.equal(result.result["accepted-count"], 0);
    assert.equal(result.result["selected-sense-count"], 1);
    assert.equal(result.result["candidate-sense-count"], 0);
    assert.equal(result.result["pending-sense-count"], 1);
    assert.equal(result.remainingSenseCount, 1);
    const cacheSource = await readFile(path.join(result.artifactDirectory, "sense-translations.pya"), "utf8");
    const progressSource = await readFile(path.join(result.artifactDirectory, "progress.pya"), "utf8");
    assert.equal(parseWordNetSenseTranslationCache(cacheSource).bySense.get(sense.senseId).status, "partial");
    assert.match(progressSource, /retry/u);
    forget();
    clearSignatureHandlers();
    for (const signature of builtInSignatures) registerSignatureHandler(signature);
    const resumed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: {},
      dependencies
    });
    assert.equal(resumed.candidateCount, 0);
    assert.equal(resumed.result["pending-sense-count"], 1);
    const failedComposition = await readFile(path.join(resumed.artifactDirectory, "component-compositions.pya"), "utf8");
    const failedRows = artifactRows(failedComposition);
    assert.equal(failedRows.length, 1);
    assert.equal(failedRows[0].attempt, 1);
    assert.equal(failedRows[0].status, "failed");
    const legacyComposition = failedComposition.replace(/su text "meta:([^"]+)" ob text/gu, 'su text "$1" ob text');
    await writeFile(path.join(resumed.artifactDirectory, "component-compositions.pya"), legacyComposition, "utf8");
    const completed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: {},
      dependencies
    });
    const decisionSource = await readFile(completed.result["decision-path"], "utf8");
    assert.equal(completed.selectedSenseCount, 1);
    assert.equal(completed.candidateCount, 1);
    assert.equal(completed.result["accepted-count"], 1, decisionSource);
    assert.equal(completed.result["selected-sense-count"], 1);
    assert.equal(completed.result["candidate-sense-count"], 1);
    assert.equal(completed.result["accepted-sense-count"], 1);
    assert.equal(completed.result["uncertain-sense-count"], 0);
    assert.equal(completed.result["rejected-sense-count"], 0);
    assert.equal(completed.result["accepted-candidate-sense-percent"], 100);
    assert.equal(completed.result["component-choice-decision-count"], 1);
    assert.equal(completed.result["accepted-component-choice-count"], 1);
    assert.equal(completed.result["rejected-count"], 0);
    assert.equal(completed.result["accepted-component-choice-percent"], 100);
    assert.equal(completed.result["pending-component-choice-count"], 0);
    assert.deepEqual(savedDecisionBatchSizes, [1, 1]);
    assert.equal(compositionPrompts.length, 2);
    assert.match(compositionPrompts[0], /"source": "chinese friend",\s+"gloss": "friend",\s+"atoms": \[\s+"friend"/u);
    assert.equal(completed.remainingSenseCount, 0);
    assert.equal(completed.result["remaining-sense-count"], 0);
    assert.equal(translationSubmitCount, 2);
    assert.ok(suggestedTerms.includes("friend"));
    assert.ok(suggestedTerms.includes("companion"));
    assert.deepEqual(recordedPromotions.map((record) => record.pyashSequence), [["hfre", "hlak"]]);
    const completeCache = await readFile(path.join(completed.artifactDirectory, "sense-translations.pya"), "utf8");
    const worklistSource = await readFile(path.join(completed.artifactDirectory, "worklist.pya"), "utf8");
    const candidateSource = await readFile(path.join(completed.artifactDirectory, "compound-candidates.pya"), "utf8");
    const completeProgress = await readFile(path.join(completed.artifactDirectory, "progress.pya"), "utf8");
    const allCompositions = await readFile(path.join(completed.artifactDirectory, "component-compositions.pya"), "utf8");
    assert.deepEqual(artifactRows(allCompositions).map(({ attempt, status }) => ({ attempt, status })), [
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "compound" }
    ]);
    assert.equal(parseWordNetSenseTranslationCache(completeCache).bySense.get(sense.senseId).status, "complete");
    assert.equal(buildProgram(worklistSource).sentences.find((sentence) => sentence.su?.text === "meta:minimum-tag-count")?.ob?.text, "2");
    assert.match(candidateSource, /friendship/u);
    assert.match(completeProgress, /accepted/u);

    const failed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-translation-failure-test",
      initialize: false,
      configuration: { maximumSenses: 1 },
      dependencies: {
        ...dependencies,
        translationTransport: {
          async submit() {
            return { status: "queued" };
          },
          async await() {
            return "not valid translation JSON";
          }
        }
      }
    });
    assert.equal(failed.translationFailureCount, 1);
    assert.equal(failed.result["translation-failure-count"], 1);
    const failureArtifact = await readFile(path.join(failed.artifactDirectory, "translation-failures.pya"), "utf8");
    assert.match(failureArtifact, /sense translation response has no bounded JSON object/u);
  } finally {
    if (priorFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = priorFixture;
    forget();
    clearSignatureHandlers();
    for (const signature of builtInSignatures) registerSignatureHandler(signature);
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
