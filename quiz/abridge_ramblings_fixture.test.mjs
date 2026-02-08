import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import abridge from "../program/verbs/abridge.mjs";
import { forget } from "../program/remember/index.mjs";

test("abridge fixture keeps key lines while collapsing repeated blocks", async () => {
  forget();

  const source = await fs.readFile("quiz/fixtures/ramblings.txt", "utf8");
  const inputBytes = Buffer.byteLength(source, "utf8");
  const budgetBytes = Math.floor(inputBytes * 0.35);
  const result = await abridge({ from: { text: source }, atmost: { byte: budgetBytes } });
  const output = String(result?.ob?.text ?? "");

  assert.ok(Buffer.byteLength(output, "utf8") <= budgetBytes);

  const scheduleCount = (output.match(/Saturday, 10:00 to 14:00/g) ?? []).length;
  assert.equal(scheduleCount, 1);

  const costsHeaderCount = (output.match(/Estimated costs per person:/g) ?? []).length;
  assert.equal(costsHeaderCount, 1);

  const decisionCount = (output.match(/^Decision:/gm) ?? []).length;
  const actionCount = (output.match(/^Action:/gm) ?? []).length;
  assert.ok(decisionCount >= 1);
  assert.ok(actionCount >= 1);

  const safetyCount = (output.match(/Safety is critical\./g) ?? []).length;
  assert.equal(safetyCount, 1);
});
