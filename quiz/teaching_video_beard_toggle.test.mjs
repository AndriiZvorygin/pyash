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
    /ob bool of ob of draw prompt beard guide enabled be equally from bool truth then/u
  );
  assert.match(
    moduleSource,
    /draw prompt style beard default/u
  );

  const exampleSource = await fs.readFile("examples/pyash/teaching-video-from-filename.pya", "utf8");
  assert.match(
    exampleSource,
    /exists su name draw prompt beard guide enabled ob bool lie be default ya/u
  );
});

