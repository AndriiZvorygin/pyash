import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";
import { clearModuleCache, loadModule, setEntryModuleDir, setEntryModulePath } from "../program/bridge/modules.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const fixturesDir = path.resolve("quiz/fixtures/modules");
const entryPath = path.join(fixturesDir, "entry.pya");

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("module import binds namespace and ceremonies", async () => {
  forget();
  setEntryModulePath(entryPath);

  await run("from name math tools to name math be import do");

  const math = remember("math");
  assert.equal(math?.be, "map");
  const piName = math?.ob?.map?.pi?.name;
  const pi = piName ? remember(piName) : null;
  assert.equal(pi?.ob?.num, 3.14);

  await run("to name out be math plus two do");
  const out = remember("out");
  assert.equal(out?.ob?.num, 2);
});

test("module import rejects top-level do in imported module", async () => {
  forget();
  setEntryModulePath(entryPath);

  await assert.rejects(
    () => run("from name bad module to name trouble be import do"),
    /top-level do is forbidden/
  );
});

test("entry module allows top-level do", async () => {
  forget();
  setEntryModulePath(entryPath);
  const source = await fs.readFile(entryPath, "utf8");
  const lines = splitSentences(source);
  for (const line of lines) {
    if (!line.trim()) continue;
    const sentence = parse(line);
    await interpret(sentence);
  }
});

test("module qualification rewrites typed name references for internal symbols", async () => {
  forget();
  clearModuleCache();
  setEntryModuleDir(process.cwd());
  const loaded = await loadModule({
    specifier: "./module/brief_video.pya",
    alias: "teaching video",
    source: "module import test"
  });

  const insteadSentence = loaded.sentences.find(
    (s) => s?.be === "instead" && s?.su?.name === "thumbnail context stage"
  );
  assert.ok(insteadSentence, "expected thumbnail context instead sentence");
  assert.equal(
    insteadSentence?.ob?.name,
    "teaching video internal thumbnail context replacements",
    "typed map reference should be module-qualified"
  );
  assert.equal(
    insteadSentence?.in?.name,
    "teaching video internal thumbnail context template",
    "typed text reference should be module-qualified"
  );

  const promptInstruction = loaded.sentences.find(
    (s) => s?.su?.name === "teaching video internal draw promptify instruction" && s?.be === "text"
  );
  assert.ok(promptInstruction, "top-level names after map blocks should be module-qualified");
});
