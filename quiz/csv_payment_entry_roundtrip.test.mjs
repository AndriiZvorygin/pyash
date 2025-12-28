import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import crypto from "node:crypto";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

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

test("csv payment entry fixture parses and roundtrips semantically (interpreter)", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Payment Entry.csv");
  const fixtureBuf = await fs.readFile(fixturePath);
  const fixtureHash = sha256(fixtureBuf);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-payment-"));
  const outPath = path.join(tmpDir, "payment-entry.roundtrip.csv");

  forget();
  await interpret(parse(`from filename "${fixturePath}" from state csv to name people be read do`));
  const original = snapshotCsvMap("people");
  assert.ok(original.header.includes("name"));
  assert.ok(original.header.includes("payment_type"));

  await interpret(parse(`ob name people to state csv to filename "${outPath}" be write do`));
  await interpret(parse(`from filename "${outPath}" from state csv to name roundtrip be read do`));
  const roundtrip = snapshotCsvMap("roundtrip");

  assert.deepEqual(roundtrip, original);

  const fixtureBufAfter = await fs.readFile(fixturePath);
  const fixtureHashAfter = sha256(fixtureBufAfter);
  assert.equal(fixtureHashAfter, fixtureHash, "fixture must remain unchanged");
});
