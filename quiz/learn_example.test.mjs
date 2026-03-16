import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("learn-from-filename example imports learn module and forwards source plus focus", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/learn-from-filename.pya", import.meta.url), "utf8");

  assert.match(text, /from filename "\.\.\/\.\.\/module\/learn\.pya" to name learn be import do/u);
  assert.match(text, /ob ve filename text source text text learning_focus be input ya/u);
  assert.match(text, /from filename of ob of source with text of ob of learning_focus to name text teaching final be learn do/u);
  assert.match(text, /su name result out ob text of ob of teaching final be write do/u);
});
