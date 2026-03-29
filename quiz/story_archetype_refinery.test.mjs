import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const filename = path.join(repoRoot, "examples", "pyash", "refinery-album-archetype-hook-run.pya");

test("story archetype refinery includes one verifier call in reusable stage ceremony", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /su name stage hook run from text stage name with text stage role to name text stage hooks out be ceremony def/u);
  assert.match(text, /for name archetype hook verifier mind/u);
});

test("story archetype refinery runs all seven archetype stages", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /from text "seed"/u);
  assert.match(text, /from text "awake"/u);
  assert.match(text, /from text "challenge"/u);
  assert.match(text, /from text "experience"/u);
  assert.match(text, /from text "integrated self"/u);
  assert.match(text, /from text "transformation"/u);
  assert.match(text, /from text "highway"/u);
});

test("story archetype refinery keeps power workflow style profile wiring", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /su name music workflow default ob text "ace-step-1\.5-power_comfyui" be default ya/u);
  assert.match(text, /su name album style profile be map def/u);
});

test("story archetype refinery renders hymn and song per selected hook", () => {
  const text = fs.readFileSync(filename, "utf8");
  assert.match(text, /su name album hook song render be ceremony def/u);
  assert.match(text, /su name hook line stage ob text of ob of this to name text hook line be text do/u);
  assert.match(text, /with text of hook line to name text hymn lyrics be hymn manuscript do/u);
  assert.match(text, /su name hymn row stage be map def/u);
  assert.match(text, /ob name seedhooksvec at name all be album hook song render do/u);
  assert.match(text, /from name seedhooksvec to name series seedhymns be series do/u);
  assert.match(text, /to name vec seedhooksvec be distribute do/u);
  assert.match(text, /su name album hymn series stage be series def/u);
  assert.match(text, /ob name series album hymn series stage be write do/u);
});
