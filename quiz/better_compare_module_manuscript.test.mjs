import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("better compare module manuscript example keeps compare artifacts and module draft wiring", async () => {
  const text = await fs.readFile("examples/pyash/better-compare-module-manuscript-from-filename.pya", "utf8");

  assert.match(text, /ob ve filename text source text text hook_hint be input ya/);
  assert.match(text, /from filename "\.\.\/\.\.\/module\/module_manuscript\.pya" ob name manuscript as wo module to name manuscript as wo module be import do/);
  assert.match(text, /from filename "\.\.\/\.\.\/module\/better_compare\.pya" ob name better compare to name better compare be import do/);
  assert.match(text, /exists su name text better compare module manuscript judge prompter ob text quoted\.text\.Choose the better manuscript for retention, clarity, and modular reuse\./);
  assert.match(text, /exists su name module manuscript draft count ob num 0 be number ya/);
  assert.match(text, /ob text "artifacts\/" to name text module manuscript artifacts dir be text do/);
  assert.match(text, /ob text "\/candidates" to name module manuscript candidates dir be plus do/);
  assert.match(text, /ob text "know\/produce" to name text module manuscript produce dir be text do/);
  assert.match(text, /su name module manuscript source draft ob text source to name text manuscript out be ceremony def/);
  assert.match(text, /ob num 1 to name module manuscript draft count be plus do/);
  assert.match(text, /su name module manuscript draft run stage from text of ob of this with text of ob of hook_hint to name text manuscript out be manuscript as wo module do/);
  assert.match(text, /ob text "\/module-manuscript-draft-" to name module manuscript draft path be plus do/);
  assert.match(text, /su name module manuscript draft artifact stage ob name text manuscript out to filename of ob of module manuscript draft filename stage be write do/);
  assert.match(text, /to name text module manuscript final atmost num 3 be better compare do/);
  assert.match(text, /ob text "\/produce\.txt" to name produce path be plus do/);
  assert.match(text, /ob text "-compare\.txt" to name module manuscript produce copy path be plus do/);
  assert.match(text, /su name module manuscript produce copy stage ob name text module manuscript final to filename of ob of module manuscript produce copy filename stage be write do/);
});
