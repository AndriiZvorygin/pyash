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
  loadEnglishWordNetLinkerConfig,
  parseEnglishWordNetSenseLinkResponse,
  renderEnglishWordNetSenseLinksPya,
  submitEnglishWordNetSenseLinks,
  wordNetSenseLinkQueueHandle
} from "../program/verbs/exchange/translation/english_wordnet_linker.mjs";
import { parseEnglishWordNetBridgeCatalog } from "../program/verbs/exchange/translation/english_wordnet_bridges.mjs";

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
  assert.equal(records[0].status, "accepted-deterministic");
  assert.deepEqual(records[0].link.pyashSequence, ["tyap"]);
  assert.equal(records[1].status, "review");
  assert.equal(records[2].status, "review");
  assert.equal(records[2].candidates.length, 0);
  assert.equal(new Set(records.map((record) => record.id)).size, 3);
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
  assert.match(prompt, /v:beta/u);
  assert.match(prompt, /emotionally.*xyek/u);
  assert.doesNotMatch(prompt, /ollama/u);
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
      target: "emotionally",
      pyashSequence: ["xyek"],
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
      target: "outside",
      pyashSequence: ["hax"],
      rationale: "unsupported"
    }]
  }), { records, inventory }).valid, false);
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
    target: "emotionally",
    pyashSequence: ["xyek"],
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
        target: "emotionally",
        pyashSequence: ["xyek"],
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

test("WordNet linker configuration is durable Pyash workflow data", async () => {
  const config = await loadEnglishWordNetLinkerConfig();
  assert.deepEqual(config, {
    format: "english-wordnet-linker-v1",
    queueIntent: "mind",
    queueLane: "durable",
    maxBatch: 200
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
});

test("default WordNet linker factory resolves the existing Pyash runtime adapters", async () => {
  const submit = await createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter({
    parse: (value) => value,
    interpret: async () => ({ ob: { text: "queued" } })
  });
  const response = await submit({ handleId: "english-wordnet-link-factory-test", prompt: "review" });
  assert.equal(response.status, "queued");
});
