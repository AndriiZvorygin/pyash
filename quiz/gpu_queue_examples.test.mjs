import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";

const examples = [
  "examples/pyash/teaching-video-gpu-queue-mind-duty.pya",
  "examples/pyash/wide-teaching-video-gpu-queue-mind-duty.pya"
];

test("queued teaching-video examples use GPU future duties", async () => {
  for (const file of examples) {
    const source = await fs.readFile(file, "utf8");
    assert.match(source, /vyah start future be gpu mind do/u, file);
    assert.match(source, /vyah await be gpu do/u, file);
    assert.doesNotMatch(source, /be teaching video (wide )?do/u, file);
  }
});

test("queued teaching-video examples parse sentence by sentence", async () => {
  for (const file of examples) {
    const source = await fs.readFile(file, "utf8");
    const lines = source.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parsed = parse(line);
      assert.equal(parsed?.mood, line.endsWith(" do") ? "do" : "ya", `${file}: ${line}`);
    }
  }
});
