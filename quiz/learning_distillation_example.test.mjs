import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("learning distillation example defines focused source and learning inputs with required headings", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/refinery-learn-from-filename.pya", import.meta.url), "utf8");

  assert.match(text, /ob ve filename text source text text learning_focus be input ya/u);
  assert.match(text, /SEED CONCEPT/u);
  assert.match(text, /CARDINAL TRAINING SENTENCE/u);
  assert.match(text, /ORTHOGONAL FEATURES/u);
  assert.match(text, /AFFAIRS OR ACTIVITIES/u);
  assert.match(text, /CAUSATIVE AND CONSEQUENCE/u);
  assert.match(text, /CARDINAL SCENES AND IDIOMS/u);
  assert.match(text, /BRIEF MEMORY PHRASES/u);
  assert.match(text, /from filename of ob of source become wo text to name text source text be read do/u);
  assert.match(text, /to name text teaching out be write do/u);
});
