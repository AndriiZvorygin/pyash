import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("read lobster to pyash emits refinery series", async () => {
  forget();

  const sentence = parse(
    "from filename quiz/fixtures/inbox-triage.lobster fromstate name lobster become wo pyash to name text output be read do"
  );
  await interpret(sentence);

  const output = remember("output");
  assert.ok(output?.ob?.text);
  const text = output.ob.text;
  assert.ok(text.includes("su name inbox-triage be refinery def"));
  assert.ok(text.includes("su name collect ob text \"inbox list --unread --json\""));
  assert.ok(text.includes("su name approve ob text \"approval.request --from-json\""));
  assert.ok(text.includes("be command propose"));
});
