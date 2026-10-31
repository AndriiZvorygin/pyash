import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

async function withProgram(source, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vocab-names-"));
  const file = path.join(directory, "program.pya");
  try {
    await fs.writeFile(file, source, "utf8");
    const lines = [];
    const result = await runVocabSuggest([file], {
      report: (line) => lines.push(String(line))
    });
    return { result, lines };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("a name without vocabulary coverage is reported as a name, not as a missing word", async () => {
  const { result, lines } = await withProgram(
    "su name zzzuncoveredname be text ya\n",
    async () => {}
  );
  assert.equal(result.missing, 0);
  assert.equal(result.exitCode, 0);
  assert.ok(result.uncoveredNames.includes("zzzuncoveredname"));
  assert.match(lines.join("\n"), /zzzuncoveredname: name without vocabulary coverage/u);
});

test("a word without vocabulary coverage is still missing", async () => {
  const { result, lines } = await withProgram(
    "su name counter be zzzuncoveredword ya\n",
    async () => {}
  );
  assert.equal(result.missing, 1);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.uncoveredNames, []);
  assert.match(lines.join("\n"), /zzzuncoveredword/u);
  assert.doesNotMatch(lines.join("\n"), /zzzuncoveredword: name without vocabulary coverage/u);
});

test("a token that names something anywhere is a name, even in the predicate slot", async () => {
  const { result, lines } = await withProgram(
    [
      "su name zzzsharedtoken be text ya",
      "su name counter be zzzsharedtoken ya",
      ""
    ].join("\n"),
    async () => {}
  );
  assert.equal(result.missing, 0);
  assert.equal(result.exitCode, 0);
  assert.ok(result.uncoveredNames.includes("zzzsharedtoken"));
  assert.match(lines.join("\n"), /zzzsharedtoken: name without vocabulary coverage/u);
});
