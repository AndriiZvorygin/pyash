import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("re-entry cycle returns final revision using mind fixture", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "Fixture draft response.";

  try {
    forget();
    const sourcePath = "examples/pyash/re-entry-cycle-fixture.pya";
    setEntryModulePath(sourcePath);
    const source = await fs.readFile(sourcePath, "utf8");
    const lines = splitSentences(source);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      await interpret(parse(trimmed));
    }
    const result = remember("result");
    assert.equal(result?.ob?.text ?? result?.ob?.value ?? result?.ob, "Fixture draft response.");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
