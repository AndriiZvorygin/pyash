import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { runVocabSuggest } from "../command/vocab_suggest.mjs";

// Requires know/wordnet/open-english-wordnet-2025-json for raw synsets without curated bridges.
test("vocab_suggest looks up a WordNet synset by its stable POS-qualified identity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vocab-synset-"));
  const mapPath = path.join(directory, "lookup.json");
  const lines = [];
  try {
    const result = await runVocabSuggest(["n:07558676-n", "--map", mapPath], {
      report: (line) => lines.push(String(line))
    });
    const [lookup] = result.wordNetSenseLookups;

    assert.equal(result.exitCode, 0);
    assert.equal(result.missing, 0);
    assert.equal(lookup.senseId, "n:07558676-n");
    assert.equal(lookup.partOfSpeech, "n");
    assert.deepEqual(lookup.lemmas, ["love"]);
    assert.match(lookup.definition, /^a strong positive emotion of regard and affection/u);
    assert.equal(lookup.status, "linked");
    assert.equal(lookup.links.some((link) => (
      link.kind === "atom"
      && link.target === "love"
      && link.pyashSequence.join(" ") === "pyan"
      && link.status === "active"
    )), true);
    assert.match(lines.join("\n"), /n:07558676-n \[n; love\]: a strong positive emotion/u);
    assert.match(lines.join("\n"), /linked atom love -> pyan \(active/u);

    const machineResult = JSON.parse(await fs.readFile(mapPath, "utf8"));
    assert.equal(machineResult.format, "vocab-suggest-v3");
    assert.deepEqual(machineResult.wordNetSenseLookups, result.wordNetSenseLookups);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("vocab_suggest joins an exact compound synset to its gloss and Pyac components", async () => {
  const lines = [];
  const result = await runVocabSuggest(["a:00006050-a"], {
    report: (line) => lines.push(String(line))
  });
  const [lookup] = result.wordNetSenseLookups;

  assert.equal(lookup.senseId, "a:00006050-a");
  assert.deepEqual(lookup.lemmas, ["comparative", "relative"]);
  assert.equal(lookup.definition, "estimated by comparison");
  assert.equal(lookup.links.some((link) => (
    link.kind === "compound"
    && link.target === "comparative"
    && link.components.join(" + ") === "degree + comparison"
    && link.pyashSequence.join(" ") === "tlut tras"
    && link.status === "accepted-llm"
  )), true);
  assert.match(lines.join("\n"), /a:00006050-a: linked compound comparative \[degree \+ comparison\] -> tlut tras/u);
});

test("vocab_suggest reads an unlinked raw WordNet synset by indexed identity", async () => {
  const lines = [];
  const result = await runVocabSuggest(["a:00001740-a"], {
    report: (line) => lines.push(String(line))
  });
  const [lookup] = result.wordNetSenseLookups;

  assert.equal(lookup.senseId, "a:00001740-a");
  assert.equal(lookup.partOfSpeech, "a");
  assert.deepEqual(lookup.lemmas, ["able"]);
  assert.match(lookup.definition, /having the necessary means or skill/u);
  assert.equal(lookup.status, "unlinked");
  assert.deepEqual(lookup.links, []);
  assert.match(lines.join("\n"), /a:00001740-a \[a; able\]: .*necessary means or skill/u);
});

test("vocab_suggest distinguishes an unknown synset id from an unresolved vocabulary word", async () => {
  const lines = [];
  const result = await runVocabSuggest(["n:99999999-n"], {
    report: (line) => lines.push(String(line))
  });

  assert.equal(result.wordNetSenseLookups.length, 1);
  assert.equal(result.wordNetSenseLookups[0].senseId, "n:99999999-n");
  assert.equal(result.wordNetSenseLookups[0].status, "not-found");
  assert.deepEqual(result.wordNetSenseLookups[0].links, []);
  assert.match(lines.join("\n"), /n:99999999-n: WordNet synset not found/u);
});
