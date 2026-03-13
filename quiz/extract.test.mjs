import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("extract returns source tail starting at since marker", async () => {
  forget();
  await run(`from text ${JSON.stringify("alpha # Session\nbeta\ngamma")} since text "# Session" to name text output be extract do`);
  assert.equal(remember("output")?.ob?.text, "# Session\\nbeta\\ngamma");
});

test("extract resolves named source and named markers", async () => {
  forget();
  await run(`ob text ${JSON.stringify("hello\nSTART\nbody\nEND\nfooter")} to name text source be text do`);
  await run('ob text "START" to name text begin marker be text do');
  await run('ob text "END" to name text stop marker be text do');
  await run('from name text source since name text begin marker until name text stop marker to name text output be extract do');
  assert.equal(remember("output")?.ob?.text, "START\\nbody\\n");
});

test("extract returns source head until marker", async () => {
  forget();
  await run(`from text ${JSON.stringify("preface\n# Session\nbody")} until text "# Session" to name text output be extract do`);
  assert.equal(remember("output")?.ob?.text, "preface\\n");
});

test("extract errors when since marker is missing", async () => {
  forget();
  await assert.rejects(
    run('from text "alpha beta" since text "gamma" to name text output be extract do'),
    /since marker not found/
  );
});
