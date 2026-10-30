import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findMissingImports, trackedModules } from "../command/check_imports.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

function scratchFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-import-guard-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

test("every relative import specifier in the tree resolves to a real file", () => {
  const { missing } = findMissingImports(trackedModules(), { root: repoRoot });
  assert.deepEqual(missing, []);
});

test("the guard counts the relative specifiers it checks", () => {
  const { checked } = findMissingImports(trackedModules(), { root: repoRoot });
  assert.ok(checked > 1000, `expected a repo-wide sweep, checked ${checked}`);
});

test("the guard reports a specifier that points at nothing", () => {
  const file = scratchFile("broken.mjs", 'import { x } from "./not-here.mjs";\n');
  const { missing } = findMissingImports([file], { root: repoRoot });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /broken\.mjs: \.\/not-here\.mjs/u);
});

test("the guard accepts a specifier that resolves", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-import-guard-"));
  const target = path.join(dir, "there.mjs");
  fs.writeFileSync(target, "export const x = 1;\n", "utf8");
  const importer = path.join(dir, "importer.mjs");
  fs.writeFileSync(importer, 'import { x } from "./there.mjs";\n', "utf8");
  const { checked, missing } = findMissingImports([importer], { root: repoRoot });
  assert.equal(checked, 1);
  assert.deepEqual(missing, []);
});

test("the guard ignores bare package specifiers and runtime placeholders", () => {
  const file = scratchFile("mixed.mjs", [
    'import fs from "node:fs";',
    'import { x } from "some-package";',
    'const p = await import(`../world/house/${name}/program/run.mjs`);',
    ""
  ].join("\n"));
  const { checked, missing } = findMissingImports([file], { root: repoRoot });
  assert.equal(checked, 0);
  assert.deepEqual(missing, []);
});
