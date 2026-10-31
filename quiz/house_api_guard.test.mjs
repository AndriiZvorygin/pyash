import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkHouseApi,
  declaredHouseModules,
  findHouseImports,
} from "../command/check_house_api.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A small repository with one house checkout, so the rules can be pinned
// without touching the working tree.
function makeFixture({ declared = [], files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "house-api-"));
  fs.mkdirSync(path.join(root, "configure"), { recursive: true });
  const values = declared.map((name) => `"${name}"`).join(" ");
  fs.writeFileSync(
    path.join(root, "configure", "house_api.pya"),
    `su name house_api_modules ob ve text ${values} ya\n`
  );
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return root;
}

const SHARED = "program/library/reporter_shared/shared-piece.mjs";
const HOUSE_FILE = "world/house/test-house/program/main.mjs";

test("the declared surface is read from the pyash sentence file", () => {
  const root = makeFixture({ declared: [SHARED, "program/publisher-interface.mjs"] });
  assert.deepEqual(declaredHouseModules(root), [SHARED, "program/publisher-interface.mjs"]);
});

test("a house import that climbs into this repository is part of the surface", () => {
  const root = makeFixture({
    declared: [SHARED],
    files: {
      [SHARED]: "export const value = 1;\n",
      [HOUSE_FILE]: `import { value } from "../../../../${SHARED}";\nexport default value;\n`
    }
  });
  const found = findHouseImports([path.join(root, HOUSE_FILE)], { root });
  assert.equal(found.length, 1);
  assert.equal(found[0].target, SHARED);
  assert.equal(found[0].exists, true);
});

test("an import that stays inside the house is not part of the surface", () => {
  const root = makeFixture({
    declared: [SHARED],
    files: {
      [SHARED]: "export const value = 1;\n",
      [HOUSE_FILE]: "import { value } from \"./local-helper.mjs\";\nexport default value;\n"
    }
  });
  const found = findHouseImports([path.join(root, HOUSE_FILE)], { root });
  assert.equal(found.length, 0);
});

test("a module the house reaches through the repository root is part of the surface", () => {
  const root = makeFixture({
    declared: [SHARED],
    files: {
      [SHARED]: "export const value = 1;\n",
      [HOUSE_FILE]: `const mod = path.join(PYASH_ROOT, "${SHARED}");\nexport default mod;\n`
    }
  });
  const found = findHouseImports([path.join(root, HOUSE_FILE)], { root });
  assert.equal(found.length, 1);
  assert.equal(found[0].target, SHARED);
  assert.equal(found[0].exists, true);
});

test("a house import that does not resolve is reported as broken", () => {
  const root = makeFixture({
    declared: [SHARED],
    files: {
      [HOUSE_FILE]: `import { value } from "../../../../${SHARED}";\nexport default value;\n`
    }
  });
  const report = checkHouseApi({ root });
  assert.equal(report.broken.length, 1);
  assert.equal(report.broken[0].target, SHARED);
});

test("a house import that is not declared is reported as undeclared", () => {
  const root = makeFixture({
    declared: [],
    files: {
      [SHARED]: "export const value = 1;\n",
      [HOUSE_FILE]: `import { value } from "../../../../${SHARED}";\nexport default value;\n`
    }
  });
  const report = checkHouseApi({ root });
  assert.equal(report.undeclared.length, 1);
  assert.equal(report.undeclared[0].target, SHARED);
});

test("a declared module that does not exist is reported as missing", () => {
  const root = makeFixture({ declared: [SHARED] });
  const report = checkHouseApi({ root });
  assert.deepEqual(report.missingDeclared, [SHARED]);
});

test("a house that stays inside the declared surface passes", () => {
  const root = makeFixture({
    declared: [SHARED],
    files: {
      [SHARED]: "export const value = 1;\n",
      [HOUSE_FILE]: `import { value } from "../../../../${SHARED}";\nexport default value;\n`
    }
  });
  const report = checkHouseApi({ root });
  assert.equal(report.missingDeclared.length, 0);
  assert.equal(report.broken.length, 0);
  assert.equal(report.undeclared.length, 0);
});

test("every declared module of this repository exists", () => {
  const declared = declaredHouseModules(REPO);
  assert.ok(declared.length > 0, "the house surface must be declared");
  const missing = declared.filter((name) => !fs.existsSync(path.join(REPO, name)));
  assert.deepEqual(missing, []);
});
