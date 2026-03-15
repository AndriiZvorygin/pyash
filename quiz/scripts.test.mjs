import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runScript } from "./helpers/run_script.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter((line) => {
    const text = String(line);
    if (text.startsWith("artifacts folder: ")) return false;
    if (text.startsWith("run start: ")) return false;
    if (text.startsWith("run end: ")) return false;
    if (text.startsWith("run duration: ")) return false;
    if (text.startsWith("produce file: ")) return false;
    return true;
  });
  assert.deepEqual(unexpected, []);
}

test("run_pya_program.mjs outputs result in gross mode", async () => {
  const { logs, errors } = await runScript("command/run_pya_program.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assertNoUnexpectedErrors(errors);

  const payload = JSON.parse(logs.join(""));
  assert.ok(Array.isArray(payload.outputs));
  const result = payload.result;
  assert.equal(result.su?.name, "result");
  assert.equal(result.ob?.num, 5);
  assert.equal(result.be, "number");
  assert.equal(result.mood, "ya");
});

test("run_pya_program.mjs prints program with --full", async () => {
  const { logs, errors } = await runScript("command/run_pya_program.mjs", ["--full", "examples/pyash/evoke-registers.pya"]);
  assertNoUnexpectedErrors(errors);
  const output = logs.join("\n");
  assert.match(output, /Program:\n/);
  assert.match(output, /Result:\n/);
  assert.match(output, /su name result ob num 5 be number ya/);
});

test("run_pya_program.mjs prints final text result at end in verbose mode", async () => {
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const out = spawnSync(process.execPath, [runPath, "--verbose", "examples/pyash/say-plain.pya"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(out.status, 0, `expected verbose run to pass\nstderr:\n${out.stderr || ""}`);
  const stdoutLines = out.stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  assert.equal(stdoutLines.at(-1), "hello world");
});

test("read_pya_trace.mjs emits beautiful trace by default and has evoker first", async () => {
  const { logs, errors } = await runScript("command/read_pya_trace.mjs", ["examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Beautiful Trace/);
  assert.match(output, /Sandpit 0:/);
  assert.ok(output.includes("[0] ob num 5 to name target be worker do"), "evoker should be first sandpit sentence");
});

test("read_pya_trace.mjs gross mode returns sandpit JSON", async () => {
  const { logs, errors } = await runScript("command/read_pya_trace.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");

  const parsed = JSON.parse(logs.join(""));
  const sandpit = parsed.sandpits?.[0];
  const evoker = sandpit?.[0];

  assert.ok(evoker, "sandpit should have an evoker at index 0");
  assert.equal(evoker.be, "worker");
  assert.equal(evoker.ob?.num, 5);
});

test("run_pya_program.mjs uses default say mapping", async () => {
  const output = "fixture-audio";
  process.env.PYA_PIPER_FIXTURE = output;
  try {
    const { errors } = await runScript("command/run_pya_program.mjs", ["examples/pyash/say-piper.pya"]);
    assertNoUnexpectedErrors(errors);
    const data = await fs.readFile("artifacts/say/piper-demo.wav", "utf8");
    assert.equal(data, output);
  } finally {
    delete process.env.PYA_PIPER_FIXTURE;
    await fs.rm("artifacts/say/piper-demo.wav", { force: true });
  }
});

test("run_pya_program.mjs writes produce.txt for text results", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-produce-"));
  const programPath = path.join(tmpDir, "produce-test.pya");
  const runId = "produce-artifact-test";
  const outDir = path.join(repoRoot, "artifacts", runId);
  try {
    await fs.writeFile(programPath, 'ob text "hello produce artifact" to name text result be text do ya\n', "utf8");
    const { errors } = await runScript("command/run_pya_program.mjs", ["--run-id", runId, programPath]);
    assertNoUnexpectedErrors(errors);
    const content = await fs.readFile(path.join(outDir, "produce.txt"), "utf8");
    assert.equal(content.trim(), "hello produce artifact");
  } finally {
    await fs.rm(programPath, { force: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("run_pya_program.mjs mirrors know input text results into know/produce with matching stem", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-know-produce-"));
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const programPath = path.join(tmpDir, "program.pya");
  const inputDir = path.join(tmpDir, "know", "input", "topic");
  const inputPath = path.join(inputDir, "rome.txt");
  const artifactDir = path.join(tmpDir, "artifacts", "know-produce-test");
  const producePath = path.join(tmpDir, "know", "produce", "topic", "rome.txt");
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.writeFile(inputPath, "rome fixture\n", "utf8");
    await fs.writeFile(programPath, [
      "ob filename text source be input ya",
      "ob text \"mirror me\" to name text result be text do ya"
    ].join("\n"), "utf8");
    const out = spawnSync(process.execPath, [runPath, "--run-id", "know-produce-test", programPath, inputPath], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    assert.equal(out.status, 0, `expected know/produce mirror run to pass\nstderr:\n${out.stderr || ""}`);
    const artifactText = await fs.readFile(path.join(artifactDir, "produce.txt"), "utf8");
    const mirroredText = await fs.readFile(producePath, "utf8");
    assert.equal(artifactText.trim(), "mirror me");
    assert.equal(mirroredText.trim(), "mirror me");
    assert.match(out.stderr, /produce file: .*know\/produce\/topic\/rome\.txt/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("run_pya_program.mjs adds numeric suffix when know/produce target already exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-know-produce-dup-"));
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const programPath = path.join(tmpDir, "program.pya");
  const inputDir = path.join(tmpDir, "know", "input");
  const inputPath = path.join(inputDir, "solon.txt");
  const produceDir = path.join(tmpDir, "know", "produce");
  const firstProduce = path.join(produceDir, "solon.txt");
  const secondProduce = path.join(produceDir, "solon-02.txt");
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(produceDir, { recursive: true });
    await fs.writeFile(inputPath, "solon fixture\n", "utf8");
    await fs.writeFile(firstProduce, "older output\n", "utf8");
    await fs.writeFile(programPath, [
      "ob filename text source be input ya",
      "ob text \"fresh output\" to name text result be text do ya"
    ].join("\n"), "utf8");
    const out = spawnSync(process.execPath, [runPath, "--run-id", "know-produce-dup-test", programPath, inputPath], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    assert.equal(out.status, 0, `expected know/produce duplicate mirror run to pass\nstderr:\n${out.stderr || ""}`);
    assert.equal((await fs.readFile(firstProduce, "utf8")).trim(), "older output");
    assert.equal((await fs.readFile(secondProduce, "utf8")).trim(), "fresh output");
    assert.match(out.stderr, /produce file: .*know\/produce\/solon-02\.txt/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("run_pya_program.mjs mirrors filename results and companion metadata into know/produce", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-know-produce-file-"));
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const programPath = path.join(tmpDir, "program.pya");
  const inputDir = path.join(tmpDir, "know", "input", "video");
  const inputPath = path.join(inputDir, "rome.txt");
  const buildDir = path.join(tmpDir, "build");
  const outputPath = path.join(buildDir, "final.mp4");
  const metadataPath = path.join(buildDir, "final.metadata.txt");
  const mirroredVideo = path.join(tmpDir, "know", "produce", "video", "rome.mp4");
  const mirroredMetadata = path.join(tmpDir, "know", "produce", "video", "rome.metadata.txt");
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(inputPath, "rome fixture\n", "utf8");
    await fs.writeFile(outputPath, "video bytes\n", "utf8");
    await fs.writeFile(metadataPath, "title: Rome\n", "utf8");
    await fs.writeFile(programPath, [
      "ob filename text source be input ya",
      'ob filename "build/final.mp4" to name filename result be filename do ya'
    ].join("\n"), "utf8");
    const out = spawnSync(process.execPath, [runPath, "--run-id", "know-produce-file-test", programPath, inputPath], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    assert.equal(out.status, 0, `expected know/produce filename mirror run to pass\nstderr:\n${out.stderr || ""}`);
    assert.equal((await fs.readFile(mirroredVideo, "utf8")).trim(), "video bytes");
    assert.equal((await fs.readFile(mirroredMetadata, "utf8")).trim(), "title: Rome");
    assert.match(out.stderr, /produce file: .*know\/produce\/video\/rome\.mp4/);
    assert.match(out.stderr, /produce file: .*know\/produce\/video\/rome\.metadata\.txt/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("run_pya_program.mjs keeps one shared suffix across mirrored filename bundles", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-know-produce-file-dup-"));
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const programPath = path.join(tmpDir, "program.pya");
  const inputDir = path.join(tmpDir, "know", "input");
  const inputPath = path.join(inputDir, "solon.txt");
  const buildDir = path.join(tmpDir, "build");
  const outputPath = path.join(buildDir, "final.mp4");
  const metadataPath = path.join(buildDir, "final.metadata.txt");
  const produceDir = path.join(tmpDir, "know", "produce");
  const firstVideo = path.join(produceDir, "solon.mp4");
  const firstMetadata = path.join(produceDir, "solon.metadata.txt");
  const secondVideo = path.join(produceDir, "solon-02.mp4");
  const secondMetadata = path.join(produceDir, "solon-02.metadata.txt");
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(buildDir, { recursive: true });
    await fs.mkdir(produceDir, { recursive: true });
    await fs.writeFile(inputPath, "solon fixture\n", "utf8");
    await fs.writeFile(outputPath, "fresh video\n", "utf8");
    await fs.writeFile(metadataPath, "fresh metadata\n", "utf8");
    await fs.writeFile(firstVideo, "older video\n", "utf8");
    await fs.writeFile(firstMetadata, "older metadata\n", "utf8");
    await fs.writeFile(programPath, [
      "ob filename text source be input ya",
      'ob filename "build/final.mp4" to name filename result be filename do ya'
    ].join("\n"), "utf8");
    const out = spawnSync(process.execPath, [runPath, "--run-id", "know-produce-file-dup-test", programPath, inputPath], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    assert.equal(out.status, 0, `expected know/produce filename duplicate mirror run to pass\nstderr:\n${out.stderr || ""}`);
    assert.equal((await fs.readFile(firstVideo, "utf8")).trim(), "older video");
    assert.equal((await fs.readFile(firstMetadata, "utf8")).trim(), "older metadata");
    assert.equal((await fs.readFile(secondVideo, "utf8")).trim(), "fresh video");
    assert.equal((await fs.readFile(secondMetadata, "utf8")).trim(), "fresh metadata");
    assert.match(out.stderr, /produce file: .*know\/produce\/solon-02\.mp4/);
    assert.match(out.stderr, /produce file: .*know\/produce\/solon-02\.metadata\.txt/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
