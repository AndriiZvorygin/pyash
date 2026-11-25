import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_VERB_SPELLING,
  defaultVerbSpelling
} from "../program/library/dictionary/verb_defaults.mjs";
import { collectOperationSignatures } from "../program/library/dictionary/operation_signatures.mjs";
import { lookupLegacyWordSequence } from "../program/library/vliw/quotes.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };

const ATOMS = new Map(
  pyashWords.map((row) => [String(row.pya).toLowerCase(), row])
);

test("a default verb spelling resolves to existing atoms", () => {
  for (const [surface, spelling] of DEFAULT_VERB_SPELLING) {
    for (const part of spelling) {
      assert.ok(
        ATOMS.has(part),
        `${surface}: default part ${part} must be a vocabulary atom`
      );
    }
  }
});

test("a default verb spelling is not redundant with the encoding table", () => {
  const legacyEnglish = new Set(
    pyashWords.map((row) => String(row.en).toLowerCase())
  );
  for (const surface of DEFAULT_VERB_SPELLING.keys()) {
    assert.ok(
      !legacyEnglish.has(surface),
      `${surface} already resolves from pyashWords.json; drop the override`
    );
  }
});

test("a mapped verb encodes through lowering as its chosen spelling", () => {
  const sequence = lookupLegacyWordSequence("verify");
  assert.ok(sequence, "verify must lower");
  assert.deepEqual(
    sequence.map((entry) => entry.pya),
    ["tras", "drot"],
    "verify resolves to its default compound"
  );
});

test("a primitive operator resolves to a single atom", () => {
  // A primitive must be one atom: the compiled runtime dispatches on the atom's
  // identity, so a compound would not reach the arithmetic handler.
  const primitives = {
    divide: ["dvis", "0x8893"],
    xor: ["hkit", "0xA810"],
    not: ["no", "0x30DE"],
    or: ["ba", "0x263E"]
  };
  for (const [surface, [atom, hnuc]] of Object.entries(primitives)) {
    const spelling = defaultVerbSpelling(surface);
    assert.deepEqual(spelling, [atom], `${surface} must resolve to the single atom ${atom}`);
    const sequence = lookupLegacyWordSequence(surface);
    assert.ok(sequence, `${surface} must lower`);
    assert.equal(sequence.length, 1, `${surface} must not be a compound`);
    assert.equal(sequence[0].pya, atom);
    assert.equal(
      Number.parseInt(sequence[0].hnuc, 16),
      Number.parseInt(hnuc, 16),
      `${surface} must lower to the runtime's dispatch word`
    );
  }
});

test("a verb with no existing sense stays unresolved rather than guessed", () => {
  assert.equal(defaultVerbSpelling("promptify"), null);
  assert.equal(defaultVerbSpelling("espeak"), null);
  assert.equal(lookupLegacyWordSequence("promptify"), null);
});

test("a verb surface resolves the way lowering resolves it", () => {
  // The signature collector and lowering must agree on the word for a verb, or
  // the published volume describes a handler the encoder never emits. `go` is
  // the case that proved it: the English surface `go` is `hkin` (0x6810), while
  // the spelling `go` belongs to gnomic_aspect_ (0x325E).
  const { byVerb } = collectOperationSignatures();
  const checked = [];
  for (const [verbKey, signatures] of byVerb) {
    if (verbKey.includes(" ")) continue;
    const sequence = lookupLegacyWordSequence(verbKey);
    assert.ok(sequence, `${verbKey} must lower`);
    assert.deepEqual(
      signatures[0].verb,
      sequence.map((entry) => Number.parseInt(entry.hnuc, 16)),
      `${verbKey}: published verb words must match what lowering emits`
    );
    checked.push(verbKey);
  }
  assert.ok(checked.includes("go"), "the check covers go");
  assert.ok(checked.length > 50, "the check covers the collected verb set");
});

test("a primitive keeps one atom and the sense that atom performs", () => {
  // `dvis` is the DIVIDE word, so its WordNet sense must be arithmetic division
  // rather than the highest-frequency lemma sense (an army unit).
  const source = readFileSync(
    new URL("../program/library/dictionary/reference.pya", import.meta.url),
    "utf8"
  );
  const block = entryBlock(source, "dvis");
  assert.match(block, /to text "n:00872590-n"/u, "dvis carries the arithmetic division sense");
  assert.match(block, /an arithmetic operation that is the inverse of multiplication/u);
  assert.doesNotMatch(block, /n:08230126-n/u, "dvis does not carry the army-unit sense");

  const army = entryBlock(source, "hyim dvis");
  assert.match(army, /n:08230126-n/u, "the army-unit sense stays addressable as a compound");
});

function entryBlock(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(`ob text ${JSON.stringify(key)} at text "entry"`));
  assert.ok(start >= 0, `missing entry for ${key}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.includes('at text "entry"'));
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join("\n");
}

test("mapping verbs collects their declared signatures", () => {
  const { byVerb, skipped } = collectOperationSignatures();
  assert.ok(byVerb.has("verify"), "verify signatures are collected");
  assert.ok(byVerb.has("divide"), "divide signatures are collected");
  const unmapped = skipped.filter((entry) => entry.reason === "unmapped-verb");
  const verify = unmapped.filter((entry) => entry.signatureWords.includes("verify"));
  assert.equal(verify.length, 0, "no verify signature is skipped as an unmapped verb");
});

test("a multi-word verb contributes every token", () => {
  const { byVerb } = collectOperationSignatures();
  const signature = byVerb.get("verify platform")?.at(0);
  assert.ok(signature, "verify platform signatures are collected");
  assert.ok(
    signature.verb.length > 2,
    "the verb key carries the tokens of both words"
  );
});
