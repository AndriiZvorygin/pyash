import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("learn internal filename examples call the intended module stages", async () => {
  const direct = await fs.readFile(new URL("../examples/pyash/learn-direct-from-filename.pya", import.meta.url), "utf8");
  const extract = await fs.readFile(new URL("../examples/pyash/learn-extract-card-from-filename.pya", import.meta.url), "utf8");
  const mergeRefine = await fs.readFile(new URL("../examples/pyash/learn-merge-refine-cards-from-filename.pya", import.meta.url), "utf8");

  assert.match(direct, /from text of ob of learn source text with text of ob of learning_focus to name text teaching final be learn do/u);
  assert.match(extract, /from text of ob of learn source text with text of ob of learning_focus to name text teaching final be learn extract card do/u);
  assert.match(mergeRefine, /from text of ob of learn cards text with text of ob of learning_focus to name text merged card be learn merge cards do/u);
  assert.match(mergeRefine, /from text of ob of merged card with text of ob of learning_focus to name text refined card be learn refine card do/u);
  assert.match(mergeRefine, /learning source support defective/u);
});
