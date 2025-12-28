import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function snapshotCsvMap(name) {
  const fact = remember(name);
  assert.equal(fact?.be, "csv map");
  const map = fact?.ob?.map ?? {};
  const header = map.header?.ve?.values ?? [];
  const columns = header.map((key) => map[key]?.ve?.values ?? []);
  return { header, columns };
}

test("compile bank fixture csv roundtrip to javascript and run", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Bank Transaction.csv");
  const fixtureBuf = await fs.readFile(fixturePath);
  const fixtureHash = sha256(fixtureBuf);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-js-fixture-"));
  const outPath = path.join(tmpDir, "bank-transaction.roundtrip.csv");

  forget();
  await interpret(parse(`from filename "${fixturePath}" from state csv to name people be read do`));
  const original = snapshotCsvMap("people");

  const pyash = [
    `from filename "${fixturePath}" from state csv to name people be read do`,
    `ob name people to state csv to filename "${outPath}" be write do`
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const jsPath = path.join(tmpDir, "out.mjs");
  await fs.writeFile(jsPath, js, "utf8");

  await execFileAsync("node", [jsPath], { timeout: 120000 });

  forget();
  await interpret(parse(`from filename "${outPath}" from state csv to name roundtrip be read do`));
  const roundtrip = snapshotCsvMap("roundtrip");

  assert.deepEqual(roundtrip, original);

  const fixtureBufAfter = await fs.readFile(fixturePath);
  const fixtureHashAfter = sha256(fixtureBufAfter);
  assert.equal(fixtureHashAfter, fixtureHash, "fixture must remain unchanged");
});
