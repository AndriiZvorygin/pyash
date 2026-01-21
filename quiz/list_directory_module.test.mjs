import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("list module returns vector name with entries", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = "[\"alpha.txt\",\"beta.txt\"]";
  try {
    const modulePath = path.join(process.cwd(), "module", "list_directory.pya");
    await run(`from filename "${modulePath}" ob name list to name list be import do`);
    const result = await run("be list do");
    assert.equal(result?.invoked, "list");
    assert.deepEqual(result?.result?.ve?.values, ["alpha.txt", "beta.txt"]);
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    forget();
  }
});
