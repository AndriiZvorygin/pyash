import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "../program/understand/index.mjs";
import {
  PYAC_CODELET_BYTES,
  PYAC_HEADER_BYTES,
  buildVliwDatabase,
  decodePyacPack,
  encodePyacPack,
  parseVliwCatalogPya,
  queryVliwCatalog,
  readVliwDatabaseFiles,
  renderVliwCatalogPya,
  replayVliwDatabase,
  writeVliwDatabaseFiles
} from "../program/library/vliw/index.mjs";
import { PyacDatabaseError } from "../program/library/vliw/database.mjs";

const plusSentence = (left, right) => parse(`ob num ${left} to num ${right} be plus do`);

test("PyAC packs preserve exact fixed-width VLIW codelet bytes", () => {
  const database = buildVliwDatabase([plusSentence(4, 6)]);
  const decoded = decodePyacPack(database.pack);

  assert.equal(database.pack.byteLength, PYAC_HEADER_BYTES + PYAC_CODELET_BYTES);
  assert.equal(database.catalog.packHash.length, 64);
  assert.deepEqual(Array.from(decoded.codelets[0]), database.catalog.records[0].words);
  assert.equal(decoded.wordsPerCodelet, 16);
  assert.equal(decoded.wordBits, 16);

  const rebuilt = encodePyacPack(decoded.codelets);
  assert.deepEqual(Array.from(rebuilt), Array.from(database.pack));
});

test("PyAC catalogs retain executable and unsupported semantic records", () => {
  const database = buildVliwDatabase([
    plusSentence(1, 1),
    parse('ob text "opaque" to name target be plus do')
  ], {
    sources: [{ language: "pyash" }, { language: "pyash" }]
  });

  assert.equal(database.catalog.recordCount, 2);
  assert.equal(database.catalog.executableCount, 1);
  assert.equal(database.catalog.unsupportedCount, 1);
  assert.equal(database.catalog.records[0].status, "executable");
  assert.equal(database.catalog.records[0].source.language, "pyash");
  assert.equal(database.catalog.records[1].status, "unsupported");
  assert.equal(database.catalog.records[1].error.code, "numeric-range");
  assert.match(database.catalog.records[1].error.message, /numeric-plus/iu);
});

test("PyAC queries select semantic, case, word, and value indexes", () => {
  const database = buildVliwDatabase([
    plusSentence(4, 6),
    plusSentence(8, 9),
    plusSentence(16, 9)
  ]);

  assert.equal(queryVliwCatalog(database, { semantic: "numeric-plus" }).length, 3);
  assert.equal(queryVliwCatalog(database, { verb: "plus", case: "to", value: 6 }).length, 1);
  assert.equal(queryVliwCatalog(database, { word: 0x8a64 }).length, 3);
  assert.equal(queryVliwCatalog(database, { status: "unsupported" }).length, 0);
});

test("PyAC catalog projection round-trips through parser-backed .pya text", () => {
  const database = buildVliwDatabase([plusSentence(2, 3)]);
  const source = renderVliwCatalogPya(database, { packLocator: "artifacts/sample.pyac" });
  const parsed = parseVliwCatalogPya(source);

  assert.equal(parsed.catalog.format, "pyac-catalog-v1");
  assert.equal(parsed.catalog.packFormat, "pyac-vliw-1");
  assert.equal(parsed.catalog.packHash, database.catalog.packHash);
  assert.deepEqual(parsed.catalog.records, database.catalog.records);
});

test("PyAC files persist and reopen with the same catalog/pack linkage", () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-pyac-"));
  const catalogPath = join(directory, "sample.pya");
  const packPath = join(directory, "sample.pyac");
  const database = buildVliwDatabase([plusSentence(7, 5)]);

  writeVliwDatabaseFiles(database, { catalogPath, packPath });
  const reopened = readVliwDatabaseFiles({ catalogPath, packPath });

  assert.equal(readFileSync(packPath).byteLength, database.pack.byteLength);
  assert.equal(reopened.catalog.packHash, database.catalog.packHash);
  assert.deepEqual(Array.from(reopened.pack), Array.from(database.pack));
});

test("PyAC replay verifies catalog expectations and preserves unsupported outcomes", async () => {
  const database = buildVliwDatabase([
    plusSentence(4, 6),
    parse("ob num 2 to num 3 be subtract do")
  ], {
    expectedResults: [{
      su: { name: "result" },
      ob: { num: 10 },
      be: "number",
      mood: "ya"
    }]
  });

  const outcomes = await replayVliwDatabase(database);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].status, "replayed");
  assert.equal(outcomes[0].verified, true);
  assert.deepEqual(outcomes[0].result.ob, { num: 10 });
  assert.equal(outcomes[1].status, "replayed");
  assert.equal(outcomes[1].result.ob.num, -1);
});

test("PyAC rejects noisy, malformed, and tampered binary output", async () => {
  const database = buildVliwDatabase([plusSentence(1, 2)]);
  const noisy = new Uint8Array(database.pack.byteLength + 1);
  noisy.set(database.pack);
  noisy[noisy.length - 1] = 0xff;

  assert.throws(
    () => decodePyacPack(noisy),
    (error) => error instanceof PyacDatabaseError && error.code === "truncated-pack"
  );

  const invalidMagic = new Uint8Array(database.pack);
  invalidMagic[0] = "X".charCodeAt(0);
  assert.throws(
    () => decodePyacPack(invalidMagic),
    (error) => error instanceof PyacDatabaseError && error.code === "invalid-magic"
  );

  const tampered = new Uint8Array(database.pack);
  tampered[PYAC_HEADER_BYTES + 2] ^= 0x01;
  await assert.rejects(
    () => replayVliwDatabase({ catalog: database.catalog, pack: tampered }),
    (error) => error instanceof PyacDatabaseError && error.code === "pack-hash-mismatch"
  );
});
