import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("csv rejects rows with too many fields", async () => {
  forget();
  const csv = "Name,Age\nAda,36,extra\n";
  await assert.rejects(
    () => run(`ob text quoted.csv.${csv}.csv.quoted from state csv to name people be read do`),
    /csv row defective/
  );
});
