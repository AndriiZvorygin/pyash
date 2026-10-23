import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

test("vocab_suggest recognizes accepted compound targets from a supplied Pyash catalog", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vocab-compounds-"));
  const sourcePath = path.join(directory, "source.pya");
  const catalogPath = path.join(directory, "accepted.pya");
  try {
    await fs.writeFile(sourcePath, "su name blueprint be text ya\n", "utf8");
    await fs.writeFile(catalogPath, [
      "su name translation_compounds_verified be map def",
      "su text \"blueprint\" ob text \"{\\\"surface\\\":\\\"blueprint\\\",\\\"morphemes\\\":[\\\"blue\\\",\\\"print\\\"],\\\"target\\\":\\\"blueprint\\\",\\\"componentGlosses\\\":[\\\"blue\\\",\\\"print\\\"],\\\"pyashSequence\\\":[\\\"plun\\\",\\\"trat\\\"],\\\"verificationStatus\\\":\\\"accepted-llm\\\",\\\"status\\\":\\\"accepted-llm\\\",\\\"provenance\\\":\\\"fixture\\\",\\\"confidence\\\":\\\"fixture\\\"}\" ya",
      "su text \"unverifiedword\" ob text \"{\\\"surface\\\":\\\"unverifiedword\\\",\\\"morphemes\\\":[\\\"unverified\\\",\\\"word\\\"],\\\"target\\\":\\\"unverifiedword\\\",\\\"componentGlosses\\\":[\\\"unverified\\\",\\\"word\\\"],\\\"pyashSequence\\\":[\\\"unverified\\\",\\\"word\\\"],\\\"verificationStatus\\\":\\\"uncertain-llm\\\",\\\"status\\\":\\\"uncertain-llm\\\",\\\"provenance\\\":\\\"fixture\\\",\\\"confidence\\\":\\\"fixture\\\"}\" ya",
      "prah",
      ""
    ].join("\n"), "utf8");
    const lines = [];
    const result = await runVocabSuggest([sourcePath, catalogPath], {
      report: (line) => lines.push(String(line))
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.missing, 0);
    assert.deepEqual(result.foundCompounds, [{
      target: "blueprint",
      components: ["blue", "print"],
      pyash: ["plun", "trat"],
      status: "accepted-llm",
      locations: [sourcePath]
    }]);
    assert.match(lines.join("\n"), /blueprint: found compound blue \+ print -> plun trat \(accepted-llm\)/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("vocab_suggest recognizes repository accepted compounds for direct token checks", async () => {
  const lines = [];
  const result = await runVocabSuggest(["blueprint"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.foundCompounds, [{
    target: "blueprint",
    components: ["blue", "print"],
    pyash: ["plun", "trat"],
    status: "accepted-curated",
    locations: ["input"]
  }]);
  assert.match(lines.join("\n"), /blueprint: found compound blue \+ print -> plun trat \(accepted-curated\)/u);
});
