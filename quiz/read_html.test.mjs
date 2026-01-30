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

test("read html extracts text", { skip: !pandocAvailable }, async () => {
  forget();
  const filename = "/tmp/pyash-read-html.html";
  await fs.writeFile(filename, "<html><body><h1>Hello</h1><p>World</p></body></html>", "utf8");

  await run("ob name read from filename \"./module/read_html.pya\" to name read be import do");
  await run(`from filename \"${filename}\" fromstate wo html to name text out be read do`);
  const out = remember("out");
  assert.ok(out?.ob?.text?.includes("Hello"));
  assert.ok(out?.ob?.text?.includes("World"));
});
