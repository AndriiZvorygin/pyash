import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  resolveWordNetSenseCompoundMinimumTagCount,
  resolveWordNetSenseCompoundSenseIds,
  runWordNetSenseCompoundRefinery
} from "../program/library/translation/wordnet_sense_compound_refinery.mjs";
import { parseWordNetSenseTranslationCache } from "../program/library/translation/english_wordnet_sense_compounds.mjs";

test("sense compound launch overrides cannot exceed the configured batch limit", () => {
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64), 64);
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64, 16), 16);
  assert.equal(resolveWordNetSenseCompoundMaximumSenses(64, 100000), 64);
  assert.throws(() => resolveWordNetSenseCompoundMaximumSenses(64, 0), /positive integer/u);
});

test("sense compound launch can raise its minimum tag-count threshold", () => {
  assert.equal(resolveWordNetSenseCompoundMinimumTagCount(1), 1);
  assert.equal(resolveWordNetSenseCompoundMinimumTagCount(1, 2), 2);
  assert.throws(() => resolveWordNetSenseCompoundMinimumTagCount(1, -1), /nonnegative integer/u);
  assert.throws(() => resolveWordNetSenseCompoundMinimumTagCount(1, 1.5), /nonnegative integer/u);
});

test("sense compound launch can select exact WordNet senses for a focused retry", () => {
  assert.equal(resolveWordNetSenseCompoundSenseIds(undefined), null);
  assert.deepEqual(resolveWordNetSenseCompoundSenseIds(["v:00150596-v", "v:01185870-v", "v:00150596-v"]), [
    "v:00150596-v",
    "v:01185870-v"
  ]);
  assert.throws(() => resolveWordNetSenseCompoundSenseIds([]), /nonempty array/u);
  assert.throws(() => resolveWordNetSenseCompoundSenseIds(["accord"]), /invalid WordNet sense id/u);
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
  let inventoryRevision = false;
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
      resolveWord: (word) => {
        const coverage = ({
          friend: { coverageType: "atomic", canonicalEnglish: "friend", pyashSequence: ["hfre"] },
          relationship: { coverageType: "atomic", canonicalEnglish: "relationship", pyashSequence: ["hlak"] },
          affection: { coverageType: "atomic", canonicalEnglish: "affection", pyashSequence: ["haff"] },
          grammar: { coverageType: "grammar", canonicalEnglish: "comparative_degree_", pyashSequence: ["trah"] }
        })[word];
        return coverage ?? null;
      }
    }),
    loadBridges: async () => ({
      entries: [
        { source: "n:00000020-n", target: "friend", targetPartOfSpeech: "n", certainty: "deterministic", evidence: "test", lemmas: ["friend"], definition: "a person attached by affection" },
        { source: "n:00000030-n", target: "relationship", targetPartOfSpeech: "n", certainty: "deterministic", evidence: "test", lemmas: ["relationship"], definition: "a relation between entities" },
        ...(inventoryRevision ? [
          { source: "n:00000040-n", target: "affection", targetPartOfSpeech: "n", certainty: "deterministic", evidence: "inventory revision test", lemmas: ["affection"], definition: "a feeling of affection" }
        ] : [])
      ]
    }),
    loadLayerIndex: async () => ({ byWord: new Map([["hfre", 16], ["hlak", 16], ["haff", 16]]) }),
    loadLemmaCatalog: async () => ({ entries: [] }),
    loadWordNetCompoundIndex: async () => [],
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
    assert.equal(result.result["pending-sense-count"], 0);
    assert.equal(result.result["failed-sense-count"], 1);
    assert.equal(result.remainingSenseCount, 0);
    const cacheSource = await readFile(path.join(result.artifactDirectory, "sense-translations.pya"), "utf8");
    const progressSource = await readFile(path.join(result.artifactDirectory, "progress.pya"), "utf8");
    assert.equal(parseWordNetSenseTranslationCache(cacheSource).bySense.get(sense.senseId).status, "complete");
    assert.match(progressSource, /failed/u);
    forget();
    clearSignatureHandlers();
    for (const signature of builtInSignatures) registerSignatureHandler(signature);
    inventoryRevision = true;
    const inventoryChangedResume = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: {},
      dependencies
    });
    assert.equal(inventoryChangedResume.selectedSenseCount, 0);
    assert.equal(inventoryChangedResume.remainingSenseCount, 0);
    assert.equal(translationSubmitCount, 2);
    const resumed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies
    });
    assert.equal(resumed.candidateCount, 1);
    assert.equal(resumed.result["accepted-sense-count"], 1);
    const resumedComposition = await readFile(path.join(resumed.artifactDirectory, "component-compositions.pya"), "utf8");
    const legacyComposition = resumedComposition.replace(/su text "meta:([^"]+)" ob text/gu, 'su text "$1" ob text');
    await writeFile(path.join(resumed.artifactDirectory, "component-compositions.pya"), legacyComposition, "utf8");
    const completed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
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
    assert.deepEqual(savedDecisionBatchSizes, [1, 1, 1, 1]);
    assert.equal(compositionPrompts.length, 2);
    assert.match(compositionPrompts[0], /"gloss": "friend",\s+"atoms": \[\s+"friend"/u);
    assert.equal(completed.remainingSenseCount, 0);
    assert.equal(completed.result["remaining-sense-count"], 0);
    assert.equal(translationSubmitCount, 2);
    assert.ok(suggestedTerms.includes("friend"));
    assert.ok(suggestedTerms.includes("companion"));
    assert.deepEqual(recordedPromotions.map((record) => record.pyashSequence), [["hfre", "hlak"], ["hfre", "hlak"]]);
    const completeCache = await readFile(path.join(completed.artifactDirectory, "sense-translations.pya"), "utf8");
    const worklistSource = await readFile(path.join(completed.artifactDirectory, "worklist.pya"), "utf8");
    const candidateSource = await readFile(path.join(completed.artifactDirectory, "compound-candidates.pya"), "utf8");
    const completeProgress = await readFile(path.join(completed.artifactDirectory, "progress.pya"), "utf8");
    const allCompositions = await readFile(path.join(completed.artifactDirectory, "component-compositions.pya"), "utf8");
    assert.deepEqual(artifactRows(allCompositions).map(({ attempt, status }) => ({ attempt, status })), [
      { attempt: 1, status: "compound" }
    ]);
    assert.equal(parseWordNetSenseTranslationCache(completeCache).bySense.get(sense.senseId).status, "complete");
    assert.equal(buildProgram(worklistSource).sentences.find((sentence) => sentence.su?.text === "meta:minimum-tag-count")?.ob?.text, "1");
    assert.equal(buildProgram(worklistSource).sentences.find((sentence) => sentence.su?.text === "meta:prompt-revision")?.ob?.text, "sense-translation-gloss-alternatives-v11");
    assert.match(candidateSource, /friendship/u);
    assert.match(completeProgress, /accepted/u);

    await writeFile(
      path.join(completed.artifactDirectory, "progress.pya"),
      completeProgress.replaceAll("sense-translation-gloss-alternatives-v11", "sense-translation-gloss-alternatives-v8"),
      "utf8"
    );
    const stalePromptResume = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: {},
      dependencies
    });
    assert.equal(stalePromptResume.selectedSenseCount, 0);
    assert.equal(stalePromptResume.remainingSenseCount, 0);

    for (const [index, status] of ["processing", "failed"].entries()) {
      const historicalRunId = `wordnet-sense-compounds-${String.fromCharCode(97 + index).repeat(24)}`;
      const historicalDirectory = path.join(artifactRoot, historicalRunId);
      await mkdir(historicalDirectory, { recursive: true });
      const historicalRecord = {
        id: sense.senseId,
        senseId: sense.senseId,
        status,
        sourceHash: `older-wordnet-test-hash-${index}`
      };
      await writeFile(path.join(historicalDirectory, "progress.pya"), [
        "su name translation_wordnet_sense_compound_progress be map def",
        'su text "format" ob text "wordnet-sense-compound-progress-v1" ya',
        `su text ${JSON.stringify(sense.senseId)} ob text ${JSON.stringify(JSON.stringify(historicalRecord))} ya`,
        "prah",
        ""
      ].join("\n"), "utf8");
    }
    const crossRunFiltered = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-cross-run-filter-test",
      initialize: false,
      configuration: {},
      dependencies
    });
    assert.equal(crossRunFiltered.selectedSenseCount, 0);
    assert.equal(crossRunFiltered.remainingSenseCount, 0);

    const canonicalRoot = await mkdtemp(path.join(os.tmpdir(), "pyash-sense-compound-canonical-filter-"));
    const canonicalFiltered = await runWordNetSenseCompoundRefinery({
      artifactRoot: canonicalRoot,
      runId: "sense-compound-canonical-filter-test",
      initialize: false,
      configuration: {},
      dependencies: {
        ...dependencies,
        loadWordNetCompoundIndex: async () => [{ senseId: sense.senseId, target: "friendship" }]
      }
    });
    assert.equal(canonicalFiltered.selectedSenseCount, 0);
    assert.equal(canonicalFiltered.remainingSenseCount, 0);
    await assert.rejects(runWordNetSenseCompoundRefinery({
      artifactRoot: canonicalRoot,
      runId: "sense-compound-explicit-canonical-retry-test",
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies: {
        ...dependencies,
        loadWordNetCompoundIndex: async () => [{ senseId: sense.senseId, target: "friendship" }]
      }
    }), /not eligible for compound composition/u);
    await rm(canonicalRoot, { recursive: true, force: true });

    const focusedRetry = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-test",
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies
    });
    assert.equal(focusedRetry.selectedSenseCount, 1);
    assert.equal(focusedRetry.candidateCount, 1);
    assert.equal(translationSubmitCount, 2);
    assert.equal(compositionResponseCount, 2);

    const interruptedRunId = "sense-compound-interrupted-claim-test";
    await assert.rejects(runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: interruptedRunId,
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies: {
        ...dependencies,
        suggestVocabulary: async () => {
          throw new Error("simulated stage interruption");
        }
      }
    }));
    const interruptedArtifactDirectory = path.join(artifactRoot, interruptedRunId);
    const claimedProgress = await readFile(path.join(interruptedArtifactDirectory, "progress.pya"), "utf8");
    assert.match(claimedProgress, /processing/u);
    const resumedAfterInterruption = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: interruptedRunId,
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies
    });
    assert.equal(resumedAfterInterruption.selectedSenseCount, 1);
    const interruptedProgress = await readFile(path.join(interruptedArtifactDirectory, "progress.pya"), "utf8");
    assert.match(interruptedProgress, /accepted/u);

    const failed = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-translation-failure-test",
      initialize: false,
      configuration: { maximumSenses: 1, senseIds: [sense.senseId] },
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
    const languageFailures = buildProgram(failureArtifact).sentences
      .filter((sentence) => sentence.su?.text?.startsWith("translation-failure-") && typeof sentence.ob?.text === "string")
      .map((sentence) => JSON.parse(sentence.ob.text));
    assert.deepEqual(languageFailures.map((row) => row.language).sort(), ["chinese", "english", "french", "hindi", "russian"]);
    assert.ok(languageFailures.every((row) => row.status === "failed" && row.attemptErrors.length === 2));

    const partialHandles = new Map();
    const partialRun = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: "sense-compound-partial-translation-test",
      initialize: false,
      configuration: { maximumSenses: 1, senseIds: [sense.senseId] },
      dependencies: {
        ...dependencies,
        translationTransport: {
          async submit({ handleId, attempt, languages }) {
            partialHandles.set(`${handleId}-translate-${attempt}`, languages);
            return { status: "queued" };
          },
          async await(handleId) {
            const requestedLanguages = partialHandles.get(handleId);
            if (requestedLanguages.includes("chinese")) {
              return JSON.stringify({
                senseId: sense.senseId,
                translations: [{
                  language: "chinese",
                  surface: "朋友关系",
                  composition: "compound",
                  compositionEvidence: "friend + relationship",
                  components: [
                    { surface: "朋友", gloss: "friend", role: "lexical" },
                    { surface: "关系", gloss: "relationship", role: "lexical" }
                  ]
                }]
              });
            }
            return "noise without a bounded JSON object";
          }
        },
        composeSenseCompound: async ({ input }) => JSON.stringify({
          verdict: "compound",
          atoms: ["friend", "relationship"]
        })
      }
    });
    assert.equal(partialRun.candidateCount, 1);
    assert.equal(partialRun.result["accepted-count"], 1);
    assert.equal(partialRun.translationFailureCount, 1);
    assert.equal(partialRun.result["translation-failed-language-count"], 4);
    const partialCache = await readFile(path.join(partialRun.artifactDirectory, "sense-translations.pya"), "utf8");
    assert.equal(parseWordNetSenseTranslationCache(partialCache).bySense.get(sense.senseId).status, "partial");
    const partialProgress = await readFile(path.join(partialRun.artifactDirectory, "progress.pya"), "utf8");
    assert.match(partialProgress, /accepted/u);

    let invalidChoiceCallCount = 0;
    const invalidChoiceDependencies = {
      ...dependencies,
      composeSenseCompound: async () => {
        invalidChoiceCallCount += 1;
        return JSON.stringify({
          verdict: "compound",
          atoms: ["friend", "friend"]
        });
      }
    };
    const retryRunId = "sense-compound-choice-attempt-limit-test";
    const firstInvalidChoice = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: retryRunId,
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies: invalidChoiceDependencies
    });
    assert.equal(firstInvalidChoice.result["pending-sense-count"], 0);
    assert.equal(firstInvalidChoice.result["failed-sense-count"], 1);
    const secondInvalidChoice = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: retryRunId,
      initialize: false,
      configuration: { senseIds: [sense.senseId] },
      dependencies: invalidChoiceDependencies
    });
    assert.equal(secondInvalidChoice.result["uncertain-no-candidate-sense-count"], 1);
    const terminalInvalidChoice = await runWordNetSenseCompoundRefinery({
      artifactRoot,
      runId: retryRunId,
      initialize: false,
      dependencies: invalidChoiceDependencies
    });
    assert.equal(terminalInvalidChoice.selectedSenseCount, 0);
    assert.equal(invalidChoiceCallCount, 2);
  } finally {
    if (priorFixture === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = priorFixture;
    forget();
    clearSignatureHandlers();
    for (const signature of builtInSignatures) registerSignatureHandler(signature);
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
