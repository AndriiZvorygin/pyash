import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishWordNetIndex,
  loadEnglishWordNet,
  parseEnglishWordNetConfig,
  parseEnglishWordNetText
} from "../program/verbs/exchange/translation/english_wordnet.mjs";

test("WordNet parser preserves part of speech, synset identity, lemma, and gloss", () => {
  const parsed = parseEnglishWordNetText([
    "n [reaction%1:22:00::] [reaction] chemical reaction",
    "n [reaction%1:19:01::] [reaction] response revealing a person's feelings or attitude",
    "# source comment",
    ""
  ].join("\n"));
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    id: `n:reaction%1:22:00:::reaction:${parsed.rows[0].id.split(":").at(-1)}`,
    pos: "n",
    synset: "reaction%1:22:00::",
    senseKey: "reaction%1:22:00::",
    lemma: "reaction",
    gloss: "chemical reaction"
  });
  const index = buildEnglishWordNetIndex(parsed);
  assert.deepEqual(index.senses("reaction").map((sense) => sense.gloss), [
    "chemical reaction",
    "response revealing a person's feelings or attitude"
  ]);
});

test("WordNet parser rejects malformed source and can report noisy lines in bounded mode", () => {
  assert.throws(
    () => parseEnglishWordNetText("n [broken"),
    (error) => error.code === "invalid-english-wordnet"
  );
  const parsed = parseEnglishWordNetText([
    "n [valid%1:00:00::] [valid] a gloss",
    "noise without the WordNet row shape"
  ].join("\n"), { strict: false });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.skippedLines[0].lineNumber, 2);
});

test("WordNet parser and index preserve optional relation edges", () => {
  const parsed = parseEnglishWordNetText([
    "n [river] [bank] edge of terrain",
    "n [river] [riverbank] edge of terrain",
    "n [water] [water] liquid",
    "r [n:river] [n:water] [related] source relation"
  ].join("\n"));
  assert.equal(parsed.relations.length, 1);
  assert.deepEqual(parsed.relations[0], {
    kind: "relation",
    id: parsed.relations[0].id,
    source: "n:river",
    target: "n:water",
    relation: "related",
    evidence: "source relation"
  });
  const index = buildEnglishWordNetIndex(parsed);
  assert.equal(index.relatedness("n:river", "n:water"), 0.5);
  assert.equal(index.relatedness("n:river", "n:unknown"), 0);
});

test("repository WordNet resource is available as read-only semantic evidence", async () => {
  const resource = await loadEnglishWordNet();
  assert.equal(resource.format, "english-wordnet-core-v1");
  assert.ok(resource.rows.length > 4000);
  assert.ok(resource.index.lookup("feel").some((row) => row.pos === "v"));
  assert.ok(resource.index.lookup("reaction").length >= 3);
});

test("WordNet source location and integrity are durable Pyash configuration", () => {
  const configuration = parseEnglishWordNetConfig([
    "su name translation_english_wordnet be map def",
    "su text \"format\" ob text \"english-wordnet-core-v1\" ya",
    "su text \"source\" ob text \"/tmp/wordnet-core.txt\" ya",
    "su text \"source-hash\" ob text \"hash\" ya",
    "su text \"mode\" ob text \"read-only semantic evidence\" ya",
    "prah"
  ].join("\n"));
  assert.deepEqual(configuration, {
    format: "english-wordnet-core-v1",
    source: "/tmp/wordnet-core.txt",
    sourceHash: "hash",
    mode: "read-only semantic evidence"
  });
});

