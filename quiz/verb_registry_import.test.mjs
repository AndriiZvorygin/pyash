import test from "node:test";
import assert from "node:assert/strict";

import { verbModules } from "./helpers/verb_modules.mjs";

test("every verb module can be imported on its own", async () => {
  // The bridge registers the built-in signatures and the verb registry holds
  // them, so a verb module that reaches back into the bridge sits in an
  // import cycle. The cycle does not show up when the bridge is the entry
  // point, and it breaks the moment the registry is imported on its own.
  const failures = [];
  for (const module of await verbModules()) {
    if (module.error) failures.push(`${module.file}: ${module.error}`);
  }
  assert.deepEqual(failures, [], "verb modules that cannot be imported on their own");
});

test("the verb registry can be imported on its own", async () => {
  // The registry is the list of the built-in signatures. A tool that wants
  // to read it — a linter, a report — has to import it directly, and it can
  // only do that when the registry does not depend on the bridge that
  // consumes it.
  const registry = await import("../program/verbs/index.mjs");
  assert.ok(Array.isArray(registry.builtInSignatures), "the registry should export its signatures");
  assert.ok(registry.builtInSignatures.length > 50, "the registry should hold the built-in signatures");
});
