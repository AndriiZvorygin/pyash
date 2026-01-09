import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("write stream stops at blank audio and preserves spacing", async () => {
  forget();
  const fixturePath = path.join("quiz", "sandpit", "hear-stream-end.txt");
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, "Hello.\nHello. Again.\n[BLANK_AUDIO]\n", "utf8");

  process.env.PYA_KEYBOARD_BIN = "true";
  try {
    await run(`su name live ob filename "${fixturePath}" be stream ya`);
    const result = await run("su name typed from name live to name keyboard be write vyah stream do");
    assert.equal(result?.be, "write");
    assert.equal(result?.ob?.text, "Hello. Again.");
  } finally {
    delete process.env.PYA_KEYBOARD_BIN;
  }
});
