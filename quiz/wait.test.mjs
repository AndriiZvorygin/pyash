import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { wait } from "../program/verbs/wait.mjs";

test("wait verb handler returns wait fact", async () => {
  forget();
  const result = await wait(parse("be wait do"));
  assert.equal(result?.be, "wait");
});

test("wait imperative sentence is accepted by interpreter", async () => {
  forget();
  await interpret(parse("be wait do"));
});
