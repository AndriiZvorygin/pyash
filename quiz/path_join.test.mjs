import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("concatenate become wo filename normalizes separators and dot prefixes", async () => {
  forget();

  await run("ob ve text \"artifacts\" \"./run-001\" \"sections\" \"\" \"paragraph-1\" to name text joined be concatenate become wo filename do");
  assert.equal(remember("joined")?.ob?.text, "artifacts/run-001/sections/paragraph-1");
});

test("concatenate become wo filename keeps absolute paths absolute", async () => {
  forget();

  await run("ob ve text \"/workplace/\" \"artifacts//\" \"./run\" \"video.mp4\" to name text joined be concatenate become wo filename do");
  assert.equal(remember("joined")?.ob?.text, "/workplace/artifacts/run/video.mp4");
});

test("concatenate become wo filename can output filename-typed result", async () => {
  forget();

  await run("ob ve text \"artifacts\" \"run-001\" \"video.mp4\" to name filename out file be concatenate become wo filename do");
  const out = remember("out file");
  assert.equal(out?.be, "filename");
  assert.equal(out?.ob?.filename, "artifacts/run-001/video.mp4");
});

test("concatenate become wo filename resolves vector segments from named source", async () => {
  forget();

  await run("exists su name parts ob ve num 2026 3 4 be vector ya");
  await run("ob name parts to name text joined be concatenate become wo filename do");
  assert.equal(remember("joined")?.ob?.text, "2026/3/4");
});

test("concatenate become wo filename rejects invalid named segment values", async () => {
  forget();

  await run("exists su name badseg ob bool truth be bool ya");
  await assert.rejects(
    () => run("ob ve name badseg to name text joined be concatenate become wo filename do"),
    /concatenate filename segment defective/
  );
});
