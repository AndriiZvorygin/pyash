import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildAgentSystemPrompt } from "../program/agent/context.mjs";

test("agent identity bootstrap merges base and agent files", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-context-"));
  try {
    const baseIdentity = path.join(tmp, "world", "house", "base", "identity");
    const helperIdentity = path.join(tmp, "world", "house", "helper", "identity");
    await fs.mkdir(baseIdentity, { recursive: true });
    await fs.mkdir(helperIdentity, { recursive: true });

    await fs.writeFile(path.join(baseIdentity, "TOOLS.md"), "base tools line\n", "utf8");
    await fs.writeFile(path.join(helperIdentity, "TOOLS.md"), "agent tools line\n", "utf8");
    await fs.writeFile(path.join(baseIdentity, "AGENTS.md"), "base agents line\n", "utf8");
    await fs.writeFile(path.join(helperIdentity, "AGENTS.md"), "agent agents line\n", "utf8");

    const prompt = await buildAgentSystemPrompt({
      agentHouse: path.join(tmp, "world", "house", "helper"),
      includeMemory: false,
      includeIdentity: false,
      includeRoles: false,
      includeSummary: false,
      includeToolExplainer: false
    });

    assert.match(prompt, /## TOOLS\.md/);
    assert.match(prompt, /base tools line/);
    assert.match(prompt, /agent tools line/);
    assert.match(prompt, /## AGENTS\.md/);
    assert.match(prompt, /base agents line/);
    assert.match(prompt, /agent agents line/);

    assert.ok(prompt.indexOf("base tools line") < prompt.indexOf("agent tools line"));
    assert.ok(prompt.indexOf("base agents line") < prompt.indexOf("agent agents line"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
