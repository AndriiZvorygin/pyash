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
