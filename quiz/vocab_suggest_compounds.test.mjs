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

test("vocab_suggest reports the accepted include compound", async () => {
  const lines = [];
  const result = await runVocabSuggest(["include"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.foundCompounds, [{
    target: "include",
    components: ["inside", "containing"],
    pyash: ["lwak", "hzan"],
    status: "accepted-curated",
    locations: ["input"]
  }]);
  assert.match(lines.join("\n"), /include: found compound inside \+ containing -> lwak hzan \(accepted-curated\)/u);
});

test("vocab_suggest reuses the accepted include compound for the involve inclusion alias", async () => {
  const lines = [];
  const result = await runVocabSuggest(["involve"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.foundCompounds, [{
    target: "include",
    components: ["inside", "containing"],
    pyash: ["lwak", "hzan"],
    status: "accepted-curated",
    locations: ["input"]
  }]);
  assert.match(lines.join("\n"), /involve: found compound inside \+ containing -> lwak hzan \(accepted-curated\)/u);
});

test("vocab_suggest exposes the accepted brain compound from Chinese evidence", async () => {
  const lines = [];
  const result = await runVocabSuggest(["brainstorm"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.foundCompounds, [{
    target: "brainstorm",
    components: ["brain", "storm"],
    pyash: ["twum", "hfup"],
    status: "accepted-curated",
    specificAtom: "brain_storming",
    specificAtomPyash: "hto7n",
    locations: ["input"]
  }]);
  assert.match(lines.join("\n"), /brainstorm: found compound brain \+ storm -> twum hfup \(accepted-curated\); specific atom brain_storming -> hto7n/u);
});

test("vocab_suggest exposes earlier multilingual compounds from their shared atom", async () => {
  const lines = [];
  const result = await runVocabSuggest(["database"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.compoundAtomLinks[0].token, "database");
  assert.deepEqual(
    result.compoundAtomLinks[0].compounds.map((compound) => compound.surface),
    ["base de datos", "base de données", "база данных", "डेटाबेस", "数据库"]
  );
  assert.match(lines.join("\n"), /database: root -> hdes \(English30k rank 21916\); compounds:/u);
});

test("vocab_suggest resolves the specific brain-storming atom from English", async () => {
  const lines = [];
  const result = await runVocabSuggest(["brain_storming"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.compoundAtomLinks, [{
    token: "brain_storming",
    compounds: [{
      surface: "头脑风暴",
      target: "brain_storming",
      pyashSequence: ["twum", "hfup"],
      atom: "brain_storming",
      atomPyash: "hto7n"
    }]
  }]);
  assert.match(lines.join("\n"), /brain_storming: root -> hto7n \(direct Pyash atom\); compounds: 头脑风暴 -> twum hfup/u);
});

test("vocab_suggest exposes lexical and progressive readings of English brainstorming", async () => {
  const lines = [];
  const result = await runVocabSuggest(["brainstorming"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.compoundMorphologies, [{
    token: "brainstorming",
    lemma: "brainstorm",
    components: ["brain", "storm"],
    pyash: ["twum", "hfup", "pfih"],
    specificAtom: "brain_storming",
    specificAtomPyash: "hto7n",
    certainty: "contextual",
    status: "accepted-curated"
  }]);
  assert.match(lines.join("\n"), /brainstorming: morphology brainstorm \(brain \+ storm\) \+ progressive_aspect_ -> twum hfup pfih \(contextual\); specific atom brain_storming -> hto7n/u);
});

test("vocab_suggest does not label a third-person compound verb as progressive", async () => {
  const lines = [];
  const result = await runVocabSuggest(["involves"], {
    report: (line) => lines.push(String(line))
  });
  assert.deepEqual(result.compoundMorphologies, []);
  assert.equal(lines.some((line) => line.includes("progressive_aspect_")), false);
});

test("vocab_suggest derives the expanded deterministic compound set", async () => {
  const lines = [];
  const result = await runVocabSuggest(["acid-rain"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.foundCompounds, [{
    target: "acid-rain",
    components: ["acid", "rain"],
    pyash: ["flat", "myic"],
    status: "accepted-delimited",
    locations: ["input"]
  }]);
  assert.match(lines.join("\n"), /acid-rain: found compound acid \+ rain -> flat myic \(accepted-delimited\)/u);
});
