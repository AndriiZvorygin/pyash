import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

const runLive = process.env.PYA_LIVE_SADDLE_TEST === "1";

test("live gpt-oss saddle can write and verify a basic program", { skip: !runLive, timeout: 180000 }, async () => {
  const outDir = path.join(process.cwd(), "artifacts", "saddle-live");
  await fs.mkdir(outDir, { recursive: true });
  const targetPath = path.join(outDir, "live-hello.js");
  const normalizedTarget = targetPath.replace(/\\/g, "/");

  let lastOutput = "";
  let success = false;
  for (let attempt = 1; attempt <= 2 && !success; attempt += 1) {
    forget();
    resetMindLogs();
    await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));
    await interpret(parse('exists su name coding saddle system ob text "You are a coding saddle. Use command and repair tools. Create a JavaScript file that prints 42, run node on it, and reply with only the absolute file path." ya'));
    await interpret(parse('exists su name coding saddle be mind as name "gpt-oss:latest" fromtext name coding saddle system ya'));
    await interpret(parse(`ob text "Create ${normalizedTarget}. Start by writing file content with command. If needed, fix with repair. Run node to verify output 42. Reply only with the final absolute file path." for name coding saddle to name text coding output with name saddle tools be write do`));

    const output = remember("coding output")?.ob?.text ?? "";
    lastOutput = String(output);
    try {
      const fileText = await fs.readFile(targetPath, "utf8");
      if (fileText.includes("42")) success = true;
    } catch {
      // Retry once for live-model nondeterminism.
    }
  }

  assert.equal(success, true, `live saddle did not create valid file; last output: ${lastOutput}`);
});
