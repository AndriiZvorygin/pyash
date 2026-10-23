import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPyacDatabase } from "../command/pyac_database.mjs";
import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";

function tempPaths() {
  const directory = mkdtempSync(join(tmpdir(), "pyash-pyac-command-"));
  return {
    directory,
    source: join(directory, "corpus.pya"),
    catalog: join(directory, "corpus-catalog.pya"),
    pack: join(directory, "corpus.pyac")
  };
}

test("PyAC database command builds deterministic catalog and pack files", async () => {
  const first = tempPaths();
  const source = [
    "ob num 4 to num 6 be plus do",
    "ob num 8 to num 9 be plus do",
    "ob num 7 be number ya",
    "ob text \"A\" be text ya",
    "ob text \"opaque\" to name collector be plus do",
    "ob text \"different\" to name collector be plus do",
    "prah"
  ].join("\n");
  writeFileSync(first.source, source, "utf8");

  const firstBuild = await runPyacDatabase(["build", first.source, first.catalog, first.pack], { report: () => {} });
  const firstCatalog = readFileSync(first.catalog);
  const firstPack = readFileSync(first.pack);
  assert.equal(firstBuild.sentenceCount, 6);
  assert.equal(firstBuild.executableCount, 4);
  assert.equal(firstBuild.unsupportedCount, 2);

  const secondBuild = await runPyacDatabase(["build", first.source, first.catalog, first.pack], { report: () => {} });
  assert.deepEqual(readFileSync(first.catalog), firstCatalog);
  assert.deepEqual(readFileSync(first.pack), firstPack);
  assert.equal(secondBuild.packHash, firstBuild.packHash);

  const parsed = parseVliwCatalogPya(firstCatalog.toString("utf8"));
  const semanticQuery = await runPyacDatabase(
    ["query", first.catalog, first.pack, "semantic", "numeric-plus"],
    { report: () => {} }
  );
  assert.equal(semanticQuery.count, 2);
  assert.equal(parsed.catalog.records.length, 6);

  const replay = await runPyacDatabase(["replay", first.catalog, first.pack], { report: () => {} });
  assert.equal(replay.count, 6);
  assert.equal(replay.outcomes.filter((outcome) => outcome.status === "replayed").length, 4);
  assert.equal(replay.outcomes.filter((outcome) => outcome.status === "unsupported").length, 2);
});

test("PyAC database command queries records and replays one stable identity", async () => {
  const paths = tempPaths();
  writeFileSync(paths.source, "ob num 4 to num 6 be plus do\n", "utf8");
  await runPyacDatabase(["build", paths.source, paths.catalog, paths.pack], { report: () => {} });

  const query = await runPyacDatabase(
    ["query", paths.catalog, paths.pack, "canonicalIncludes", "plus"],
    { report: () => {} }
  );
  assert.equal(query.count, 1);
  const [record] = query.records;
  assert.match(record.id, /^codelet-[0-9a-f]{24}$/);

  const replay = await runPyacDatabase(
    ["replay", paths.catalog, paths.pack, record.id],
    { report: () => {} }
  );
  assert.deepEqual(replay.outcomes.map((outcome) => outcome.id), [record.id]);
  assert.equal(replay.outcomes[0].verified, true);
});
