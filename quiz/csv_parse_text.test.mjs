import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("csv parses text into column map with header raw/header and padding", async () => {
  forget();

  const csv = "Name,Age\nAda,36\nTuring\n";
  await run(`ob text quoted.csv.${csv}.csv.quoted from state csv to name people be read do`);

  const people = remember("people");
  assert.equal(people?.be, "csv map");

  const headerRaw = people?.ob?.map?.["header raw"];
  assert.deepEqual(headerRaw?.ve?.values, ["Name", "Age"]);

  const header = people?.ob?.map?.header;
  assert.deepEqual(header?.ve?.values, ["name", "age"]);

  const nameCol = people?.ob?.map?.name;
  const ageCol = people?.ob?.map?.age;
  assert.deepEqual(nameCol?.ve?.values, ["Ada", "Turing"]);
  assert.deepEqual(ageCol?.ve?.values, ["36", ""]);
});
