import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";

test("understand verb reads Pyash text and stores JSON", async () => {
  forget();

  const program = [
    "exists su name alpha ob num 1 be number ya",
    "exists su name beta ob num 2 be number ya"
  ].join("\n");

  // store input text and placeholder output
  await interpret(
    parse(`exists su name input ob text "${program}" be text ya`)
  );
  await interpret(parse("exists su name output be text ya"));

  const sentence = parse(
    "ob name input from state pyash to state JSON to name output be understand do"
  );
  const result = await interpret(sentence);

  const mem = allRemember();
  const out = mem.find(s => s.su?.name === "output");

  assert.ok(result, "understand should return result");
  assert.ok(out, "understand should store to output");
  assert.ok(Array.isArray(out.ob?.sentences));
  assert.equal(out.ob.sentences.length, 2);
  assert.match(out.ob.text, /alpha/);

  const parsed = JSON.parse(out.ob.text);
  assert.equal(parsed[0].su.name, "alpha");
});

test("understand can write parsed JSON to filename", async () => {
  forget();

  const program = [
    "exists su name alpha ob num 1 be number ya",
    "exists su name beta ob num 2 be number ya"
  ].join("\n");

  const outputFile = "quiz/sandpit/understand-output.json";
  await fs.rm(outputFile, { force: true });

  await interpret(
    parse(`exists su name input ob text quoted.pyash.${program}.pyash.quoted be text ya`)
  );

  const sentence = parse(
    `ob name input from state pyash to filename "${outputFile}" be understand do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  const parsed = JSON.parse(fileText);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].su.name, "beta");

  await fs.rm(outputFile, { force: true });
});

test("understand can read from filename and write JSON to filename", async () => {
  forget();

  const inputFile = "quiz/sandpit/compile.txt";
  const outputFile = "quiz/sandpit/understand-output.json";
  await fs.rm(outputFile, { force: true });

  const sentence = parse(
    `from filename "${inputFile}" to filename "${outputFile}" be understand do`
  );

  const result = await interpret(sentence);
  assert.ok(result?.value?.text);

  const fileText = await fs.readFile(outputFile, "utf8");
  const parsed = JSON.parse(fileText);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].su.name, "alpha");

  await fs.rm(outputFile, { force: true });
});
