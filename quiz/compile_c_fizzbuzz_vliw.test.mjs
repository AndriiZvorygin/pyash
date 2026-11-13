import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildProgram } from "../program/program.mjs";
import {
  decodePyashProgram,
  encodePyacPack,
  lowerPyashProgram
} from "../program/library/vliw/index.mjs";
import { compilePyacPackToC } from "../program/library/compile/pyac_to_c.mjs";

const execFileAsync = promisify(execFile);

test("compile the existing FizzBuzz Pyash source through VLIW to C and run it", async () => {
  const source = await fs.readFile("examples/pyash/compile-fizzbuzz.txt", "utf8");
  const { sentences } = buildProgram(source);
  const lowered = lowerPyashProgram(sentences);

  assert.ok(lowered.vectors.length > sentences.length, "the nested condition exercises VLIW continuation vectors");
  assert.ok(lowered.vectors.every((vector) => vector.length === 16));

  const decoded = decodePyashProgram(lowered.vectors);
  assert.equal(decoded[5].from.num, 3, "remainder divisor stays in the source/from case");
  assert.deepEqual(decoded[5].ob.genitive.chain, ["this", "fromindex"]);
  assert.deepEqual(decoded[7].consequence, {
    mood: "do",
    ob: { num: 1 },
    to: { name: "count" },
    be: "plus"
  });

  const pack = encodePyacPack(lowered.vectors);
  const c = compilePyacPackToC(pack);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-vliw-fizzbuzz-"));
  const cPath = path.join(tmpDir, "fizzbuzz.c");
  const exePath = path.join(tmpDir, "fizzbuzz");
  await fs.writeFile(cPath, c, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });

  assert.deepEqual(stdout.trim().split(/\r?\n/u), [
    "1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz",
    "11", "Fizz", "13", "14", "FizzBuzz"
  ]);
});
