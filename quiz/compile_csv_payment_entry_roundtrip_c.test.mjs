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

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile payment entry fixture csv roundtrip to C and run", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Payment Entry.csv");
  const fixtureBuf = await fs.readFile(fixturePath);
  const fixtureHash = sha256(fixtureBuf);

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-c-payment-"));
  const outPath = path.join(outDir, "payment-entry.roundtrip.csv");

  forget();
  await interpret(parse(`from filename "${fixturePath}" from state csv to name people be read do`));
  const original = snapshotCsvMap("people");
  assert.ok(original.header.includes("name"));
  assert.ok(original.header.includes("payment_type"));

  const pyash = [
    `from filename "${fixturePath}" from state csv to name people be read do`,
    `ob name people to state csv to filename "${outPath}" be write do`
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const c = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");

  const cPath = path.join(outDir, "out.c");
  const exePath = path.join(outDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  const needsCsv = /PYA_CSV_RUNTIME/.test(c);
  const zsvFlags = needsCsv ? ["-Icaterer/zsv/include", "-Icaterer/zsv/src"] : [];
  const zsvSrc = needsCsv ? ["caterer/zsv/src/zsv.c"] : [];
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, ...zsvFlags, cPath, ...zsvSrc, "-lm"], { timeout: 120000 });
  await execFileAsync(exePath, [], { timeout: 120000 });

  forget();
  await interpret(parse(`from filename "${outPath}" from state csv to name roundtrip be read do`));
  const roundtrip = snapshotCsvMap("roundtrip");

  assert.deepEqual(roundtrip, original);

  const fixtureBufAfter = await fs.readFile(fixturePath);
  const fixtureHashAfter = sha256(fixtureBufAfter);
  assert.equal(fixtureHashAfter, fixtureHash, "fixture must remain unchanged");
});
