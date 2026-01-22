import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

async function withCommandResponse(value, fn) {
  process.env.PYA_COMMAND_RESPONSE = JSON.stringify(value);
  try {
    await fn();
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
  }
}

test("list module supports file/dir/recursive signatures", async () => {
  const modulePath = path.join(process.cwd(), "module", "list_directory.pya");

  await withCommandResponse(["a.txt"], async () => {
    forget();
    await run(`from filename "${modulePath}" ob name list to name list be import do`);
    const res = await run("be list as wo file do");
    assert.deepEqual(res?.result?.ve?.values, ["a.txt"]);
  });

  await withCommandResponse(["docs"], async () => {
    forget();
    await run(`from filename "${modulePath}" ob name list to name list be import do`);
    const res = await run("be list as wo dir do");
    assert.deepEqual(res?.result?.ve?.values, ["docs"]);
  });

  await withCommandResponse(["a.txt", "b.txt"], async () => {
    forget();
    await run(`from filename "${modulePath}" ob name list to name list be import do`);
    const res = await run("be list as wo recursive do");
    assert.deepEqual(res?.result?.ve?.values, ["a.txt", "b.txt"]);
  });
});
