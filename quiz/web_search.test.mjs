import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("web search returns map of found entries", async () => {
  forget();

  const fixturePath = path.join(repoRoot, "quiz", "fixtures", "web_search_fixture.json");
  await run(`exists su name web search fixture ob filename \"${fixturePath}\" be text ya`);
  await run("exists su name web search motor ob filename \"https://tsoc.liberit.ca/\" be default ya");

  await run("su name found ob text \"example\" fromstate wo web by num 2 be search do");

  const found = remember("found");
  assert.equal(found?.be, "map");
  const map = found?.ob?.map ?? {};
  assert.equal(found?.ob?.text, "example");
  assert.equal(found?.from?.filename, "https://tsoc.liberit.ca/");
  const meta = map.metadata;
  assert.equal(meta?.ob?.text, "example");
  assert.equal(meta?.from?.filename, "https://tsoc.liberit.ca/");

  const first = map["1"];
  assert.equal(first?.atindex?.num, 1);
  assert.equal(first?.from?.filename, "https://example.com/a");
  assert.equal(first?.ob?.text, "Example A");
  assert.equal(first?.as?.text, "Alpha summary");
  assert.equal(first?.fromstate?.text, "web");
  assert.equal(first?.via?.name, "searxng");
});
