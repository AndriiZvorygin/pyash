import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalCompoundPayload,
  loadCompoundLexicon,
  loadChineseCompoundLexicon,
  queryCompoundLexicon,
  parseCompoundLexicon,
  parseChineseCompoundLexicon,
  queryChineseCompoundLexicon
} from "../program/library/translation/compound_lexicon.mjs";
import { buildCompoundAtomLinks } from "../program/library/translation/compound_atom_links.mjs";

test("Chinese compound lexicon preserves ordered morphemes and stable identities", async () => {
  const entries = await loadChineseCompoundLexicon();
  const database = entries.find((entry) => entry.surface === "数据库");

  assert.ok(database);
  assert.deepEqual(database.morphemes, ["数据", "库"]);
  assert.equal(database.target, "database");
  assert.equal(database.specificAtom, "database");
  assert.equal(database.status, "lowered-compound");
  assert.deepEqual(database.componentGlosses, ["data", "storehouse"]);
  assert.deepEqual(database.pyashSequence, ["hnuc", "cren"]);
  assert.deepEqual(database.componentLayers, [16, 19]);
  assert.equal(database.maxLayer, 19);
  assert.match(database.evidence, /data -> number; storehouse -> shed/u);
  assert.deepEqual(database.rejectedCandidates, [{
    pyashSequence: ["dxak"],
    componentLayers: [28],
    maxLayer: 28,
    reason: "higher-layer-than-selected"
  }]);
  assert.match(database.id, /^compound-[0-9a-f]{24}$/);
  assert.equal(canonicalCompoundPayload(database), canonicalCompoundPayload({
    ...database,
    id: "different-source-id"
  }));

  const cerebellum = entries.find((entry) => entry.surface === "小脑");
  assert.ok(cerebellum);
  assert.equal(cerebellum.target, "cerebellum");
  assert.deepEqual(cerebellum.morphemes, ["小", "脑"]);
  assert.deepEqual(cerebellum.componentGlosses, ["tiny", "brain"]);
  assert.deepEqual(cerebellum.pyashSequence, ["cyon", "twum"]);
  assert.equal(cerebellum.head, "brain");
  assert.equal(cerebellum.specificAtom, "cerebellum");

  const midbrain = entries.find((entry) => entry.surface === "中脑");
  assert.ok(midbrain);
  assert.equal(midbrain.target, "midbrain");
  assert.deepEqual(midbrain.componentGlosses, ["centre", "brain"]);
  assert.deepEqual(midbrain.pyashSequence, ["hset", "twum"]);
  assert.equal(midbrain.head, "brain");
  assert.equal(midbrain.specificAtom, "midbrain");

  const brainstorming = entries.find((entry) => entry.surface === "头脑风暴");
  assert.ok(brainstorming);
  assert.equal(brainstorming.target, "brain_storming");
  assert.deepEqual(brainstorming.componentGlosses, ["brain", "storm"]);
  assert.deepEqual(brainstorming.pyashSequence, ["twum", "hfup"]);
  assert.equal(brainstorming.head, "storm");
  assert.equal(brainstorming.specificAtom, "brain_storming");

  const curated = await loadCompoundLexicon({
    url: new URL("../program/library/translation/compound_coverage_curated.pya", import.meta.url),
    name: "translation_compounds_derived_curated",
    language: "canonical"
  });
  assert.equal(curated.find((entry) => entry.surface === "brainstorm")?.specificAtom, "brain_storming");
  assert.deepEqual(
    queryCompoundLexicon(curated, { specificAtom: "brain_storming" }).map((entry) => entry.surface),
    ["brainstorm"]
  );

  // gpu is a video processor module: the compound records that reading
  // instead of leaving the token uncovered.
  const gpu = curated.find((entry) => entry.surface === "gpu");
  assert.ok(gpu);
  assert.deepEqual(gpu.morphemes, ["video", "processor", "module"]);
  assert.deepEqual(gpu.componentGlosses, ["video", "processor", "module"]);
  assert.deepEqual(gpu.pyashSequence, ["byot", "ples", "myoc"]);
  assert.deepEqual(gpu.componentLayers, [24, 19, 19]);
  assert.equal(gpu.head, "module");
  assert.equal(gpu.status, "accepted-curated");

  const byMorpheme = queryChineseCompoundLexicon(entries, { morpheme: "语" });
  assert.deepEqual(byMorpheme.map((entry) => entry.surface), ["语言"]);
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { morpheme: "脑" }).map((entry) => entry.surface),
    ["小脑", "中脑"]
  );
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { morpheme: "头脑" }).map((entry) => entry.surface),
    ["头脑风暴"]
  );
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { status: "unlowered" }).map((entry) => entry.surface),
    ["语言"]
  );
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { maxLayer: 19 }).map((entry) => entry.surface),
    ["数据库", "小脑", "中脑"]
  );
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { pyashWord: "cren" }).map((entry) => entry.surface),
    ["数据库"]
  );
  assert.deepEqual(
    queryChineseCompoundLexicon(entries, { pyashWord: "twum" }).map((entry) => entry.surface),
    ["小脑", "中脑", "头脑风暴"]
  );
});

test("compound loading links exact atoms and preserves reverse atom lookup", () => {
  const source = [
    "su name translation_compounds_fixture be map def",
    `su text "database" ob text ${JSON.stringify(JSON.stringify({
      surface: "database",
      morphemes: ["data", "storehouse"],
      target: "database",
      componentGlosses: ["data", "storehouse"],
      pyashSequence: ["hnuc", "cren"],
      componentLayers: [16, 19],
      maxLayer: 19,
      provenance: "fixture",
      confidence: "curated",
      status: "lowered-compound"
    }))} ya`,
    `su text "brainstorm" ob text ${JSON.stringify(JSON.stringify({
      surface: "brainstorm",
      morphemes: ["brain", "storm"],
      target: "brainstorm",
      specificAtom: "brain_storming",
      componentGlosses: ["brain", "storm"],
      pyashSequence: ["twum", "hfup"],
      componentLayers: [16, 16],
      maxLayer: 16,
      provenance: "fixture",
      confidence: "curated",
      status: "accepted-curated"
    }))} ya`,
    "prah"
  ].join("\n");
  const atomicEntries = [
    { en: "database", pya: "hdes" },
    { en: "brain_storming", pya: "hto7n" }
  ];
  const entries = parseCompoundLexicon(source, {
    name: "translation_compounds_fixture",
    language: "fixture",
    atomicEntries
  });
  assert.equal(entries.find((entry) => entry.target === "database").specificAtom, "database");
  assert.equal(entries.find((entry) => entry.target === "brainstorm").specificAtom, "brain_storming");

  const links = buildCompoundAtomLinks({ atomicEntries, compoundEntries: entries });
  assert.equal(links.compoundToAtom.get(entries[0].id).atom.pya, "hdes");
  assert.deepEqual(
    links.atomToCompounds.get("brain_storming").map((link) => link.compound.surface),
    ["brainstorm"]
  );
});

test("Chinese compound lexicon rejects malformed and duplicated rows", () => {
  const malformed = [
    "su name translation_compounds_chinese be map def",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数据\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parseChineseCompoundLexicon(malformed),
    (error) => error.code === "invalid-compound-lexicon" && /two ordered morphemes/u.test(error.message)
  );

  const duplicate = [
    "su name translation_compounds_chinese be map def",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数据\\\",\\\"库\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "su text \"数据库\" ob text \"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数\\\",\\\"据库\\\"],\\\"target\\\":\\\"database\\\",\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"low\\\",\\\"status\\\":\\\"unlowered\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parseChineseCompoundLexicon(duplicate),
    (error) => error.code === "invalid-compound-lexicon" && /duplicated/u.test(error.message)
  );

  const unpairedLayerMetadata = [
    "su name translation_compounds_chinese be map def",
    "su text \"数据库\" ob text " +
      "\"{\\\"surface\\\":\\\"数据库\\\",\\\"morphemes\\\":[\\\"数据\\\",\\\"库\\\"],\\\"target\\\":\\\"database\\\",\\\"pyashSequence\\\":[\\\"hnuc\\\",\\\"cren\\\"],\\\"provenance\\\":\\\"test\\\",\\\"confidence\\\":\\\"curated\\\",\\\"status\\\":\\\"lowered-compound\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parseChineseCompoundLexicon(unpairedLayerMetadata),
    (error) => error.code === "invalid-compound-lexicon" && /paired/u.test(error.message)
  );
});
