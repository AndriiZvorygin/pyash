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

test("resolve genitive for typed ob filename", async () => {
  forget();
  await fs.mkdir("quiz/sandpit", { recursive: true });
  await run("ob text \"source\" to filename \"quiz/sandpit/genitive-src.txt\" be write do");
  await run("exists su name src path ob filename \"quiz/sandpit/genitive-src.txt\" be filename ya");
  await run("exists su name dest path ob filename \"quiz/sandpit/genitive-dest.txt\" be filename ya");
  await run("ob filename of ob of src path to filename of ob of dest path be copy do");
  const written = await fs.readFile("quiz/sandpit/genitive-dest.txt", "utf8");
  assert.equal(written, "source");
});

test("typed genitive filename fails fast on object marker", async () => {
  forget();
  await run("exists su name src path ob name bogus ya");
  await run("exists su name dest path ob filename \"quiz/sandpit/genitive-dest.txt\" be filename ya");
  await assert.rejects(
    async () => run("ob filename of ob of src path to filename of ob of dest path be copy do"),
    /typed genitive defective: resolved filename to \[object Object\]/u
  );
});
