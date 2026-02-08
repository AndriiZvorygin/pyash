import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("be text casts filename and name values into text", async () => {
  forget();
  await interpret(parse("ob filename \"/tmp/cast.wav\" to name text output be text do"));
  assert.equal(remember("output")?.be, "text");
  assert.equal(remember("output")?.ob?.text, "/tmp/cast.wav");

  await interpret(parse("exists su name source ob filename \"/tmp/source.wav\" be filename ya"));
  await interpret(parse("ob name source to name text output be text do"));
  assert.equal(remember("output")?.ob?.text, "/tmp/source.wav");
});

test("be filename casts text and name values into filename", async () => {
  forget();
  await interpret(parse("ob text \"/tmp/out.wav\" to name filename output be filename do"));
  assert.equal(remember("output")?.be, "filename");
  assert.equal(remember("output")?.ob?.filename, "/tmp/out.wav");

  await interpret(parse("exists su name source ob text \"/tmp/source.txt\" be text ya"));
  await interpret(parse("ob name source to name filename output be filename do"));
  assert.equal(remember("output")?.ob?.filename, "/tmp/source.txt");
});

test("be text accepts genitive name values resolved from this cases", async () => {
  forget();
  await interpret(parse("su name probe for name text author ob name text task to name text output atleast num 0 atmost num 0 be ceremony def"));
  await interpret(parse("ob name of for of this to name text output be text do"));
  await interpret(parse("su name output ret"));
  await interpret(parse("prah"));
  await interpret(parse("exists su name task item ob text \"task\" be text ya"));
  await interpret(parse("ob name text task item for name text gen loop atleast num 0.8 atmost num 1 to name text out be probe do"));
  assert.equal(remember("out")?.ob?.text, "gen loop");
});

test("be text can write into map slots via to genitive", async () => {
  forget();
  await interpret(parse("su name produce be map def"));
  await interpret(parse("su name result ob text \"\" ya"));
  await interpret(parse("prah"));
  await interpret(parse("ob text \"hello\" to result of produce be text do"));
  assert.equal(remember("produce")?.ob?.map?.result?.ob?.text, "hello");
});
