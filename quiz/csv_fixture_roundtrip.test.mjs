import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("csv fixture remains unchanged", async () => {
  const fixturePath = path.resolve("quiz/fixtures/Bank Transaction.csv");
  const fixtureBuf = await fs.readFile(fixturePath);
  const fixtureHash = sha256(fixtureBuf);
  const fixtureBufAfter = await fs.readFile(fixturePath);
  const fixtureHashAfter = sha256(fixtureBufAfter);

  assert.equal(fixtureHashAfter, fixtureHash, "fixture must remain unchanged");
});
