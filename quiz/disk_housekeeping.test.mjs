import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupStaleTemporaryDirectories } from "../command/disk_housekeeping.mjs";

test("disk housekeeping removes stale reporter temporary directories only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-temporary-"));
  const stale = path.join(root, "grey-qwen-predecode-stale");
  const durable = path.join(root, "speaker");
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(durable, { recursive: true });
  fs.writeFileSync(path.join(stale, "audio.bin"), "stale", "utf8");
  fs.writeFileSync(path.join(durable, "audio.bin"), "keep", "utf8");
  const old = new Date("2026-09-01T00:00:00Z");
  fs.utimesSync(stale, old, old);
  fs.utimesSync(path.join(stale, "audio.bin"), old, old);

  const result = cleanupStaleTemporaryDirectories({
    roots: [root],
    maxAgeDays: 1,
    nowMs: Date.parse("2026-10-04T00:00:00Z"),
  });

  assert.equal(result.count, 1);
  assert.equal(result.bytes, 5);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(path.join(durable, "audio.bin")), true);
  fs.rmSync(root, { recursive: true, force: true });
});
