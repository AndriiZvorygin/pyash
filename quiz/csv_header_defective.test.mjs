import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("csv rejects duplicate canonical headers", async () => {
  forget();
  const csv = "Name, name\nAda,36\n";
  await assert.rejects(
    () => run(`ob text quoted.csv.${csv}.csv.quoted from state csv to name people be read do`),
    /csv header defective/
  );
});
