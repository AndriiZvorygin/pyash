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
  assert.match(text, /learning source support verify prompt ob text quoted\.text\.Verify whether TEACHING stays faithful to the source material in SOURCE\./u);
  assert.match(text, /learning source support verdict prompt ob text quoted\.text\.Read the verifier analysis and output exactly one word: PASS or FAIL\./u);
  assert.match(text, /exists su name learning source support verify mind be mind fromtext name learning source support verify prompt ya/u);
  assert.match(text, /su name learning source support from text source with text teaching to name text pass be ceremony def/u);
  assert.match(text, /to name text learning source support pass be learning source support do/u);
  assert.match(text, /learning source support pass be equally from text "FAIL" then/u);
  assert.doesNotMatch(text, /learning source support retry stage/u);
  assert.match(text, /from filename of ob of source become wo text to name text source text be read do/u);
  assert.match(text, /to name text teaching out be write do/u);
});
