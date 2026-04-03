import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("teaching video module supports beard-guide toggle and example disables it", async () => {
  const moduleSource = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    moduleSource,
    /exists su name draw prompt beard guide enabled ob bool truth be default ya/u
  );
  assert.match(
    moduleSource,
    /draw prompt style assembled[\s\S]*ob text of ob of draw prompt style beard default to name draw prompt style assembled be plus do/u
  );
  assert.match(
    moduleSource,
    /draw prompt style beard default/u
  );

  const exampleSource = await fs.readFile("examples/pyash/teaching-video-from-filename.pya", "utf8");
  assert.match(
    exampleSource,
    /exists su name draw prompt style beard default ob text "" be default ya/u
  );
});
