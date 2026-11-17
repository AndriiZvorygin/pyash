import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  endRefinery,
  recordPlatform,
  removeRefinery,
  runRefinery,
  startRefinery
} from "../program/bridge/refinery.mjs";

test("surfaces parse source and refinery stage when a platform fails to parse generated Pyash", async () => {
  const refineryName = "parse error diagnostic quiz";
  const stageName = "compose candidates";
  const malformedSource = 'la su name generated clause be text ya';
  const results = [];

  startRefinery(refineryName);
  recordPlatform({ mood: "do", su: { name: stageName }, be: "test" });
  endRefinery(refineryName);

  try {
    const result = await runRefinery({
      name: refineryName,
      interpret: async () => parse(malformedSource),
      retryConfig: { maxAttempts: 1 },
      onResult: (sentence) => results.push(sentence)
    });

    assert.equal(result?.be, "error");
    assert.match(result?.ob?.text ?? "", /compose candidates/u);
    assert.ok(result.ob.text.includes(malformedSource));
    assert.ok(sentenceToPyash(result).includes(malformedSource));
    assert.equal(results.at(-1), result);
  } finally {
    removeRefinery(refineryName);
  }
});
