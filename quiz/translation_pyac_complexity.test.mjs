import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  PYAC_COMPLEXITY_LAYERS_FORMAT,
  buildPyacWordLayerIndex,
  choosePyacCompoundCandidate,
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex,
  parsePyacComplexityLayers,
  classifyPyacWord
} from "../program/library/translation/pyac_complexity.mjs";

const layerLists = {
  16: "hnuc\nhcas\n",
  19: "hnuc\nhcas\ncren\n",
  24: "hnuc\nhcas\ncren\nhdes\n",
  28: "hnuc\nhcas\ncren\nhdes\ndxak\n",
  32: "hnuc\nhcas\ncren\nhdes\ndxak\nhtu7k\n"
};

test("Pyac complexity manifest preserves the five cumulative layers", async () => {
  const source = await fs.readFile(
    new URL("../program/library/translation/pyac_complexity_layers.pya", import.meta.url),
    "utf8"
  );
  const parsed = parsePyacComplexityLayers(source);
  assert.equal(parsed.format, PYAC_COMPLEXITY_LAYERS_FORMAT);
  assert.deepEqual(parsed.layers.map((layer) => layer.layer), [16, 19, 24, 28, 32]);
  assert.equal(parsed.layers[0].wordList, "16GlyphWordList.txt");
  assert.equal(parsed.layers[0].features, "base-unvoiced");
  assert.equal(parsed.layers[4].adds, "1278");
  assert.equal(parsed.layers[4].features, "tones-and-clicks");
  assert.deepEqual(await loadPyacComplexityLayers(), parsed);
});

test("exact word membership yields the minimum progressive layer", () => {
  const manifest = parsePyacComplexityLayers([
    "su name translation_pyac_complexity_layers be map def",
    "su text \"format\" ob text \"pyac-complexity-layers-v1\" ya",
    ...[16, 19, 24, 28, 32].map((layer) => (
      `su text \"layer:${layer}\" ob text \"{\\\"layer\\\":${layer},\\\"glyphCount\\\":${layer},\\\"wordList\\\":\\\"${layer}GlyphWordList.txt\\\",\\\"source\\\":\\\"test\\\",\\\"wordGlyphs\\\":\\\"abc\\\",\\\"features\\\":\\\"test\\\",\\\"adds\\\":\\\"\\\",\\\"sourceHash\\\":\\\"test-hash\\\"}\" ya`
    )),
    "prah"
  ].join("\n"));
  const index = buildPyacWordLayerIndex({ manifest, wordLists: layerLists });

  assert.equal(classifyPyacWord("hnuc", index), 16);
  assert.equal(classifyPyacWord("cren", index), 19);
  assert.equal(classifyPyacWord("hdes", index), 24);
  assert.equal(classifyPyacWord("dxak", index), 28);
  assert.equal(classifyPyacWord("missing", index), null);
});

test("progressive ranking selects number shed over a higher-layer data-mining candidate", () => {
  const manifest = parsePyacComplexityLayers([
    "su name translation_pyac_complexity_layers be map def",
    "su text \"format\" ob text \"pyac-complexity-layers-v1\" ya",
    ...[16, 19, 24, 28, 32].map((layer) => (
      `su text \"layer:${layer}\" ob text \"{\\\"layer\\\":${layer},\\\"glyphCount\\\":${layer},\\\"wordList\\\":\\\"${layer}GlyphWordList.txt\\\",\\\"source\\\":\\\"test\\\",\\\"wordGlyphs\\\":\\\"abc\\\",\\\"features\\\":\\\"test\\\",\\\"adds\\\":\\\"\\\",\\\"sourceHash\\\":\\\"test-hash\\\"}\" ya`
    )),
    "prah"
  ].join("\n"));
  const index = buildPyacWordLayerIndex({ manifest, wordLists: layerLists });
  const selected = choosePyacCompoundCandidate([
    { pyashSequence: ["dxak"], componentLayers: [28], evidence: "data mining" },
    { pyashSequence: ["hnuc", "cren"], componentLayers: [16, 19], evidence: "number shed" }
  ], index);

  assert.deepEqual(selected.pyashSequence, ["hnuc", "cren"]);
  assert.equal(selected.maxLayer, 19);
});

test("complexity parser rejects duplicate or incomplete layer rows", () => {
  const duplicate = [
    "su name translation_pyac_complexity_layers be map def",
    "su text \"format\" ob text \"pyac-complexity-layers-v1\" ya",
    "su text \"layer:16\" ob text \"{\\\"layer\\\":16,\\\"glyphCount\\\":16,\\\"wordList\\\":\\\"16GlyphWordList.txt\\\",\\\"source\\\":\\\"test\\\",\\\"wordGlyphs\\\":\\\"abc\\\",\\\"features\\\":\\\"test\\\",\\\"adds\\\":\\\"\\\",\\\"sourceHash\\\":\\\"test-hash\\\"}\" ya",
    "su text \"layer:16\" ob text \"{\\\"layer\\\":16,\\\"glyphCount\\\":16,\\\"wordList\\\":\\\"16GlyphWordList.txt\\\",\\\"source\\\":\\\"test\\\",\\\"wordGlyphs\\\":\\\"abc\\\",\\\"features\\\":\\\"test\\\",\\\"adds\\\":\\\"\\\",\\\"sourceHash\\\":\\\"test-hash\\\"}\" ya",
    "prah"
  ].join("\n");
  assert.throws(
    () => parsePyacComplexityLayers(duplicate),
    (error) => error.code === "invalid-pyac-complexity-layers" && /duplicated/u.test(error.message)
  );
});

test("authoritative pyachso2n lists classify the canonical compound examples", async (t) => {
  const root = "/home/htaf/pyachso2n";
  const files = [16, 19, 24, 28, 32].map((layer) => `${root}/${layer}GlyphWordList.txt`);
  try {
    await Promise.all(files.map((file) => fs.access(file)));
  } catch {
    t.skip("pyachso2n source lists are unavailable");
    return;
  }
  const manifest = await loadPyacComplexityLayers();
  const index = await loadPyacWordLayerIndex({ manifest, directory: root });
  assert.equal(classifyPyacWord("hnuc", index), 16);
  assert.equal(classifyPyacWord("cren", index), 19);
  assert.equal(classifyPyacWord("hdes", index), 24);
  assert.equal(classifyPyacWord("dxak", index), 28);
  assert.equal(classifyPyacWord("htu7k", index), 32);

  const tampered = {
    ...manifest,
    layers: manifest.layers.map((layer, index) => index === 0
      ? { ...layer, sourceHash: "tampered" }
      : layer)
  };
  await assert.rejects(
    () => loadPyacWordLayerIndex({ manifest: tampered, directory: root }),
    (error) => error.code === "invalid-pyac-complexity-layers" && /source hash/u.test(error.message)
  );
});
