import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("learn module exports text and filename learning ceremonies", async () => {
  const text = await fs.readFile(new URL("../module/learn.pya", import.meta.url), "utf8");

  assert.match(text, /exists su name learning source support verify mind be mind fromtext name learning source support verify prompt ya/u);
  assert.match(text, /Prefer communal declarative phrasing that states what is true, practiced, or learned\./u);
  assert.match(text, /Avoid direct second-person instruction and bare imperative phrasing when a declarative teaching line will do\./u);
  assert.match(text, /Each section should default to declarative teaching statements, not advice commands\./u);
  assert.match(text, /BRIEF MEMORY PHRASES: 4-10 short lines, each 2-8 words, preferably short declarative refrain-like phrases rather than commands\./u);
  assert.match(text, /su name learn from text source with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /su name learn from filename source with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /learning source support defective/u);
  assert.match(text, /exists su name learn be export ya/u);
});

test("learn example imports module and forwards source plus focus", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/refinery-learn-from-filename.pya", import.meta.url), "utf8");

  assert.match(text, /from filename "\.\.\/\.\.\/module\/learn\.pya" to name learn be import do/u);
  assert.match(text, /ob ve filename text source text text learning_focus be input ya/u);
  assert.match(text, /from filename of ob of source with text of ob of learning_focus to name text teaching final be learn do/u);
});
