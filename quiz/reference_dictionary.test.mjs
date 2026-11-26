import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPyacDictionary } from "../command/pyac_dictionary.mjs";
import { setGloss } from "../command/reference_dictionary.mjs";
import { defaultVerbSpelling } from "../program/library/dictionary/verb_defaults.mjs";
import { lookupLegacyWordSequence } from "../program/library/vliw/quotes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOLUME = path.join(root, "program/library/dictionary/reference.pyac");
const GLOSSES = path.join(root, "program/library/translation/curated_glosses.pya");

const silent = { stdout: { write() {} } };

test("the published volume reads back every canonical key", async () => {
  const result = await runPyacDictionary(["verify", VOLUME], silent);
  assert.equal(result.ok, true, `verify reported: ${result.failures.join("; ")}`);
  assert.equal(result.keys, result.entries, "every entry is reachable from the index");
  assert.ok(result.keys > 60_000, `expected the whole vocabulary, saw ${result.keys}`);
});

test("a key whose word is the nominative marker reads back", async () => {
  // `na` encodes to 0x24DE, the same value the Rust reader once used as the
  // subject delimiter, so its own key word ended the subject and the entry
  // decoded as empty. It must read back now.
  //
  // `wa`, `pa`, and `sa` share the codelet group and are covered by the
  // all-keys `verify` test above, which reads them through the Rust reader.
  // (The JavaScript decoder still cannot spell `and_` because `wordName`
  // rejects every name ending in an underscore; that is a separate cosmetic
  // limit and does not affect the volume.)
  const result = await runPyacDictionary(["read", VOLUME, "key", "na"], silent);
  const forms = result.entry?.lexicalForms ?? [];
  assert.ok(
    forms.some((form) => form.surface === "nominative_case_"),
    `na must read back with its lexical form; saw ${JSON.stringify(forms)}`
  );
});

test("the curated gloss authoring writes and replaces one row", async () => {
  const original = await readFile(GLOSSES, "utf8");
  try {
    const spelling = "hwan";
    const first = await setGloss(spelling, "first authored gloss");
    assert.equal(first.spelling, spelling);
    assert.equal(first.replaced, true, "hwan already has a row, so it is replaced");
    const afterFirst = await readFile(GLOSSES, "utf8");
    assert.match(afterFirst, /first authored gloss/u);

    const second = await setGloss(spelling, "second authored gloss");
    assert.equal(second.replaced, true);
    const afterSecond = await readFile(GLOSSES, "utf8");
    assert.match(afterSecond, /second authored gloss/u);
    assert.doesNotMatch(afterSecond, /first authored gloss/u, "one row per spelling");
    assert.equal(
      afterSecond.split("\n").filter((line) => line.startsWith('su text "hwan" ob text')).length,
      1,
      "authoring must not duplicate the row"
    );
  } finally {
    await writeFile(GLOSSES, original, "utf8");
  }
});

test("a newly authored spelling is appended before the closing prah", async () => {
  const original = await readFile(GLOSSES, "utf8");
  try {
    const result = await setGloss("syip tyuh", "a spelling that had no row");
    assert.equal(result.replaced, false, "a new spelling is appended, not replaced");
    const after = await readFile(GLOSSES, "utf8");
    assert.match(after, /a spelling that had no row/u);
    const lines = after.split("\n");
    const closing = lines.lastIndexOf("prah");
    const added = lines.findIndex((line) => line.startsWith('su text "syip tyuh" ob text'));
    assert.ok(added >= 0 && added < closing, "the row goes inside the map");
  } finally {
    await writeFile(GLOSSES, original, "utf8");
  }
});

test("the primitive table and lowering agree on every mapped verb", () => {
  for (const surface of ["divide", "xor", "not", "or"]) {
    const spelling = defaultVerbSpelling(surface);
    assert.ok(Array.isArray(spelling) && spelling.length === 1, `${surface} is one atom`);
    const sequence = lookupLegacyWordSequence(surface);
    assert.deepEqual(
      sequence.map((entry) => entry.pya),
      spelling,
      `${surface}: lowering and the default table must name the same atom`
    );
  }
});
