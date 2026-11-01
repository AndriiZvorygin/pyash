import assert from "node:assert/strict";
import test from "node:test";

import {
  activateEnglishWordNetSenseSweepLinks,
  classifyEnglishWordNetSenseSweep,
  rankEnglishWordNetSenseRecords,
  partitionEnglishWordNetSenseSweep,
  parseEnglishWordNetSweepPya,
  renderEnglishWordNetSweepBatchPya,
  renderEnglishWordNetSweepManifestPya
} from "../program/library/translation/english_wordnet_sweep.mjs";
import {
  buildEnglishWordNetBridgeIndex,
  parseEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";

function linkedRecord(pos, synset, target, status = "accepted-edge") {
  return {
    id: `english-wordnet-sense-${pos}-${synset}`,
    source: `${pos}:${synset}`,
    pos,
    synset,
    lemmas: [target],
    sourceTerms: [target],
    gloss: `${target} gloss`,
    status,
    link: {
      target,
      pyashSequence: [target === "bird" ? "pyaf" : "hcas"],
      targetKind: "atom",
      targetId: `atom:${target}`,
      targetPartOfSpeech: pos,
      certainty: "deterministic",
      evidence: "unique edge anchor"
    }
  };
}

test("sense sweep separates automatic, colliding, contextual, and missing-anchor rows", () => {
  const records = [
    linkedRecord("n", "00000001-n", "bird"),
    linkedRecord("n", "00000002-n", "bird"),
    linkedRecord("n", "00000003-n", "thing", "accepted-existing"),
    {
      ...linkedRecord("v", "00000004-v", "care", "review"),
      candidates: [{ target: "care", pyashSequence: ["hcas"], selectable: true }]
    },
    {
      ...linkedRecord("n", "00000005-n", "uncovered", "review"),
      candidates: [{ target: "uncovered", pyashSequence: [], selectable: false }]
    }
  ];
  const result = classifyEnglishWordNetSenseSweep(records);

  assert.deepEqual(result.counts, {
    "linked-existing": 1,
    "automatic-link": 0,
    "needs-equivalence-review": 2,
    "needs-sense-choice": 1,
    "needs-atom-or-compound-anchor": 1
  });
  assert.equal(result.records[0].reason, "proposed anchor collides with another WordNet sense");
  assert.equal(result.records[2].category, "linked-existing");
  assert.equal(result.records[2].sourceStatus, "accepted-existing");
  assert.equal(result.records[3].candidates[0].selectable, true);
});

test("sense sweep keeps a unique low-degree anchor as an automatic proposal", () => {
  const result = classifyEnglishWordNetSenseSweep([
    linkedRecord("n", "00000001-n", "bird")
  ]);
  assert.equal(result.records[0].category, "automatic-link");
  assert.equal(result.counts["automatic-link"], 1);
});

test("sense worklists sort by the highest-frequency English30k lemma with stable ties", () => {
  const records = [
    { id: "late", source: "n:z", lemmas: ["unranked"] },
    { id: "middle", source: "n:b", lemmas: ["common", "rare"] },
    { id: "first", source: "n:a", lemmas: ["frequent"] },
    { id: "tie", source: "n:c", lemmas: ["common"] }
  ];
  const ranks = new Map([["frequent", 4], ["common", 20], ["rare", 700]]);
  const ordered = rankEnglishWordNetSenseRecords(records, {
    rankForEnglish: (term) => ranks.get(term) ?? Number.POSITIVE_INFINITY
  });
  assert.deepEqual(ordered.map((record) => [record.id, record.english30kRank]), [
    ["first", 4], ["middle", 20], ["tie", 20], ["late", null]
  ]);
});

test("automatic sweep links activate only when they preserve bridge uniqueness", () => {
  const catalogSource = [
    "su name translation_english_wordnet_bridges be map def",
    "su text \"format\" ob text \"english-wordnet-bridge-v1\" ya",
    "su text \"source\" ob text \"fixture bridge catalog\" ya",
    "su text \"n:00000001-n\" ob name prior as text \"n\" with text \"contextual\" via text \"existing evidence\" ya",
    "prah",
    ""
  ].join("\n");
  const records = [
    {
      category: "automatic-link",
      source: "n:00000002-n",
      pos: "n",
      synset: "00000002-n",
      gloss: "ready gloss",
      lemmas: ["ready"],
      link: {
        target: "ready",
        pyashSequence: ["newatom"],
        targetKind: "atom",
        targetId: "atom:newatom",
        evidence: "unique leaf anchor"
      }
    },
    {
      category: "automatic-link",
      source: "n:00000001-n",
      pos: "n",
      link: { target: "prior", pyashSequence: ["prioratom"] }
    },
    ...["n:00000003-n", "n:00000004-n"].map((source) => ({
      category: "automatic-link",
      source,
      pos: "n",
      synset: source.slice(2),
      link: {
        target: "shared",
        pyashSequence: ["sharedatom"],
        targetKind: "atom",
        targetId: "atom:sharedatom",
        evidence: "unique leaf anchor"
      }
    })),
    { category: "needs-sense-choice", source: "v:00000005-v", pos: "v", link: { target: "ignored", pyashSequence: ["ignored"] } }
  ];
  const sequences = new Map([
    ["prior", ["prioratom"]],
    ["ready", ["newatom"]],
    ["shared", ["sharedatom"]]
  ]);
  const result = activateEnglishWordNetSenseSweepLinks({
    catalogSource,
    records,
    runId: "fixture-sweep",
    sourceHash: "fixture-hash",
    resolveTarget: (target) => ({ pyashSequence: sequences.get(target) ?? [] })
  });

  assert.deepEqual(result.activated, ["n:00000002-n"]);
  assert.equal(result.totalCatalogEntries, 2);
  assert.equal(parseEnglishWordNetBridgeCatalog(result.catalog).entries.find((entry) => entry.source === "n:00000002-n")?.gloss, "ready gloss");
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((row) => row.reason === "sense already exists in the active catalog"));
  assert.equal(result.skipped.filter((row) => row.reason === "target identity collides with a non-equivalent WordNet sense").length, 2);
  const catalog = parseEnglishWordNetBridgeCatalog(result.catalog);
  const active = buildEnglishWordNetBridgeIndex({ entries: catalog.entries });
  assert.equal(active.lookup("n:00000002-n").target, "ready");
  assert.equal(active.lookup("n:00000002-n").certainty, "deterministic");
  assert.equal(active.lookup("n:00000003-n"), null);
});

test("sense sweep batch partitioning is stable and bounded", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: String(index) }));
  assert.deepEqual(partitionEnglishWordNetSenseSweep(rows, 3).map((batch) => batch.map((row) => row.id)), [
    ["0", "1", "2"],
    ["3", "4", "5"],
    ["6"]
  ]);
});

test("sense sweep artifacts round-trip through the Pyash parser with readable JSON rows", () => {
  const row = { id: "sense-1", category: "needs-sense-choice", gloss: "line one\nline two" };
  const batch = renderEnglishWordNetSweepBatchPya({
    runId: "sweep-test",
    batchIndex: 1,
    sourceHash: "wordnet-hash",
    coverageHash: "coverage-hash",
    records: [row]
  });
  const parsedBatch = parseEnglishWordNetSweepPya(batch);
  const parsedRow = parsedBatch.rows.find((sentence) => sentence.su.text === row.id);
  assert.deepEqual(JSON.parse(parsedRow.ob.text), row);

  const manifest = renderEnglishWordNetSweepManifestPya({
    runId: "sweep-test",
    sourceHash: "wordnet-hash",
    coverageHash: "coverage-hash",
    status: "complete",
    batchSize: 1000,
    batchCount: 1,
    completedBatchCount: 1,
    recordCount: 1,
    counts: { "automatic-link": 0 }
  });
  const parsedManifest = parseEnglishWordNetSweepPya(manifest);
  const countsRow = parsedManifest.rows.find((sentence) => sentence.su.text === "category-counts");
  assert.deepEqual(JSON.parse(countsRow.ob.text), { "automatic-link": 0 });
});
