import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function firstDiffLocation(expected, actual) {
  const max = Math.max(expected.length, actual.length);
  let line = 1;
  let column = 1;
  for (let i = 0; i < max; i += 1) {
    const a = expected[i];
    const b = actual[i];
    if (a !== b) return { line, column };
    if (a === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return null;
}

test("csv fixture roundtrip is byte-for-byte and fixture unchanged", async () => {
  forget();

  const fixturePath = path.resolve("quiz/fixtures/Bank Transaction.csv");
  const fixtureBuf = await fs.readFile(fixturePath);
  const fixtureHash = sha256(fixtureBuf);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-fixture-"));
  const outPath = path.join(tmpDir, "bank-transaction.roundtrip.csv");

  await interpret(parse(`from filename "${fixturePath}" from state csv to name people be read do`));
  await interpret(parse(`ob name people to state csv to filename "${outPath}" be write do`));

  const outBuf = await fs.readFile(outPath);
  const fixtureBufAfter = await fs.readFile(fixturePath);
  const fixtureHashAfter = sha256(fixtureBufAfter);

  assert.equal(fixtureHashAfter, fixtureHash, "fixture must remain unchanged");
  if (!fixtureBuf.equals(outBuf)) {
    const diff = firstDiffLocation(fixtureBuf.toString("utf8"), outBuf.toString("utf8"));
    const location = diff ? `line ${diff.line}, column ${diff.column}` : "unknown location";
    assert.fail(`csv roundtrip mismatch at ${location}`);
  }
});
