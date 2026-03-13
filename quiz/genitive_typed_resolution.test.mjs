import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parse } from "../program/understand/parse_tokens.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resolveIoGenitives } from "../program/bridge/imperative.mjs";
import { state } from "../program/bridge/state.mjs";
import { forget } from "../program/remember/index.mjs";
import { remember } from "../program/remember/index.mjs";

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

test("resolveIoGenitives resolves with filename genitive using current evoke", () => {
  forget();
  const prevEvokeRef = state.currentEvokeRef;
  const prevEvoke = state.currentEvoke;
  state.currentEvokeRef = {
    slot: { ob: { filename: "artifacts/run/sections/paragraph-2/section.mp4" } }
  };
  state.currentEvoke = state.currentEvokeRef;
  try {
    const sentence = {
      mood: "do",
      be: "footnote",
      from: { filename: "artifacts/run/sections/paragraph-2/captions.srt" },
      with: { genitive: { chain: ["this", "slot", "ob", "filename"] } },
      to: { filename: "artifacts/run/sections/paragraph-2/section-footnote.mp4" }
    };
    resolveIoGenitives(sentence, { state, memory: { remember } });
    assert.equal(sentence.with?.filename, "artifacts/run/sections/paragraph-2/section.mp4");
    assert.equal(sentence.with?.genitive, undefined);
  } finally {
    state.currentEvokeRef = prevEvokeRef;
    state.currentEvoke = prevEvoke;
  }
});
