import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("hear become wo srt writes explicit output file with fixture", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-srt-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.srt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");
  process.env.PYA_HEAR_FIXTURE = "first line\nsecond line";
  try {
    const result = await run(`su name srt from filename "${inputPath}" become wo srt to filename "${outputPath}" be hear do`);
    assert.equal(result?.value?.filename, outputPath);
    const srt = await fs.readFile(outputPath, "utf8");
    assert.match(srt, /1\n00:00:00,000 --> 00:00:02,000\nfirst line/u);
    assert.match(srt, /2\n00:00:02,000 --> 00:00:04,000\nsecond line/u);
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});

test("hear become wo srt defaults to artifacts output path", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-srt-"));
  const inputPath = path.join(dir, "input.wav");
  await fs.writeFile(inputPath, "fake-audio", "utf8");
  process.env.PYA_HEAR_FIXTURE = "single line";
  try {
    await run(`su name srt out from filename "${inputPath}" become wo srt be hear do`);
    const fact = remember("srt out");
    assert.equal(fact?.be, "hear");
    assert.ok(fact?.ob?.filename?.endsWith(".srt"));
    const srt = await fs.readFile(fact.ob.filename, "utf8");
    assert.match(srt, /00:00:00,000 --> 00:00:02,000/u);
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});

test("hear stream rejects become wo srt", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "line";
  try {
    const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-srt-"));
    const inputPath = path.join(dir, "stream.wav");
    await fs.writeFile(inputPath, "fake-audio", "utf8");
    await assert.rejects(
      run(`su name live from filename "${inputPath}" become wo srt be hear vyah stream do`),
      /hear defective: stream does not support srt/u
    );
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
