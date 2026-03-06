import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("hear from filename to filename writes transcript text file with fixture", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "hear-to-file-"));
  const inputPath = path.join(dir, "input.wav");
  const outputPath = path.join(dir, "output.txt");
  await fs.writeFile(inputPath, "fake-audio", "utf8");
  process.env.PYA_HEAR_FIXTURE = "plain transcript line";
  try {
    await interpret(parse(`from filename "${inputPath}" to filename "${outputPath}" be hear do`));
    const text = await fs.readFile(outputPath, "utf8");
    assert.match(text, /plain transcript line/u);
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
