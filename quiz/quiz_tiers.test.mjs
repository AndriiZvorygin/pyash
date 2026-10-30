import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyQuizFile, detectHouseDependencies, detectRequirements } from "../command/quiz_tiers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The house name is interpolated so this file does not itself look like a
// house dependency to the classifier it pins. The resource paths are
// assembled for the same reason: this file should not register as needing the
// resources it describes, or it would only be gated where they are installed.
const houseProgramSource = (house) =>
  `new URL("../world/house/${house}/program/run-full-transcript-pipeline.mjs", import.meta.url)`;

const whisperSamplePath = ["caterer", "whisper.cpp", "samples", ["jfk", "wav"].join(".")].join("/");
const overlayModulePath = ["..", "program", "library", "reporter_shared", ["cover-overlay", "stage.mjs"].join("-")].join("/");
const wordnetDirectory = ["know", "wordnet", "open-english-wordnet-2025-json"].join("/");

test("a quiz with no external reference is tier t1", () => {
  const outcome = classifyQuizFile('import { parse } from "../program/understand/index.mjs";');
  assert.equal(outcome.tier, "t1");
  assert.deepEqual(outcome.requirements, []);
});

test("a quiz that reads the wordnet dataset is tier t2", () => {
  const outcome = classifyQuizFile(`const dir = "${wordnetDirectory}/";`);
  assert.equal(outcome.tier, "t2");
  assert.ok(outcome.requirements.some((requirement) => requirement.id === "wordnet"));
});

test("a quiz that plays the whisper sample audio is tier t2", () => {
  const outcome = classifyQuizFile(`path.join(cwd, ${JSON.stringify(whisperSamplePath)})`);
  assert.equal(outcome.tier, "t2");
  assert.ok(outcome.requirements.some((requirement) => requirement.id === "whisper"));
});

test("a quiz that renders an overlay is tier t2 and needs ffmpeg drawtext", () => {
  const outcome = classifyQuizFile(
    `import { renderDeterministicOverlay } from "${overlayModulePath}";`
  );
  assert.equal(outcome.tier, "t2");
  assert.ok(outcome.requirements.some((requirement) => requirement.id === "ffmpeg-drawtext"));
});

test("a quiz that points at an untracked house program is tier t3", () => {
  const outcome = classifyQuizFile(houseProgramSource("owen-sound-reporter"), {
    isTrackedHouse: () => false
  });
  assert.equal(outcome.tier, "t3");
  assert.ok(outcome.requirements.some((requirement) => requirement.id === "house"));
});

test("a tracked house program keeps the quiz out of the advisory tier", () => {
  const source = 'import x from "../world/house/refinery-watchdog/program/watchdog-lib.mjs";';
  const outcome = classifyQuizFile(source, { isTrackedHouse: () => true });
  assert.equal(outcome.tier, "t1");
  assert.deepEqual(outcome.requirements, []);
});

test("house paths are only recognised as relative module paths into a program folder", () => {
  const relative = `../world/house/${"beta"}/program/run.mjs`;
  assert.deepEqual(detectHouseDependencies('"world/house/beta"'), []);
  assert.deepEqual(detectHouseDependencies('"world/house/beta/program/run.mjs"'), []);
  assert.deepEqual(detectHouseDependencies(`"${relative}"`), ["beta"]);
});

test("a template placeholder is not a house name", () => {
  assert.deepEqual(
    detectHouseDependencies('import thing from "../world/house/${name}/program/run.mjs";'),
    []
  );
});

test("a fixture string mentioning a house is not a house dependency", () => {
  const source = 'const label = "world/house/alpha";';
  assert.deepEqual(detectRequirements(source, { isTrackedHouse: () => false }), []);
});

test("the gating policy file names the tiers that gate ci", () => {
  const policy = fs.readFileSync(path.join(repoRoot, "configure", "test_tiers.pya"), "utf8");
  assert.match(policy, /su name ci_gating_tiers ob text "[^"]+" ya/u);
  assert.match(policy, /su name ci_advisory_tiers ob text "[^"]+" ya/u);
});

test("the repository has a root quiz set to classify", () => {
  const files = fs
    .readdirSync(path.join(repoRoot, "quiz"))
    .filter((name) => name.endsWith(".test.mjs"));
  assert.ok(files.length > 100, "the root quiz set should not be empty");
});
