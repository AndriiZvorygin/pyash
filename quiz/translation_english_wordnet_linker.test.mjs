import test from "node:test";
import assert from "node:assert/strict";

import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import {
  applyEnglishWordNetSenseLinkResponse,
  buildEnglishWordNetSenseLinkInventory,
  buildEnglishWordNetSenseLinkPrompt,
  buildEnglishWordNetSenseLinkRecords,
  createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter,
  createQueuedMindEnglishWordNetSenseLinkSubmitter,
  estimateEnglishWordNetSenseLinkPromptTokens,
  loadEnglishWordNetLinkerConfig,
  parseEnglishWordNetSenseLinkResponse,
  reconcileEnglishWordNetSenseLinks,
  renderEnglishWordNetSenseLinksPya,
  submitEnglishWordNetSenseLinks,
  wordNetSenseLinkQueueHandle
} from "../program/verbs/exchange/translation/english_wordnet_linker.mjs";
import { parseEnglishWordNetBridgeCatalog } from "../program/verbs/exchange/translation/english_wordnet_bridges.mjs";
import {
  loadTranslationModelCard,
  parseTranslationModelCards,
  selectTranslationModelCard
} from "../program/verbs/exchange/translation/translation_model_cards.mjs";

function fixtureIndex() {
  return buildEnglishWordNetIndex({
    rows: [{
      id: "v:alpha:florp",
      pos: "v",
      synset: "alpha",
      senseKey: "alpha",
      lemma: "florp",
      gloss: "undergo an emotional sensation"
    }, {
      id: "v:beta:blorp",
      pos: "v",
      synset: "beta",
      senseKey: "beta",
      lemma: "blorp",
      gloss: "a rare unresolved action"
    }, {
      id: "v:gamma:glorp",
      pos: "v",
      synset: "gamma",
      senseKey: "gamma",
      lemma: "glorp",
      gloss: "touch or sense something"
    }]
  });
}

function resolver(word) {
  return {
    florp: { coverageType: "atomic", canonicalEnglish: "experience", pyashSequence: ["tyap"] },
    experience: { coverageType: "atomic", pyashSequence: ["tyap"] },
    touch: { coverageType: "atomic", pyashSequence: ["tcum"] },
    sense: { coverageType: "atomic", pyashSequence: ["hyes"] }
  }[word] ?? null;
}

test("WordNet linker creates stable one-record-per-sense batches", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["florp", "blorp", "glorp"]
  });
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.source), ["v:alpha", "v:beta", "v:gamma"]);
  assert.equal(records[0].status, "accepted-edge");
  assert.deepEqual(records[0].link.pyashSequence, ["tyap"]);
  assert.deepEqual(records[0].edgeNode, { degree: 0, singleSenseLemmas: ["florp"] });
  assert.equal(records[1].status, "review");
  assert.equal(records[2].status, "review");
  assert.equal(records[2].candidates.length, 0);
  assert.equal(new Set(records.map((record) => record.id)).size, 3);
});

test("WordNet linker accepts a leaf node mapped to an existing compound", () => {
  const index = buildEnglishWordNetIndex({
    rows: [{
      id: "n:compound:ledger_house",
      pos: "n",
      synset: "compound",
      senseKey: "compound",
      lemma: "ledger house",
      gloss: "a house for ledgers"
    }]
  });
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: index,
    resolveWord: () => ({
      coverageType: "compound",
      canonicalEnglish: "ledger house",
      pyashSequence: ["ledger", "house"]
    })
  });
  assert.equal(records[0].status, "accepted-edge");
  assert.deepEqual(records[0].link.pyashSequence, ["ledger", "house"]);
  assert.equal(records[0].link.target, "ledger house");
});

test("WordNet linker inventory includes accepted compounds and excludes compound candidates", () => {
  const inventory = buildEnglishWordNetSenseLinkInventory({
    records: [],
    baseInventory: { entries: [], grammar: [] },
    compoundRecords: [{
      target: "ledger house",
      status: "accepted-curated",
      pyashSequence: ["ledger", "house"]
    }, {
      target: "candidate house",
      status: "candidate-closed",
      pyashSequence: ["candidate", "house"]
    }]
  });
  assert.deepEqual(inventory.entries, [{
    english: "ledger house",
    pyash: ["ledger", "house"]
  }]);
});

test("WordNet linker prompt stays bounded to supplied senses and inventory", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const inventory = buildEnglishWordNetSenseLinkInventory({
    records,
    baseInventory: { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] }
  });
  const prompt = buildEnglishWordNetSenseLinkPrompt({ records, inventory });
  assert.match(prompt, /bounded Pyash WordNet sense-linking worker/u);
  assert.match(prompt, /CONTEXT SELECTION IS REQUIRED/u);
  assert.match(prompt, /reject unrelated senses even when they have valid inventory mappings/u);
  assert.match(prompt, /v:beta/u);
  assert.match(prompt, /\{"english":"emotionally"\}/u);
  assert.doesNotMatch(prompt, /"pyash":"xyek"/u);
  assert.doesNotMatch(prompt, /ollama/u);
  assert.ok(prompt.length <= 12000);
  assert.ok(estimateEnglishWordNetSenseLinkPromptTokens(prompt) < 4000);
});

test("ambiguous source words keep every sense choice beside the original sentence", () => {
  const index = buildEnglishWordNetIndex({
    rows: [{
      id: "n:show-exhibit:show",
      pos: "n",
      synset: "show-exhibit",
      senseKey: "show-exhibit",
      lemma: "show",
      gloss: "something shown to the public"
    }, {
      id: "n:show-exhibit:exhibit",
      pos: "n",
      synset: "show-exhibit",
      senseKey: "show-exhibit",
      lemma: "exhibit",
      gloss: "something shown to the public"
    }, {
      id: "v:show-demonstrate:show",
      pos: "v",
      synset: "show-demonstrate",
      senseKey: "show-demonstrate",
      lemma: "show",
      gloss: "give evidence of"
    }, {
      id: "v:show-demonstrate:demonstrate",
      pos: "v",
      synset: "show-demonstrate",
      senseKey: "show-demonstrate",
      lemma: "demonstrate",
      gloss: "give evidence of"
    }]
  });
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: index,
    sourceTerms: ["shows"],
    resolveWord: (word) => ({
      exhibit: { coverageType: "atomic", canonicalEnglish: "exhibit", pyashSequence: ["sren"] },
      demonstrate: { coverageType: "atomic", canonicalEnglish: "demonstrate", pyashSequence: ["tyap"] }
    }[word] ?? null)
  });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.status), ["review", "review"]);
  const prompt = buildEnglishWordNetSenseLinkPrompt({
    records,
    inventory: buildEnglishWordNetSenseLinkInventory({ records }),
    context: [{
      term: "shows",
      sentences: ["Love is a mix of feelings and actions that shows a deep liking."]
    }]
  });
  assert.match(prompt, /"word":"shows"/u);
  assert.match(prompt, /"sourceSentences":\["Love is a mix of feelings and actions that shows a deep liking\."\]/u);
  assert.match(prompt, /"targetEnglish":"exhibit"/u);
  assert.match(prompt, /"targetEnglish":"demonstrate"/u);
  assert.match(prompt, /Choose the relevant sense for each source word/u);
});

test("WordNet linker splits oversized sense batches without truncating identities", async () => {
  const records = Array.from({ length: 120 }, (_, index) => ({
    id: `sense-${String(index).padStart(3, "0")}`,
    status: "review",
    pos: "n",
    gloss: "a deliberately compact sense gloss used to exercise bounded batching",
    lemmas: [`term-${index}`],
    candidates: []
  }));
  const requests = [];
  const queued = await submitEnglishWordNetSenseLinks({
    records,
    inventory: {
      entries: Array.from({ length: 500 }, (_, index) => ({
        english: `inventory-${index}`,
        pyash: [`word-${index}`]
      })),
      grammar: []
    },
    sourceHash: "oversized-source",
    submit: async (request) => {
      requests.push(request);
      return { status: "queued" };
    }
  });
  assert.ok(requests.length > 1);
  assert.equal(queued.queues.length, requests.length);
  assert.ok(requests.every((request) => request.prompt.length <= 12000));
  assert.ok(requests.every((request) => estimateEnglishWordNetSenseLinkPromptTokens(request.prompt) < 4000));
  assert.ok(requests.every((request) => request.candidates.length <= 4));
  for (const record of records) {
    assert.equal(requests.filter((request) => request.prompt.includes(`\"id\":\"${record.id}\"`)).length, 1);
  }
});

test("WordNet linker keeps every sense for one source word in one decision duty", async () => {
  const records = Array.from({ length: 6 }, (_, index) => ({
    id: `shows-sense-${index}`,
    source: `n:shows-${index}`,
    sourceTerms: ["shows"],
    status: "review",
    pos: "n",
    gloss: `sense ${index} shown in a public context`,
    lemmas: ["show"],
    candidates: [{
      target: `anchor-${index}`,
      pyashSequence: [`word-${index}`]
    }]
  }));
  const requests = [];
  await submitEnglishWordNetSenseLinks({
    records,
    inventory: {
      entries: records.map((record, index) => ({
        english: `anchor-${index}`,
        pyash: [`word-${index}`]
      })),
      grammar: []
    },
    sourceHash: "same-source-word",
    maxDutySenses: 2,
    submit: async (request) => {
      requests.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].candidates.length, records.length);
  assert.ok(requests[0].prompt.includes('"word":"shows"'));
});

test("WordNet linker submits one durable future queue duty for pending senses", async () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const inventory = { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] };
  const requests = [];
  const queued = await submitEnglishWordNetSenseLinks({
    records,
    inventory,
    sourceHash: "fixture-source",
    submit: async (request) => {
      requests.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(queued.submitted, true);
  assert.equal(queued.queue.senseCount, 1);
  assert.equal(queued.records[0].queue.status, "queued");
  assert.equal(wordNetSenseLinkQueueHandle({ sourceHash: "fixture-source", records }), queued.handleId);
});

test("WordNet linker accepts only an inventory-backed target and renders native Pyash bridges", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const inventory = { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] };
  const response = parseEnglishWordNetSenseLinkResponse(JSON.stringify({
    verdict: "complete",
    senses: [{
      id: records[0].id,
      status: "accept",
      targetEnglish: "emotionally",
      rationale: "the supplied gloss describes an emotional state"
    }]
  }), { records, inventory });
  assert.equal(response.valid, true);
  const applied = applyEnglishWordNetSenseLinkResponse(records, response);
  const source = renderEnglishWordNetSenseLinksPya({
    records: applied.records,
    source: "fixture WordNet",
    sourceHash: "fixture-source"
  });
  const parsed = parseEnglishWordNetBridgeCatalog(source);
  assert.deepEqual(parsed.entries, [{
    source: "v:beta",
    target: "emotionally",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Housekeeper WordNet sense link: the supplied gloss describes an emotional state"
  }]);
  assert.equal(parseEnglishWordNetSenseLinkResponse(JSON.stringify({
    verdict: "complete",
    senses: [{
      id: records[0].id,
      status: "accept",
      targetEnglish: "outside",
      rationale: "unsupported"
    }]
  }), { records, inventory }).valid, false);
  const sequenceResponse = parseEnglishWordNetSenseLinkResponse(JSON.stringify({
    verdict: "complete",
    senses: [{
      id: records[0].id,
      status: "accept",
      targetEnglish: "emotionally",
      pyashSequence: ["xyek"],
      rationale: "the model attempted to lower the answer"
    }]
  }), { records, inventory });
  assert.equal(sequenceResponse.valid, false);
  assert.match(sequenceResponse.reason, /Pyash sequence is derived/u);
});

test("WordNet linker recovers one bounded noisy JSON object and rejects malformed output", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const inventory = { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] };
  const row = {
    id: records[0].id,
    status: "accept",
    targetEnglish: "emotionally",
    rationale: "the supplied gloss describes an emotional state"
  };
  const noisy = parseEnglishWordNetSenseLinkResponse(
    `worker preface\n\`\`\`json\n${JSON.stringify({ verdict: "complete", senses: [row] })}\n\`\`\`\nworker tail`,
    { records, inventory }
  );
  assert.equal(noisy.valid, true);
  assert.equal(noisy.links[0].id, records[0].id);
  assert.equal(parseEnglishWordNetSenseLinkResponse(
    '{"verdict":"complete","senses":[',
    { records, inventory }
  ).valid, false);
});

test("WordNet linker automatically repairs malformed model decisions and applies them", async () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  }).map((record) => ({
    ...record,
    queue: { handleId: "english-wordnet-link-reconcile", status: "queued" }
  }));
  const inventory = { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] };
  const repaired = JSON.stringify({
    verdict: "complete",
    senses: [{
      id: records[0].id,
      status: "accept",
      targetEnglish: "emotionally",
      rationale: "the supplied gloss describes an emotional state"
    }]
  });
  const submitted = [];
  const settled = await reconcileEnglishWordNetSenseLinks({
    records,
    inventory,
    sourceHash: "reconcile-source",
    queues: [{ handleId: "english-wordnet-link-reconcile", senseCount: 1 }],
    awaitHandle: async (handleId) => handleId.endsWith("-retry-2")
      ? repaired
      : JSON.stringify({ verdict: "complete", senses: [{ id: records[0].id, status: "accept", rationale: "missing mapping" }] }),
    submit: async (request) => {
      submitted.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(submitted.length, 1);
  assert.match(submitted[0].handleId, /-retry-2$/u);
  assert.equal(settled.queues[0].outcome, "applied");
  assert.equal(settled.records[0].status, "accepted-llm");
  assert.deepEqual(settled.records[0].link.pyashSequence, ["xyek"]);
});

test("WordNet linker keeps valid rows during bounded partial recovery", async () => {
  const records = [
    {
      id: "sense-valid",
      pos: "n",
      status: "review",
      candidates: [],
      queue: { handleId: "english-wordnet-link-partial", status: "queued" }
    },
    {
      id: "sense-malformed",
      pos: "n",
      status: "review",
      candidates: [],
      queue: { handleId: "english-wordnet-link-partial", status: "queued" }
    }
  ];
  const settled = await reconcileEnglishWordNetSenseLinks({
    records,
    inventory: { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] },
    sourceHash: "partial-source",
    queues: [{ handleId: "english-wordnet-link-partial", senseCount: 2 }],
    maxRepairAttempts: 0,
    awaitHandle: async () => JSON.stringify({
      verdict: "complete",
      senses: [
        {
          id: "sense-valid",
          status: "accept",
          targetEnglish: "emotionally",
          rationale: "the supplied inventory supports the target"
        },
        {
          id: "sense-malformed",
          status: "accept",
          rationale: "the provider omitted the required mapping"
        }
      ]
    }),
    submit: async () => ({ status: "queued" })
  });
  assert.equal(settled.queues[0].outcome, "partial");
  assert.equal(settled.records.find((record) => record.id === "sense-valid").status, "accepted-llm");
  assert.equal(settled.records.find((record) => record.id === "sense-malformed").status, "uncertain-llm");
});

test("WordNet linker extracts the nested response from an Ollama envelope", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const inventory = { entries: [{ english: "emotionally", pyash: ["xyek"] }], grammar: [] };
  const response = parseEnglishWordNetSenseLinkResponse(JSON.stringify({
    model: "qwen3.5:9b",
    response: JSON.stringify({
      verdict: "complete",
      senses: [{
        id: records[0].id,
        status: "accept",
        targetEnglish: "emotionally",
        rationale: "the supplied gloss describes an emotional state"
      }]
    }),
    done: true
  }), { records, inventory });
  assert.equal(response.valid, true);
  assert.equal(response.links[0].target, "emotionally");
});

test("WordNet linker rejects an empty completed provider response", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const response = parseEnglishWordNetSenseLinkResponse(
    JSON.stringify({ verdict: "complete", senses: [] }),
    { records, inventory: { entries: [], grammar: [] } }
  );
  assert.equal(response.valid, false);
  assert.equal(response.reason, "response senses must contain at least one decision");
});

test("WordNet linker matches string-backed base inventory rows to response sequences", () => {
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: fixtureIndex(),
    resolveWord: resolver,
    sourceTerms: ["blorp"]
  });
  const response = parseEnglishWordNetSenseLinkResponse(JSON.stringify({
    verdict: "complete",
    senses: [{
      id: records[0].id,
      status: "accept",
      targetEnglish: "emotionally",
      rationale: "the supplied gloss describes an emotional state"
    }]
  }), {
    records,
    inventory: { entries: [{ english: "emotionally", pyash: "xyek" }], grammar: [] }
  });
  assert.equal(response.valid, true);
});

test("WordNet linker configuration is durable Pyash workflow data", async () => {
  const config = await loadEnglishWordNetLinkerConfig();
  assert.deepEqual(config, {
    format: "english-wordnet-linker-v1",
    queueIntent: "mind",
    queueLane: "durable",
    model: "qwen3.5:9b",
    maxBatch: 200,
    maxDutySenses: 4,
    promptMaxChars: 12000,
    promptMaxTokens: 3900,
    maxOutputTokens: 8192,
    edgeMaxDegree: 1,
    modelCard: {
      model: "qwen3.5:9b",
      provider: "ollama",
      contextWindowTokens: 32768,
      safeInputTokens: 3900,
      safeOutputTokens: 8192,
      cardSource: "Ollama model metadata with bounded Pyash translation input policy"
    }
  });
});

test("translation model card keeps input and output budgets below the model context window", async () => {
  const card = await loadTranslationModelCard();
  assert.equal(card.model, "qwen3.5:9b");
  assert.equal(card.provider, "ollama");
  assert.equal(card.contextWindowTokens, 32768);
  assert.equal(card.safeInputTokens, 3900);
  assert.equal(card.safeOutputTokens, 8192);
  const parsed = parseTranslationModelCards([
    "su name translation_model_cards be map def",
    "su text \"format\" ob text \"translation-model-cards-v1\" ya",
    "su text \"model:test:context-window-tokens\" ob num 100 ya",
    "su text \"model:test:safe-input-tokens\" ob num 90 ya",
    "su text \"model:test:safe-output-tokens\" ob num 8 ya",
    "prah"
  ].join("\n"));
  assert.deepEqual(selectTranslationModelCard(parsed.cards, "test"), {
    model: "test",
    provider: "",
    contextWindowTokens: 100,
    safeInputTokens: 90,
    safeOutputTokens: 8,
    cardSource: ""
  });
});

test("default WordNet linker submitter uses the existing future GPU duty", async () => {
  let sentence = "";
  const submit = createQueuedMindEnglishWordNetSenseLinkSubmitter({
    parse: (value) => value,
    interpret: async (value) => {
      sentence = value;
      return { ob: { text: "queued" } };
    }
  });
  const response = await submit({ handleId: "english-wordnet-link-test", prompt: "review" });
  assert.equal(response.status, "queued");
  assert.match(sentence, /vyah start future be gpu mind do/u);
  assert.match(sentence, /english-wordnet-link-test/u);
  const encodedSpec = sentence.match(/ob text (".*") vyah start future be gpu mind do/u)?.[1];
  const spec = JSON.parse(JSON.parse(encodedSpec));
  assert.deepEqual(spec.format.required, ["verdict", "senses"]);
  assert.ok(spec.format.properties.senses);
  assert.equal(spec.options.num_predict, 8192);
});

test("default WordNet linker factory resolves the existing Pyash runtime adapters", async () => {
  const submit = await createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter({
    parse: (value) => value,
    interpret: async () => ({ ob: { text: "queued" } })
  });
  const response = await submit({ handleId: "english-wordnet-link-factory-test", prompt: "review" });
  assert.equal(response.status, "queued");
});
