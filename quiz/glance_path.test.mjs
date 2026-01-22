import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("glance returns metadata map", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "glance-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");

  const res = await run(`be glance ob filename "${file}" do`);
  const name = res?.value?.name;
  assert.ok(name);
  const map = remember(name)?.ob?.map ?? {};
  assert.equal(map.magnitude?.num, 5);
  assert.equal(map.sort?.text, "file");
  assert.ok(typeof map["improve time"]?.text === "string");
});

test("glance write outputs map def text", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "glance-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run(`be glance ob filename "${file}" do`);
    await run("ob name result be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }
  const output = logs.join("\n");
  assert.ok(output.includes("be map def"));
  assert.ok(output.includes("su name magnitude"));
});
