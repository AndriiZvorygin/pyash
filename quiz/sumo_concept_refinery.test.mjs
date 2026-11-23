import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendSumoConceptRowsPyaFile,
  buildAdjudicationCandidates,
  buildSumoConceptPrompt,
  buildSumoConceptResponseFormat,
  orderSumoConceptWorklist,
  parseSumoConceptChoiceResponse,
  parseSumoConceptConfig,
  parseSumoConceptRowsPya,
  promoteSumoConceptLinks,
  sumoConceptRunId
} from "../program/library/translation/sumo_concept_refinery.mjs";

const CONFIG = [
  "su name translation be map def",
  'su text "format" ob text "translation-sumo-concept-refinery-v1" ya',
  'su text "model" ob text "qwen3.5:9b" ya',
  'su text "prompt-revision" ob text "sumo-concept-link-v1" ya',
  'su text "max-output-tokens" ob num 512 ya',
  'su text "parallelism" ob num 8 ya',
  'su text "max-concepts-per-launch" ob num 64 ya',
  'su text "candidate-limit" ob num 8 ya',
  'su text "hierarchy-depth-limit" ob num 6 ya',
  'su text "worklist-order" ob text "english30k-rank" ya',
  "prah"
].join("\n");

test("the SUMO concept config reads its sweep settings", () => {
  const config = parseSumoConceptConfig(CONFIG);
  assert.equal(config.format, "translation-sumo-concept-refinery-v1");
  assert.equal(config.model, "qwen3.5:9b");
  assert.equal(config.maximumConcepts, 64);
  assert.equal(config.candidateLimit, 8);
  assert.equal(config.worklistOrder, "english30k-rank");
});

test("the SUMO concept run id follows its sources and prompt revision", () => {
  const first = sumoConceptRunId({ sourceHash: "abc", promptRevision: "v1" });
  assert.equal(first, sumoConceptRunId({ sourceHash: "abc", promptRevision: "v1" }));
  assert.notEqual(first, sumoConceptRunId({ sourceHash: "abd", promptRevision: "v1" }));
  assert.notEqual(first, sumoConceptRunId({ sourceHash: "abc", promptRevision: "v2" }));
});

test("the worklist keeps the frequency order and skips covered concepts", () => {
  const evidence = new Map([
    ["Alpha", { sumoId: "Alpha", surface: "alpha", covered: false, candidates: [], hierarchy: null, crosswalk: null, path: "surface" }],
    ["Beta", { sumoId: "Beta", surface: "beta", covered: false, candidates: [], hierarchy: null, crosswalk: null, path: "surface" }],
    ["Done", { sumoId: "Done", surface: "done", covered: true, candidates: [], hierarchy: null, crosswalk: null, path: "covered" }]
  ]);
  const ranks = new Map([["alpha", 10], ["beta", 5]]);
  const rankForEnglish = (value) => ranks.get(String(value ?? "").toLowerCase()) ?? Number.POSITIVE_INFINITY;
  const selection = orderSumoConceptWorklist(evidence, rankForEnglish, { limit: 64 });
  assert.equal(selection.total, 2);
  assert.deepEqual(selection.rows.map((row) => row.sumoId), ["Beta", "Alpha"]);
});

test("the adjudication prompt states the relation direction", () => {
  const prompt = buildSumoConceptPrompt({
    concept: { sumoId: "CompanionateLove" },
    evidence: {
      surface: "companionate love",
      definition: "Less intense, longer lasting love."
    },
    candidates: [
      { sequence: "pyan hbin", surfaces: ["love"], senses: [], glosses: ["the emotion of deep affection"], reason: "head word" }
    ]
  });
  assert.ok(prompt.includes("SUMO concept: CompanionateLove"));
  assert.ok(prompt.includes("Less intense, longer lasting love."));
  assert.ok(prompt.includes('sequence "pyan hbin"'));
  assert.ok(prompt.includes("superclass-of: the entry is a broader class than the concept"));
});

test("the adjudication response format asks for one choice", () => {
  const format = buildSumoConceptResponseFormat();
  assert.deepEqual(format.required, ["choice", "relation", "reason"]);
  assert.equal(format.properties.choice.type, "string");
});

test("a model answer that names a supplied candidate is accepted", () => {
  const evidence = { crosswalk: null };
  const candidates = [{ sequence: "pyan hbin", senses: [], glosses: [] }];
  const parsed = parseSumoConceptChoiceResponse(
    JSON.stringify({ choice: "pyan hbin", relation: "equivalent-to", reason: "same word" }),
    { evidence, candidates }
  );
  assert.equal(parsed.status, "accepted");
  assert.equal(parsed.choice, "pyan hbin");
  assert.equal(parsed.relation, "equivalent-to");
});

test("a model answer of none is a rejection", () => {
  const parsed = parseSumoConceptChoiceResponse(
    JSON.stringify({ choice: "none", relation: "equivalent-to", reason: "no match" }),
    { evidence: {}, candidates: [] }
  );
  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.choice, "");
});

test("a model answer naming an unsupplied candidate stays uncertain", () => {
  const parsed = parseSumoConceptChoiceResponse(
    JSON.stringify({ choice: "not offered", relation: "equivalent-to", reason: "guess" }),
    { evidence: {}, candidates: [{ sequence: "pyan hbin", senses: [] }] }
  );
  assert.equal(parsed.status, "uncertain");
  assert.match(parsed.reason, /unsupplied candidate/u);
});

test("a model relation that contradicts the crosswalk stays uncertain", () => {
  const evidence = { crosswalk: { senseId: "n:07511157-n", relation: "equivalent-to" } };
  const candidates = [{ sequence: "pyan hbin", senses: ["n:07511157-n"] }];
  const parsed = parseSumoConceptChoiceResponse(
    JSON.stringify({ choice: "pyan hbin", relation: "superclass-of", reason: "wider" }),
    { evidence, candidates }
  );
  assert.equal(parsed.status, "uncertain");
  assert.match(parsed.reason, /contradicts the crosswalk/u);
});

test("a model relation that is not supported stays uncertain", () => {
  const parsed = parseSumoConceptChoiceResponse(
    JSON.stringify({ choice: "pyan hbin", relation: "invented", reason: "guess" }),
    { evidence: {}, candidates: [{ sequence: "pyan hbin", senses: [] }] }
  );
  assert.equal(parsed.status, "uncertain");
  assert.match(parsed.reason, /unsupported relation/u);
});

test("adjudication candidates come from the head word", () => {
  const linkIndex = {
    sequencesBySurface: new Map([["love", ["pyan hbin", "pyan hbin2"]]]),
    entriesBySequence: new Map([
      ["pyan hbin", { sequence: "pyan hbin", surfaces: ["love"], senses: [], glosses: [] }],
      ["pyan hbin2", { sequence: "pyan hbin2", surfaces: ["love"], senses: [], glosses: [] }]
    ])
  };
  const candidates = buildAdjudicationCandidates(
    { surface: "companionate love", hierarchy: null },
    linkIndex,
    8
  );
  assert.deepEqual(candidates.map((candidate) => candidate.sequence), ["pyan hbin", "pyan hbin2"]);
  assert.equal(candidates[0].reason, "head word");
});

test("the provider envelope is unwrapped before the answer is read", () => {
  const answer = JSON.stringify({
    model: "qwen3.5:9b",
    response: "{\"choice\": \"pyan hbin\", \"relation\": \"equivalent-to\", \"reason\": \"same word\"}",
    done: true
  });
  const parsed = parseSumoConceptChoiceResponse(answer, {
    evidence: {},
    candidates: [{ sequence: "pyan hbin", senses: [] }]
  });
  assert.equal(parsed.status, "accepted");
  assert.equal(parsed.choice, "pyan hbin");
});

test("an answer that is not JSON stays uncertain", () => {
  const parsed = parseSumoConceptChoiceResponse("not json at all", { evidence: {}, candidates: [] });
  assert.equal(parsed.status, "uncertain");
  assert.match(parsed.reason, /not JSON/u);
});

test("promoted links replace an earlier decision for the same concept", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sumo-links-"));
  const catalogUrl = path.join(directory, "sumo_concept_links.pya");
  const first = {
    recordId: "sumo-link:Love",
    kind: "sumo-concept-link",
    sumoId: "Love",
    label: "love",
    surface: "love",
    pyashSequence: ["pyan", "hbin"],
    relation: "equivalent-to",
    evidence: { path: "surface", reason: "own surface matches one entry" },
    provenance: "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed"
  };
  await promoteSumoConceptLinks([first], { catalogUrl });
  const second = { ...first, relation: "superclass-of" };
  const promotion = await promoteSumoConceptLinks([second], { catalogUrl });
  assert.equal(promotion.count, 1);
  const source = await fs.readFile(catalogUrl, "utf8");
  assert.ok(source.includes("superclass-of"));
  assert.equal(source.split('su text "sumo-link:Love" ob text').length - 1, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test("artifact rows keep their map header and read back", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sumo-artifact-"));
  const artifactPath = path.join(directory, "concept-candidates.pya");
  await appendSumoConceptRowsPyaFile(artifactPath, "sumo_concept_candidates", "sumo-concept-candidate-v1", [
    { id: "candidate:Love", sumoId: "Love", status: "resolved", sequence: "pyan hbin" }
  ], { "model": "qwen3.5:9b" });
  await appendSumoConceptRowsPyaFile(artifactPath, "sumo_concept_candidates", "sumo-concept-candidate-v1", [
    { id: "candidate:CompanionateLove", sumoId: "CompanionateLove", status: "resolved", sequence: "pyan hbin" }
  ]);
  const source = await fs.readFile(artifactPath, "utf8");
  assert.ok(source.includes("su name sumo_concept_candidates be map def"));
  const rows = parseSumoConceptRowsPya(source, "sumo_concept_candidates");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sumoId), ["Love", "CompanionateLove"]);
  await fs.rm(directory, { recursive: true, force: true });
});
