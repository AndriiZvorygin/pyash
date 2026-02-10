import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { updateAgentPresence } from "../program/agent/presence.mjs";

test("updateAgentPresence writes and refreshes .presence.pya deterministically", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-presence-"));
  const worldRoot = path.join(tmpRoot, "world");
  const agent = "parity coder";
  await fs.mkdir(path.join(worldRoot, "house", agent), { recursive: true });

  await updateAgentPresence({
    worldRoot,
    agentName: agent,
    latestIso: "2026-02-10T10:00:00.000Z",
    touchedFiles: ["house/parity coder/session", "house/parity coder/artifacts"]
  });
  await updateAgentPresence({
    worldRoot,
    agentName: agent,
    latestIso: "2026-02-10T10:05:00.000Z",
    touchedFiles: ["house/parity coder/session", "house/parity coder/artifacts"]
  });

  const presencePath = path.join(worldRoot, "house", agent, ".presence.pya");
  const text = await fs.readFile(presencePath, "utf8");
  assert.match(text, /su name parity coder be present/);
  assert.match(text, /since date "2026-02-10T10:00:00.000Z"/);
  assert.match(text, /during date "2026-02-10T10:05:00.000Z"/);
  assert.match(text, /with ve filename "house\/parity coder\/session" "house\/parity coder\/artifacts"/);
});
