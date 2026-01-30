import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

const pandocAvailable = (() => {
  const res = spawnSync("pandoc", ["-v"], { stdio: "ignore" });
  return !res.error;
})();

const pdftotextAvailable = (() => {
  const res = spawnSync("pdftotext", ["-v"], { stdio: "ignore" });
  return !res.error;
})();

test("read pdf extracts text", { skip: !(pandocAvailable && pdftotextAvailable) }, async () => {
  forget();
  const filename = "/tmp/pyash-read-pdf.pdf";
  const source = "Hello PDF";
  const proc = spawnSync("pandoc", ["-o", filename, "-"], { input: source, encoding: "utf8" });
  assert.equal(proc.status, 0);
  await fs.access(filename);

  await run(`from filename \"${filename}\" fromstate name pdf to name text out be read do`);
  const out = remember("out");
  assert.ok(out?.ob?.text?.includes("Hello"));
});
