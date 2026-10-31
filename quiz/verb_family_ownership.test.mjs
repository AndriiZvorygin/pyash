import test from "node:test";
import assert from "node:assert/strict";

import { familyOwners, verbModules } from "./helpers/verb_modules.mjs";

test("a verb module owns one verb family", async () => {
  // A verb family belongs to the module that declares it and no other. A
  // module may add shapes of a family that another module also declares —
  // that is how a general verb reaches a domain, the way "write" reaches
  // mind and vector. What a module must not do is be the only home for more
  // than one family: then the file grows with no domain to bound it.
  const modules = await verbModules();
  const owners = familyOwners(modules);

  const offenders = [];
  for (const module of modules) {
    const owned = module.families.filter((family) => owners.get(family).length === 1);
    if (owned.length > 1) {
      offenders.push(`${module.file} owns ${owned.join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], "verb modules that are the only home for more than one family");
});

test("the guard reads the verb modules it guards", async () => {
  // A guard that finds nothing passes for the wrong reason. The verb layer
  // holds many modules that declare signatures, and each of them has to be
  // readable, or the rule above is not being enforced on it.
  const modules = await verbModules();
  const withFamilies = modules.filter((module) => module.families.length > 0);
  assert.ok(
    withFamilies.length > 50,
    `the guard read ${withFamilies.length} verb modules with signatures, expected many more`
  );
  const families = new Set(withFamilies.flatMap((module) => module.families));
  for (const expected of ["command", "cut", "draw", "plus", "read", "write"]) {
    assert.ok(families.has(expected), `the guard did not read the ${expected} family`);
  }
});
