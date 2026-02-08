import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureAgentDirs } from "../program/agent/session.mjs";

test("ensureAgentDirs creates conduct directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-dirs-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const dirs = await ensureAgentDirs(agentHouse);
  assert.ok(dirs.conductDir);
  const stat = await fs.stat(dirs.conductDir);
  assert.equal(stat.isDirectory(), true);
  const calendarPath = path.join(dirs.conductDir, "calendar.pya");
  const calendarText = await fs.readFile(calendarPath, "utf8");
  assert.match(calendarText, /heartbeat .*vyah habit during minute 24.*be calendar/);
  const channelsPath = path.join(dirs.conductDir, "channels.pya");
  const channelsStat = await fs.stat(channelsPath);
  assert.equal(channelsStat.isFile(), true);
});
