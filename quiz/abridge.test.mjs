import test from "node:test";
import assert from "node:assert/strict";

import abridge from "../program/verbs/abridge.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

function readTextOutput(result) {
  return String(
    result?.ob?.text
    ?? result?.value?.text
    ?? result?.text
    ?? ""
  );
}

test("abridge stores deterministic text output within byte budget", async () => {
  forget();

  const source = [
    "## Overview",
    "The system should reduce repetitive statements.",
    "Action required: keep dates like 2026-02-08.",
    "In summary, preserve key decisions and numbers."
  ].join("\n");
  await run(`from text ${JSON.stringify(source)} atmost byte 110 to name text abridged be abridge do`);

  const fact = remember("abridged");
  assert.ok(fact);
  assert.equal(fact.be, "text");
  assert.ok(typeof fact.ob?.text === "string");
  assert.ok(Buffer.byteLength(fact.ob.text, "utf8") <= 110);
});

test("abridge is deterministic for same input and budget", async () => {
  forget();

  const source = "Decision: ship now. Action required today. Action required today. Notes remain.";
  const one = await run(`from text ${JSON.stringify(source)} atmost byte 80 be abridge do`);
  const two = await run(`from text ${JSON.stringify(source)} atmost byte 80 be abridge do`);
  assert.equal(one?.ob?.text, two?.ob?.text);
});

test("abridge keeps selected sentences in source order", async () => {
  forget();

  const source = [
    "Middle details are verbose.",
    "Decision approved by board.",
    "Background context that is less critical.",
    "Action required by Friday."
  ].join(" ");
  const result = await run(`from text ${JSON.stringify(source)} atmost byte 200 be abridge do`);
  const lines = readTextOutput(result).split("\n").filter(Boolean);
  let cursor = 0;
  for (const line of lines) {
    const idx = source.indexOf(line, cursor);
    assert.ok(idx >= 0, "selected sentence must appear after prior selection");
    cursor = idx + line.length;
  }
});

test("abridge reduces duplicate n-gram sentences", async () => {
  forget();

  const source = [
    "Action required now.",
    "Action required now.",
    "Action required now.",
    "Decision final."
  ].join(" ");
  const result = await run(`from text ${JSON.stringify(source)} atmost byte 200 be abridge do`);
  const output = readTextOutput(result);
  const repeats = output.match(/Action required now\./g) ?? [];
  assert.ok(repeats.length <= 1);
});

test("abridge throws when source text is missing", async () => {
  forget();

  await assert.rejects(
    run("from name text missing source be abridge do"),
    (err) => err?.sentence?.su?.name === "abridge defective"
  );
});

test("abridge maps across a series via ob text payload", async () => {
  forget();

  await run("su name wise chips be series def");
  await run('su name chip 1 ob text "Decision approved. Extra notes." be text ya');
  await run('su name chip 2 ob text "Action required now. Action required now." be text ya');
  await run("prah");

  await run("from name wise chips by name abridge to name text abridged chips be series map do");
  const series = remember("abridged chips");
  assert.ok(series);
  assert.equal(series.be, "series");
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.equal(texts.length, 2);
  assert.ok(texts[0].includes("Decision"));
  const repeats = texts[1].match(/Action required now\./g) ?? [];
  assert.ok(repeats.length <= 1);
});

test("abridge keeps first sentence of each heading section as coverage", async () => {
  forget();

  await run(`exists su name source chip ob text quoted.text.## Alpha
First alpha sentence.
Less important alpha details.
## Beta
First beta sentence.
Less important beta details.
.text.quoted be text ya`);
  const result = await run("from name text source chip atmost byte 200 be abridge do");
  const out = readTextOutput(result);
  assert.ok(out.includes("## Alpha"));
  assert.ok(out.includes("## Beta"));
});

test("abridge does not dedupe similar lines when numeric claims differ", async () => {
  forget();

  const source = [
    "Decision: latency target is 120 ms.",
    "Decision: latency target is 180 ms.",
    "Other context."
  ].join(" ");
  const result = await run(`from text ${JSON.stringify(source)} atmost byte 200 be abridge do`);
  const out = readTextOutput(result);
  assert.ok(out.includes("120 ms."));
  assert.ok(out.includes("180 ms."));
});

test("abridge prefers descriptive agenda lines over bare agenda codes", async () => {
  forget();

  const source = [
    "5:30 P.m.",
    "City Hall - 808 2nd Avenue East - Council Chambers.",
    "Deputation from CJ Palumbi, Operations Manager, Van Dolder Developments Re: Zoning By-law Update - Modern Residential Height Permissions - City Wide 42 Metre Standard.",
    "Motion for Which Notice was Previously Given by Mayor Boddy at the February 23, 2026 Regular Council Meeting Re: Code of Conduct for Members of Council, Local Boards and Committees Policy No. CrS-C42.",
    "THAT City Council directs staff to bring forward a by-law to amend the Code of Conduct for Members of Council, Local Boards and Committees Policy No. CrS-C42 as follows.",
    "By-law No. 2026-021.",
    "A By-law to authorize the Mayor and Clerk to execute a Funding Agreement with The Corporation of the County of Grey and The Corporation of the County of Wellington respecting the Guelph Owen Sound Transit (GOST).",
    "By-law No. 2026-023.",
    "A By-law to authorize the Mayor and Clerk to execute a Second Amending Agreement with the Township of Centre Wellington and a Third Amending Agreement with the Township of Chatsworth, Township of Wellington North, Northern Credit Union, and 6 & 10 Mini Mart, respecting bus stops for the Guelph Owen Sound Transportation (GOST) bus service."
  ].join("\n");

  const result = await abridge({ from: { text: source }, atmost: { byte: 1000 } });
  const out = String(result?.ob?.text ?? "");

  assert.ok(out.includes("Zoning By-law Update"), "should keep the deputation topic");
  assert.ok(out.includes("Funding Agreement"), "should keep the descriptive by-law text");
});
