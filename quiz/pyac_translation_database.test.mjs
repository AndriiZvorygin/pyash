import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPyacDatabase } from "../command/pyac_database.mjs";
import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";

test("translation database build preserves lines and skips blank input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-pyac-translation-"));
  const source = join(directory, "english.txt");
  const catalog = join(directory, "english-catalog.pya");
  const pack = join(directory, "english.pyac");
  writeFileSync(source, [
    "collector is number 5.",
    "",
    "add 2 to collector."
  ].join("\n"), "utf8");

  const result = await runPyacDatabase([
    "build-translation", "english", source, catalog, pack
  ], { report: () => {} });
  assert.equal(result.sentenceCount, 2);
  assert.equal(result.executableCount, 1);
  assert.equal(result.unsupportedCount, 1);

  const parsed = parseVliwCatalogPya(readFileSync(catalog, "utf8"));
  assert.equal(parsed.catalog.records[0].source.lineIndex, 0);
  assert.equal(parsed.catalog.records[1].source.lineIndex, 2);
  const query = await runPyacDatabase([
    "query", catalog, pack, "sourceLine", "2"
  ], { report: () => {} });
  assert.equal(query.count, 1);
  assert.equal(query.records[0].source.language, "english");

  const provenance = await runPyacDatabase([
    "query", catalog, pack, "sourceLocator", source
  ], { report: () => {} });
  assert.equal(provenance.count, 2);
  assert.equal(provenance.records[0].source.sentenceIndex, 0);

  const writes = await runPyacDatabase([
    "query", catalog, pack, "writes", "collector"
  ], { report: () => {} });
  assert.equal(writes.count, 1);
  assert.deepEqual(writes.records[0].effects, {
    reads: [],
    writes: ["collector"],
    sideEffect: false
  });
});
