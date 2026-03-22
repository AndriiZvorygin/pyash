import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("native refinery runs file-backed child program with bound inputs and returns map result", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-native-refinery-"));
  const sourceFilename = path.join(dir, "source.txt");
  const programFilename = path.join(dir, "child.pya");
  await fs.writeFile(sourceFilename, "hello from child\n", "utf8");
  await fs.writeFile(programFilename, [
    "ob filename text source be input ya",
    "su name source text from filename of ob of source become wo text to name text source text be read do",
    "su name result out ob text of ob of source text be write do"
  ].join("\n"), "utf8");

  doRemember({
    mood: "ya",
    su: { name: "bindings" },
    be: "map",
    ob: {
      map: {
        source: { filename: sourceFilename }
      }
    }
  });

  const priorRunId = process.env.PYA_RUN_ID;
  process.env.PYA_RUN_ID = "parent-run";
  try {
    const sentence = `from filename ${JSON.stringify(programFilename)} ob name bindings to name map native result be refinery do`;
    const result = await run(sentence);
    assert.equal(result?.acted, "native result");

    const stored = remember("native result");
    assert.equal(stored?.be, "map");
    assert.equal(stored?.ob?.map?.produce?.text, "hello from child\n");
    assert.equal(stored?.ob?.map?.kind?.text, "write");
    assert.equal(stored?.ob?.map?.passing?.boolean, true);
    assert.match(String(stored?.ob?.map?.["artifacts folder"]?.filename ?? ""), /artifacts\/parent-run\/native-refinery\//u);
    assert.match(String(stored?.ob?.map?.["result file"]?.filename ?? ""), /result\.pya$/u);
    assert.match(String(stored?.ob?.map?.["produce file"]?.filename ?? ""), /produce\.txt$/u);
  } finally {
    if (priorRunId === undefined) delete process.env.PYA_RUN_ID;
    else process.env.PYA_RUN_ID = priorRunId;
  }
});
