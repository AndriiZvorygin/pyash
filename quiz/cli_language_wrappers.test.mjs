import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrappers = {
  compile: path.join(repoRoot, "compile"),
  run: path.join(repoRoot, "run"),
  interpret: path.join(repoRoot, "interpret")
};

function cleanEnv() {
  const env = { ...process.env };
  for (const key of [
    "PYA_MIND_RESPONSE",
    "PYA_HEAR_FIXTURE",
    "PYA_PIPER_FIXTURE",
    "PYA_WHISPER_FIXTURE",
    "PYA_RUN_ID",
    "PYA_RUN_TIME"
  ]) delete env[key];
  return env;
}

function invoke(wrapper, args, { cwd, input } = {}) {
  return spawnSync(wrapper, args, {
    cwd,
    input,
    encoding: "utf8",
    env: cleanEnv()
  });
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-cli-language-"));
  const spaced = path.join(root, "caller files");
  await fs.mkdir(spaced);
  const source = path.join(spaced, "source program.pya");
  await fs.writeFile(source, 'ob text "cli smoke" be write do\n', "utf8");
  const input = path.join(spaced, "input value.txt");
  await fs.writeFile(input, "bound input\n", "utf8");
  const bindingProgram = path.join(spaced, "binding program.pya");
  await fs.writeFile(bindingProgram, [
    "ob filename text manuscript be input ya",
    "ob text \"binding accepted\" be write do"
  ].join("\n"), "utf8");
  const cwd = path.join(root, "outside repository");
  await fs.mkdir(cwd);
  return { root, cwd, source, input, bindingProgram, output: path.join(spaced, "compiled output.js") };
}

test("compile accepts case-shaped paths, defaults, become, and spaced paths", async () => {
  const fixture = await makeFixture();
  const result = invoke(wrappers.compile, [
    "from", "filename", fixture.source,
    "to", "filename", fixture.output
  ], { cwd: fixture.cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(fixture.output, "utf8"), /cli smoke/);
});

test("compile accepts explicit tostate and be compile do", async () => {
  const fixture = await makeFixture();
  const output = path.join(fixture.root, "explicit output.js");
  const result = invoke(wrappers.compile, [
    "from", "filename", fixture.source,
    "fromstate", "pyash",
    "to", "filename", output,
    "tostate", "javascript",
    "be", "compile", "do"
  ], { cwd: fixture.cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(output, "utf8"), /cli smoke/);
});

test("compile accepts explicit fromstate and become cases", async () => {
  const fixture = await makeFixture();
  const output = path.join(fixture.root, "become output.js");
  const result = invoke(wrappers.compile, [
    "from", "filename", fixture.source,
    "fromstate", "pyash",
    "to", "filename", output,
    "become", "javascript"
  ], { cwd: fixture.cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(output, "utf8"), /cli smoke/);
});

test("compile rejects missing source, destination, wrong verbs, and unsupported shapes", async () => {
  const fixture = await makeFixture();
  const cases = [
    ["missing source", ["from", "filename", path.join(fixture.root, "missing.pya"), "to", "filename", fixture.output]],
    ["missing destination", ["from", "filename", fixture.source]],
    ["wrong verb", ["from", "filename", fixture.source, "to", "filename", fixture.output, "be", "run", "do"]],
    ["unsupported source case", ["from", "text", "hello", "to", "filename", fixture.output]],
    ["incomplete target case", ["from", "filename", fixture.source, "to", "state", "javascript"]]
  ];

  for (const [label, args] of cases) {
    const result = invoke(wrappers.compile, args, { cwd: fixture.cwd });
    assert.equal(result.status, 1, `${label}: ${result.stdout}\n${result.stderr}`);
    if (label === "missing source") assert.match(result.stderr, /file or directory unavailable/);
    else assert.match(result.stderr, /usage:/);
  }
});

test("run accepts from filename outside the repository", async () => {
  const fixture = await makeFixture();
  const result = invoke(wrappers.run, ["from", "filename", fixture.source], { cwd: fixture.cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cli smoke/);
});

test("run preserves the existing explicit input binding tail", async () => {
  const fixture = await makeFixture();
  const result = invoke(wrappers.run, [
    "from", "filename", fixture.bindingProgram,
    "ob", "filename", fixture.input, "to", "name", "manuscript"
  ], { cwd: fixture.cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /binding accepted/);
});

test("run rejects missing, unavailable, and malformed program input", async () => {
  const fixture = await makeFixture();
  const cases = [
    ["missing filename", []],
    ["unavailable program", ["from", "filename", path.join(fixture.root, "not here.pya")]],
    ["malformed binding", ["from", "filename", fixture.bindingProgram, "ob", "filename", fixture.input]]
  ];

  for (const [label, args] of cases) {
    const result = invoke(wrappers.run, args, { cwd: fixture.cwd });
    assert.equal(result.status, 1, `${label}: ${result.stdout}\n${result.stderr}`);
    if (label === "malformed binding") assert.match(result.stderr, /input binding defective/);
    else assert.match(result.stderr, /usage:/);
  }
});

test("interpret runs one complete sentence and keeps no-argument REPL behavior", async () => {
  const fixture = await makeFixture();
  const oneShot = invoke(wrappers.interpret, ['ob text "one shot" be write do'], { cwd: fixture.cwd });
  assert.equal(oneShot.status, 0, oneShot.stderr);
  assert.match(oneShot.stdout, /one shot/);

  const repl = invoke(wrappers.interpret, [], { cwd: fixture.cwd, input: "quit\n" });
  assert.equal(repl.status, 0, repl.stderr);
  assert.match(repl.stdout, /Pyash REPL/);
});

test("interpret rejects incomplete and malformed sentences", async () => {
  const fixture = await makeFixture();
  for (const sentence of ["ob text incomplete", "be do", "from filename"]) {
    const result = invoke(wrappers.interpret, [sentence], { cwd: fixture.cwd });
    assert.equal(result.status, 1, `${sentence}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /usage|sentence/i);
  }
});
