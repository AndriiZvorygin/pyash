import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("instead replaces placeholders from map with literal source", async () => {
  forget();
  await run("su name map replacements be map def");
  await run('su text "[[hook]]" ob text "Debt was cancelled." ya');
  await run('su text "[[cta]]" ob text "Subscribe for more." ya');
  await run("su name map replacements be map prah");
  await run('be instead ob name map replacements in text "Hook: [[hook]] CTA: [[cta]]" to name text out do');
  assert.equal(remember("out")?.ob?.text, "Hook: Debt was cancelled. CTA: Subscribe for more.");
});

test("instead resolves source and replacement values from remembered text facts", async () => {
  forget();
  await run('exists su name packet template ob text "TITLE: [[title]]" be text ya');
  await run('exists su name title value ob text "Solon Rewrites Power" be text ya');
  await run("su name map replacements be map def");
  await run('su text "[[title]]" ob name text title value ya');
  await run("su name map replacements be map prah");
  await run("be instead ob name map replacements in name text packet template to name text packet do");
  assert.equal(remember("packet")?.ob?.text, "TITLE: Solon Rewrites Power");
});

test("instead applies keys in declaration order", async () => {
  forget();
  await run("su name map replacements be map def");
  await run('su text "ab" ob text "X" ya');
  await run('su text "a" ob text "Y" ya');
  await run("su name map replacements be map prah");
  await run('be instead ob name map replacements in text "ab a" to name text out do');
  assert.equal(remember("out")?.ob?.text, "X Y");
});

test("instead does one key pass and does not recursively re-run earlier keys", async () => {
  forget();
  await run("su name map replacements be map def");
  await run('su text "A" ob text "AA" ya');
  await run("su name map replacements be map prah");
  await run('be instead ob name map replacements in text "A" to name text out do');
  assert.equal(remember("out")?.ob?.text, "AA");
});

test("instead fails when map binding is missing", async () => {
  forget();
  await assert.rejects(
    async () => run('be instead in text "x" to name text out do'),
    (err) => err?.sentence?.su?.name === "instead defective"
      && String(err?.sentence?.ob?.text ?? "").includes("requires replacement map")
  );
});

test("instead fails when map contains empty replacement key", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "badmap" },
    be: "map",
    ob: { map: { "": { text: "x" } } }
  });
  await assert.rejects(
    async () => run('be instead ob name map badmap in text "x" to name text out do'),
    (err) => err?.sentence?.su?.name === "instead defective"
      && String(err?.sentence?.ob?.text ?? "").includes("empty replacement key")
  );
});
