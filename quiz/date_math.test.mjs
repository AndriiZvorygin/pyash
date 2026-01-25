import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("date math adds days to a date", async () => {
  forget();
  await run("exists su name base ob date 2025-01-20T00:00:00Z be record ya");
  await run("ob day 3 to name base be plus do");
  const res = await run("su name base ob what que");
  assert.deepEqual(res, "exists su name base ob date 2025-01-23T00:00:00.000Z be date ya");
});

test("date math subtracts hours from a date", async () => {
  forget();
  await run("exists su name base ob date 2025-01-20T12:00:00Z be record ya");
  await run("ob hour 4 from name base be subtract do");
  const res = await run("su name base ob what que");
  assert.deepEqual(res, "exists su name base ob date 2025-01-20T08:00:00.000Z be date ya");
});

test("date math adds months to a date", async () => {
  forget();
  await run("exists su name base ob date 2025-01-20T00:00:00Z be record ya");
  await run("ob month 1 to name base be plus do");
  const res = await run("su name base ob what que");
  assert.deepEqual(res, "exists su name base ob date 2025-02-20T00:00:00.000Z be date ya");
});
