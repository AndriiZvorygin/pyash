import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const pandocAvailable = (() => {
  const res = spawnSync("pandoc", ["-v"], { stdio: "ignore" });
  return !res.error;
})();

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("compile markdown to html then read markdown roundtrip", { skip: !pandocAvailable }, async () => {
  forget();
  const inputFile = "quiz/sandpit/roundtrip.md";
  const htmlFile = "quiz/sandpit/roundtrip.html";
  await fs.writeFile(inputFile, "Hello world.", "utf8");
  await fs.rm(htmlFile, { force: true });

  await run(`from filename "${inputFile}" from state markdown to state html to filename "${htmlFile}" be compile do`);
  const modulePath = path.resolve("module/read_html_markdown.pya");
  await run(`ob name read from filename "${modulePath}" to name read be import do`);
  await run(`from filename "${htmlFile}" fromstate wo html become wo markdown to name text out be read do`);
  const out = remember("out");
  assert.ok(out?.ob?.text?.toLowerCase().includes("hello world"));

  await fs.rm(inputFile, { force: true });
  await fs.rm(htmlFile, { force: true });
});
