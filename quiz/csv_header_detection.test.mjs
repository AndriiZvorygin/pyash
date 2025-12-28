import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(pyash) {
  return interpret(parse(pyash));
}

test("csv detects header by width mode in non-template files", async () => {
  const csv = "1,2\nName,Age\nAda,36\nTuring,41\n";
  forget();
  await run(`ob text quoted.csv.${csv}.csv.quoted from state csv to name people be read do`);

  const fact = remember("people");
  assert.equal(fact?.be, "csv map");
  const header = fact?.ob?.map?.header?.ve?.values ?? [];
  assert.deepEqual(header, ["name", "age"]);
});
