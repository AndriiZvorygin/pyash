import test from "node:test";
import assert from "node:assert/strict";

import {
  SUMO_CONCEPT_LINK_FORMAT,
  buildSumoConceptEvidence,
  buildSumoConceptLinkRecord,
  buildSumoLinkIndex,
  normalizeSumoSurface,
  parseSumoConceptCatalog,
  parseSumoConceptLinkRows,
  relationForTarget,
  renderSumoConceptLinkRows,
  resolveSumoConceptEvidence,
  sumoSurfaceContains,
  uniqueCrosswalk
} from "../program/library/translation/sumo_concept_evidence.mjs";
import { parseSumoOntology } from "../program/library/translation/sumo_ontology.mjs";

const CATALOG = [
  'su name sumo_wordnet_evidence be map def',
  'su text "format" ob text "sumo-wordnet-crosswalk-v1" ya',
  'su text "sumo:Love" ob text "{\\"kind\\":\\"sumo-concept\\",\\"sumoId\\":\\"Love\\",\\"label\\":\\"love\\",\\"provenance\\":\\"SUMO English term format\\"}" ya',
  'su text "sumo:CompanionateLove" ob text "{\\"kind\\":\\"sumo-concept\\",\\"sumoId\\":\\"CompanionateLove\\",\\"label\\":\\"companionate love\\",\\"provenance\\":\\"SUMO English term format\\"}" ya',
  'su text "sumo-map:wn30:n:07511157:Love" ob text "{\\"kind\\":\\"wordnet-mapping\\",\\"sumoId\\":\\"Love\\",\\"label\\":\\"love\\",\\"lemmas\\":[\\"love\\"],\\"mappingSymbol\\":\\"=\\",\\"mappingRelation\\":\\"equivalent-to\\",\\"openEnglishWordNetIds\\":[\\"n:07511157-n\\"],\\"crosswalkStatus\\":\\"unique\\"}" ya',
  "prah"
].join("\n");

const ONTOLOGY = parseSumoOntology([
  [
    '(termFormat EnglishWrittenLanguage Love "love")',
    '(termFormat EnglishWrittenLanguage CompanionateLove "companionate love")',
    '(documentation Love EnglishWrittenLanguage "A strong emotion associated with feelings of desire.")',
    '(documentation CompanionateLove EnglishWrittenLanguage "Less intense, longer lasting love.")',
    '(subclass CompanionateLove Love)'
  ].join("\n")
]);

const ENTRIES = [
  {
    sequence: "pyan hbin",
    forms: [{ language: "en", surface: "love", normalized: "love" }],
    sourceLinks: [
      { dataset: "wordnet", release: "Open English WordNet 2025", identifier: "n:07511157-n", relation: "exact-sense" },
      { dataset: "sumo", release: "WordNet 3.0", identifier: "Love", relation: "equivalent-to" }
    ],
    sourceGlosses: [
      { language: "en", dataset: "wordnet", release: "Open English WordNet 2025", identifier: "n:07511157-n", text: "the emotion of deep affection" }
    ]
  },
  {
    sequence: "cyit tfen",
    forms: [{ language: "en", surface: "protectiveness", normalized: "protectiveness" }],
    sourceLinks: [
      { dataset: "sumo", release: "WordNet 3.0", identifier: "CompanionateLove", relation: "subsumed-by" }
    ],
    sourceGlosses: []
  }
];

test("SUMO surfaces fold case and separators", () => {
  assert.equal(normalizeSumoSurface("  Companionate_Love  "), "companionate love");
  assert.equal(normalizeSumoSurface("in-height(p)"), "in height(p)");
});

test("a head word is recognised inside a longer surface", () => {
  assert.equal(sumoSurfaceContains("companionate love", "love"), true);
  assert.equal(sumoSurfaceContains("love", "companionate love"), false);
  assert.equal(sumoSurfaceContains("disseminating", "communication"), false);
});

test("the SUMO catalog yields the concept universe", () => {
  const concepts = parseSumoConceptCatalog(CATALOG);
  assert.equal(concepts.size, 2);
  assert.equal(concepts.get("Love").label, "love");
  assert.equal(concepts.get("Love").mappings.length, 1);
  assert.deepEqual(uniqueCrosswalk(concepts.get("Love")), {
    senseId: "n:07511157-n",
    relation: "equivalent-to",
    lemmas: ["love"]
  });
  assert.equal(uniqueCrosswalk(concepts.get("CompanionateLove")), null);
});

test("the link index reads published SUMO links and entry surfaces", () => {
  const index = buildSumoLinkIndex(ENTRIES);
  assert.deepEqual(index.linksBySumoId.get("Love"), [{ sequence: "pyan hbin", relation: "equivalent-to" }]);
  assert.deepEqual(index.sequencesBySurface.get("love"), ["pyan hbin"]);
  assert.deepEqual(index.entriesBySequence.get("pyan hbin").senses, ["n:07511157-n"]);
});

test("a concept already linked to its own surface is covered", () => {
  const index = buildSumoLinkIndex(ENTRIES);
  const evidence = buildSumoConceptEvidence({
    concepts: parseSumoConceptCatalog(CATALOG),
    ontology: ONTOLOGY,
    linkIndex: index
  });
  const love = evidence.get("Love");
  assert.equal(love.covered, true);
  assert.deepEqual(resolveSumoConceptEvidence(love), {
    status: "covered",
    reason: "already linked to the entry carrying its own surface",
    relation: "",
    sequence: ""
  });
});

test("a subtype of a linked concept links to it as a superclass", () => {
  const index = buildSumoLinkIndex(ENTRIES);
  const evidence = buildSumoConceptEvidence({
    concepts: parseSumoConceptCatalog(CATALOG),
    ontology: ONTOLOGY,
    linkIndex: index
  });
  const companionate = evidence.get("CompanionateLove");
  assert.equal(companionate.covered, false);
  assert.equal(companionate.hierarchy.ancestorSumoId, "Love");
  assert.equal(companionate.hierarchy.affinity, "head-word");
  assert.deepEqual(resolveSumoConceptEvidence(companionate), {
    status: "resolved",
    path: "hierarchy",
    relation: "superclass-of",
    sequence: "pyan hbin",
    reason: "nearest ancestor Love is linked equivalent-to"
  });
});

test("several surface candidates need adjudication", () => {
  const index = buildSumoLinkIndex([
    ...ENTRIES,
    {
      sequence: "pfun grin",
      forms: [{ language: "en", surface: "companionate love", normalized: "companionate love" }],
      sourceLinks: [],
      sourceGlosses: []
    },
    {
      sequence: "cyit pyan",
      forms: [{ language: "en", surface: "companionate love", normalized: "companionate love" }],
      sourceLinks: [],
      sourceGlosses: []
    }
  ]);
  const evidence = buildSumoConceptEvidence({
    concepts: parseSumoConceptCatalog(CATALOG),
    ontology: ONTOLOGY,
    linkIndex: index
  });
  const resolution = resolveSumoConceptEvidence(evidence.get("CompanionateLove"));
  assert.equal(resolution.status, "needs-adjudication");
  assert.equal(resolution.path, "surface");
});

test("a chosen target keeps the crosswalk relation only when it holds the sense", () => {
  const evidence = { crosswalk: { senseId: "n:07511157-n", relation: "equivalent-to" } };
  assert.equal(relationForTarget(evidence, { senses: ["n:07511157-n"] }), "equivalent-to");
  assert.equal(relationForTarget(evidence, { senses: ["n:00000000-n"] }, "superclass-of"), "superclass-of");
  assert.equal(relationForTarget(evidence, { senses: [] }), "equivalent-to");
});

test("a link record keeps identifiers and never copies the SUMO definition", () => {
  const index = buildSumoLinkIndex(ENTRIES);
  const evidence = buildSumoConceptEvidence({
    concepts: parseSumoConceptCatalog(CATALOG),
    ontology: ONTOLOGY,
    linkIndex: index
  });
  const companionate = evidence.get("CompanionateLove");
  const resolution = resolveSumoConceptEvidence(companionate);
  const record = buildSumoConceptLinkRecord({
    concept: { sumoId: "CompanionateLove", label: "companionate love" },
    evidence: companionate,
    resolution
  });
  assert.equal(record.kind, "sumo-concept-link");
  assert.equal(record.relation, "superclass-of");
  assert.deepEqual(record.pyashSequence, ["pyan", "hbin"]);
  assert.equal(record.evidence.ancestorSumoId, "Love");
  assert.equal(JSON.stringify(record).includes("Less intense"), false);
});

test("a link record refuses an unsupported relation", () => {
  assert.throws(
    () => buildSumoConceptLinkRecord({
      concept: { sumoId: "X", label: "x" },
      evidence: {},
      resolution: { status: "resolved", relation: "invented", sequence: "a b", path: "surface", reason: "r" }
    }),
    (error) => error.code === "invalid-sumo-concept-evidence"
  );
});

test("link rows round trip through the catalog", () => {
  const rows = renderSumoConceptLinkRows([
    {
      recordId: "sumo-link:CompanionateLove",
      kind: "sumo-concept-link",
      sumoId: "CompanionateLove",
      label: "companionate love",
      surface: "companionate love",
      pyashSequence: ["pyan", "hbin"],
      relation: "superclass-of",
      evidence: { path: "hierarchy", reason: "nearest ancestor Love is linked equivalent-to" },
      provenance: "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed"
    }
  ]);
  assert.ok(rows.includes(SUMO_CONCEPT_LINK_FORMAT));
  const parsed = parseSumoConceptLinkRows(rows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].relation, "superclass-of");
  assert.deepEqual(parsed[0].pyashSequence, ["pyan", "hbin"]);
});
