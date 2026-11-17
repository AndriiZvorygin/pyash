import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../program/program.mjs";
import { encodePyacPack, lowerPyashProgram } from "../program/library/vliw/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compilePath = path.join(repoRoot, "compile");
const runPath = path.join(repoRoot, "run");
const pyashPath = path.join(repoRoot, "command/pyash.mjs");
const interpreterPath = path.join(repoRoot, "sysh", "bin", "pyac-run");

function invoke(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120000
  });
}

async function withTempDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-pyac-runtime-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

before(() => {
  const build = invoke("bash", [path.join(repoRoot, "sysh", "build-vliw-interpreter.sh")]);
  assert.equal(build.status, 0, build.stderr);
  assert.match(build.stdout, /built .*sysh\/bin\/pyac-run/);
});

test("run interprets a Pyash-compiled PyAC hello-world pack at runtime", async () => {
  await withTempDirectory(async (directory) => {
    const sourcePath = path.join(repoRoot, "examples/pyash/nasm-hello-world.pya");
    const packPath = path.join(directory, "hello.pyac");
    const compiled = invoke(compilePath, [sourcePath, packPath, "pyac"]);
    assert.equal(compiled.status, 0, compiled.stderr);

    const result = invoke(runPath, [packPath]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Hello, world!\n");

    const pyashRun = invoke(process.execPath, [pyashPath, "run", packPath]);
    assert.equal(pyashRun.status, 0, pyashRun.stderr);
    assert.equal(pyashRun.stdout, "Hello, world!\n");
  });
});

test("PyAC runtime rejects malformed packs and unsupported sentences visibly", async () => {
  await withTempDirectory(async (directory) => {
    const malformedPath = path.join(directory, "malformed.pyac");
    await fs.writeFile(malformedPath, "not a PyAC pack");
    const malformed = invoke(runPath, [malformedPath]);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /invalid or truncated PyAC VLIW pack/);

    const vectors = lowerPyashProgram(buildProgram("ob num 1 be number ya").sentences).vectors;
    const unsupportedPath = path.join(directory, "unsupported.pyac");
    await fs.writeFile(unsupportedPath, encodePyacPack(vectors));
    const unsupported = invoke(runPath, [unsupportedPath]);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /unsupported sentence/);
  });
});

test("PyAC runtime rejects unsupported positional input bindings", async () => {
  await withTempDirectory(async (directory) => {
    const source = buildProgram('ob text "hello" be write do').sentences;
    const packPath = path.join(directory, "program.pyac");
    await fs.writeFile(packPath, encodePyacPack(lowerPyashProgram(source).vectors));
    const result = invoke(runPath, [packPath, "extra-input"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime input bindings are not supported/);
    assert.equal(await fs.stat(interpreterPath).then(() => true, () => false), true);
  });
});
