import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const pandocAvailable = (() => {
  const res = spawnSync("pandoc", ["-v"], { stdio: "ignore" });
  return !res.error;
})();

test("compile markdown to html file", { skip: !pandocAvailable }, async () => {
  forget();
  const inputFile = "quiz/sandpit/compile-markdown.md";
  const outputFile = "quiz/sandpit/compile-markdown.html";
  await fs.writeFile(inputFile, "See [Example](https://example.com).", "utf8");
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" fromstate wo markdown tostate wo html to filename "${outputFile}" be compile do`
  );
  await interpret(sentence);

  const htmlText = await fs.readFile(outputFile, "utf8");
  assert.ok(htmlText.includes("https://example.com"));

  await fs.rm(inputFile, { force: true });
  await fs.rm(outputFile, { force: true });
});
