import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { addCuratedCompoundCatalogEntry } from "../program/library/translation/curated_compound_catalog.mjs";
import { loadCuratedCompoundDecompositions, buildDerivedCompoundCoverage } from "../program/library/translation/compound_coverage.mjs";
import { loadCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import { matchVliwCompound } from "../program/library/vliw/compound_dictionary.mjs";

const atomicEntries = [
  { en: "prediction", pya: "bjin" },
  { en: "number", pya: "hnuc" },
  { en: "magnitude", pya: "gjat" }
];
const layerIndex = {
  byWord: new Map([["bjin", 16], ["hnuc", 16], ["gjat", 19]])
};

async function makeCatalog(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-compound-catalog-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const catalogPath = path.join(directory, "compounds.pya");
  await fs.writeFile(catalogPath, [
    "su name translation_compounds_derived_curated be map def",
    "prah",
    ""
  ].join("\n"));
  return catalogPath;
}

test("curated compound authoring writes an atom-backed gloss and is idempotent", async (t) => {
  const catalogPath = await makeCatalog(t);
  const input = {
    catalogUrl: catalogPath,
    surface: "prediction value",
    gloss: "a numerical output produced by a model",
    components: ["prediction", "number", "magnitude"],
    atomicEntries,
    layerIndex
  };

  const added = await addCuratedCompoundCatalogEntry(input);
  const repeated = await addCuratedCompoundCatalogEntry(input);
  assert.equal(added.status, "added");
  assert.equal(repeated.status, "already-present");

  const entries = await loadCompoundLexicon({
    url: catalogPath,
    name: "translation_compounds_derived_curated",
    language: "canonical",
    atomicEntries
  });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].pyashSequence, ["bjin", "hnuc", "gjat"]);
  assert.deepEqual(entries[0].componentLayers, [16, 16, 19]);
  assert.equal(entries[0].gloss, "a numerical output produced by a model");
  assert.equal(entries[0].head, "magnitude");

  const vliw = matchVliwCompound(entries[0].pyashSequence, 0, entries);
  assert.equal(vliw.english, "a numerical output produced by a model");

  const curated = await loadCuratedCompoundDecompositions({
    url: pathToFileURL(catalogPath),
    wordnetUrl: pathToFileURL(path.join(path.dirname(catalogPath), "missing.pya"))
  });
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    curatedDecompositions: curated,
    layerIndex: {
      ...layerIndex,
      englishToPyash: new Map(atomicEntries.map((entry) => [entry.en, entry.pya]))
    }
  });
  assert.equal(coverage.accepted[0].gloss, "a numerical output produced by a model");
});

test("curated compound authoring rejects unknown atoms and conflicting sequences", async (t) => {
  const catalogPath = await makeCatalog(t);
  const input = {
    catalogUrl: catalogPath,
    surface: "prediction value",
    gloss: "model output",
    components: ["prediction", "number", "not-an-atom"],
    atomicEntries,
    layerIndex
  };

  await assert.rejects(
    addCuratedCompoundCatalogEntry(input),
    /existing atom/u
  );
  await assert.rejects(
    addCuratedCompoundCatalogEntry({
      ...input,
      surface: "prediction",
      components: ["prediction", "number"]
    }),
    /already an atomic vocabulary item/u
  );

  await addCuratedCompoundCatalogEntry({ ...input, components: ["prediction", "number", "magnitude"] });
  await assert.rejects(
    addCuratedCompoundCatalogEntry({
      ...input,
      surface: "different label",
      components: ["prediction", "number", "magnitude"]
    }),
    /already assigned/u
  );
});
