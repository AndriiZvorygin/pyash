import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function run(line) {
  return interpret(parse(line));
}

async function runFile(relativePath) {
  const text = await fs.promises.readFile(path.join(repoRoot, relativePath), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    await run(trimmed);
  }
}

// The example used to call `be read become wo text from filename ob text`,
// a signature that was never implemented. The read ceremony detects the file
// kind itself, so the sentence carries no prompt.

test("read-image-auto example describes the image into a named text", async () => {
  forget();
  const previous = process.env.PYA_SEE_VL_FIXTURE;
  process.env.PYA_SEE_VL_FIXTURE = "a raven on a branch";
  try {
    await run('from filename "./module/read_auto.pya" ob name read to name read be import do');
    await run('from filename "./module/see_vl.pya" ob name see to name see be import do');

    await runFile("examples/pyash/read-image-auto.pya");

    assert.equal(remember("description")?.ob?.text, "a raven on a branch");
  } finally {
    if (previous === undefined) delete process.env.PYA_SEE_VL_FIXTURE;
    else process.env.PYA_SEE_VL_FIXTURE = previous;
  }
});
