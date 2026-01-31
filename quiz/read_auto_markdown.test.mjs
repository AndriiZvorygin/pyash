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

const fileAvailable = (() => {
  const res = spawnSync("file", ["--version"], { stdio: "ignore" });
  return !res.error;
})();

test("read auto markdown dispatches html", { skip: !(pandocAvailable && fileAvailable) }, async () => {
  forget();
  const filename = "/tmp/pyash-read-auto-md.html";
  await fs.writeFile(filename, "<p>See <a href=\"https://example.com\">Example</a>.</p>", "utf8");

  await run("ob name read from filename \"./module/read_html_markdown.pya\" to name read html markdown be import do");
  await run("ob name read from filename \"./module/read_auto.pya\" to name read be import do");
  await run(`from filename \"${filename}\" become wo markdown to name text out be read do`);
  const out = remember("out");
  assert.ok(out?.ob?.text?.includes("[Example](https://example.com)"));
});
