import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("genitive read + add updates map entry", async () => {
  forget();

  await run("subj name profile be json map def");
  await run("subj name count obj num 2 ya");
  await run("subj name profile be json map prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("obj count of profile be write do");
    await run("obj num 1 to count of profile be add do");
    await run("obj count of profile be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["2", "3"]);

  const profile = remember("profile");
  assert.equal(profile?.obj?.map?.count, 3);
});
