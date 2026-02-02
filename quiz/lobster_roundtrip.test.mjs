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

test("lobster yaml->pyash emits refinery series and remains YAML-compatible", async () => {
  forget();
  const fixturePath = path.resolve("quiz/fixtures/inbox-triage.lobster");
  const fixtureText = await fs.readFile(fixturePath, "utf8");
  const expected = parseYaml(fixtureText);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse(`from filename \"${fixturePath}\" fromstate name lobster become wo pyash to name text workflow pyash be read do`));
    await interpret(parse("ob name workflow pyash be write do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  const pyashText = logs[0];
  assert.match(pyashText, /su name inbox-triage be refinery def/);
  assert.match(pyashText, /su name collect ob text "inbox list --unread --json".*be command do/);
  assert.match(pyashText, /su name approve ob text "approval.request --from-json".*be command propose/);
  assert.match(pyashText, /from ve name summarize_proposals/);
  assert.ok(expected?.steps?.length >= 4, "fixture should contain steps");
});
