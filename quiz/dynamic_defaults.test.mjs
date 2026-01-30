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

test("dynamic default rule fills missing cases", async () => {
  forget();

  const fixturePath = path.join(repoRoot, "quiz", "fixtures", "web_search_fixture.json");
  await run(`exists su name web search fixture ob filename "${fixturePath}" be text ya`);

  await run("exists su name search web default ob la be search fromstate wo web ko from filename \"http://example.local\" be default ya");

  await run("su name found ob text \"example\" fromstate wo web by num 1 be search do");

  const found = remember("found");
  assert.equal(found?.be, "map");
  assert.equal(found?.from?.filename, "http://example.local");
});
