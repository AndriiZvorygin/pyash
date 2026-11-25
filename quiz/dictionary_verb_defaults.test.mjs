import test from "node:test";
import assert from "node:assert/strict";

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

test("a verb without a defensible sense stays unresolved", () => {
  assert.equal(defaultVerbSpelling("xor"), null);
  assert.equal(defaultVerbSpelling("promptify"), null);
  assert.equal(lookupLegacyWordSequence("xor"), null);
});

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
