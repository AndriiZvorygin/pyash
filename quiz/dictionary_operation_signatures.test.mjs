import test from "node:test";
import assert from "node:assert/strict";

import { builtInSignatures } from "../program/verbs/index.mjs";
import {
  collectOperationSignatures,
  renderSignatureRecords,
  DEFAULT_MOOD
} from "../program/library/dictionary/operation_signatures.mjs";
import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };

const ATOMS = new Set(pyashWords.map((row) => String(row.pya).toLowerCase()));

test("collects signatures from the declared verb tables without dropping encodable rows", () => {
  const { byVerb, skipped } = collectOperationSignatures();
  assert.ok(byVerb.size > 0, "expected at least one verb with signatures");
  let collected = 0;
  for (const signatures of byVerb.values()) collected += signatures.length;
  assert.equal(
    collected + skipped.length,
    builtInSignatures.length,
    "every declared signature is either collected or skipped with a reason"
  );
  for (const entry of skipped) {
    assert.ok(entry.reason, "a skipped signature carries a reason");
    assert.ok(Array.isArray(entry.signatureWords));
  }
});

test("every collected signature has a verb, a mood, and encodable arguments", () => {
  const { byVerb } = collectOperationSignatures();
  for (const [verbKey, signatures] of byVerb) {
    for (const signature of signatures) {
      assert.ok(signature.verb.length > 0, verbKey);
      assert.deepEqual(signature.mood, signature.mood);
      assert.ok(signature.mood.length > 0, `${verbKey}: mood`);
      for (const argument of signature.arguments) {
        assert.ok(argument.grammatical_case.length > 0, verbKey);
        assert.ok(argument.value_type.length > 0, verbKey);
        assert.ok(argument.name.length > 0, verbKey);
        assert.ok(argument.description.length > 0, verbKey);
      }
    }
  }
});

test("signature records round-trip through the dictionary importer", () => {
  const { byVerb } = collectOperationSignatures();
  const verbKey = [...byVerb.keys()].find((key) =>
    key.split(" ").every((word) => ATOMS.has(word))
  );
  assert.ok(verbKey, "expected a verb whose words are all vocabulary atoms");
  const records = renderSignatureRecords(verbKey, byVerb.get(verbKey));
  const source = [
    'su name lyin kwon ob text "test" be text ya',
    'su name lyin kwon ob text "test" as num 1 from text "en" to text "NFC" with text "pyac-vliw-dictionary/3" be text ya',
    `su name tlat kwon ob text ${JSON.stringify(verbKey)} at text "entry" be text ya`,
    ...records
  ].join("\n");
  const parsed = buildDictionarySource(source);
  const signatures = parsed.entries[0].operation_signatures;
  assert.equal(signatures.length, byVerb.get(verbKey).length);
  for (const signature of signatures) {
    assert.deepEqual(signature.mood, byVerb.get(verbKey)[0].mood);
    assert.ok(signature.arguments.length > 0);
  }
});

test("the default mood is a vocabulary word, not an invented label", () => {
  const entries = new Set(pyashWords.map((row) => String(row.en).toLowerCase()));
  assert.ok(entries.has(DEFAULT_MOOD), `${DEFAULT_MOOD} must be a vocabulary entry`);
});
