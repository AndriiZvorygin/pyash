import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function parseYaml(text) {
  return YAML.parse(String(text ?? ""));
}

test("lobster yaml->pyash->yaml roundtrip (interpret)", async () => {
  forget();
  const fixturePath = path.resolve("quiz/fixtures/inbox-triage.lobster");
  const fixtureText = await fs.readFile(fixturePath, "utf8");
  const expected = parseYaml(fixtureText);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse(`from filename \"${fixturePath}\" fromstate name yaml to name workflow be read do`));
    await interpret(parse("ob name workflow become name yaml be write do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.deepEqual(parseYaml(logs[0]), expected);
});
