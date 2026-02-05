import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(text) {
  const sentence = parse(text);
  return await interpret(sentence);
}

test("resolve genitive for from/to filename in io cases", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  await run("exists su name target path ob filename \"quiz/sandpit/genitive-io.txt\" be filename ya");
  await run("ob text \"hello\" to filename of ob of target path be write do");
  const commandResult = await run("ob text \"cat\" from filename of ob of target path be command do");
  const written = await fs.readFile("quiz/sandpit/genitive-io.txt", "utf8");
  assert.equal(written, "hello");
  assert.equal(commandResult?.value?.text, "hello");
});
