import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseChannelCalendarPolicyText,
  loadChannelCalendarPolicyWithGlobal,
  resolveChannelCalendarSetting
} from "../program/agent/channels/calendar_policy.mjs";

test("calendar policy parser reads matrix long poll timing", () => {
  const text = [
    'su name matrix long poll ms ob text "45000" be calendar ya',
    'su name matrix long poll ms for name helper ob text "12000" be calendar ya'
  ].join("\n");
  const policy = parseChannelCalendarPolicyText(text);
  const globalSetting = resolveChannelCalendarSetting(policy, { channelType: "matrix" });
  const helperSetting = resolveChannelCalendarSetting(policy, {
    channelType: "matrix",
    agentName: "helper"
  });
  assert.equal(globalSetting.longPollMs, 45000);
  assert.equal(globalSetting.hasLongPollMs, true);
  assert.equal(helperSetting.longPollMs, 12000);
  assert.equal(helperSetting.hasLongPollMs, true);
});

test("calendar policy loader merges world and agent timing with agent override", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-calendar-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "helper");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  await fs.writeFile(
    path.join(worldRoot, "conduct", "calendar.pya"),
    'su name matrix long poll ms ob text "45000" be calendar ya\n',
    "utf8"
  );
  await fs.writeFile(
    path.join(agentHouse, "conduct", "calendar.pya"),
    'su name matrix long poll ms for name helper ob text "9000" be calendar ya\n',
    "utf8"
  );

  const merged = await loadChannelCalendarPolicyWithGlobal({
    worldRoot,
    agentHouse,
    agentName: "helper"
  });
  const helperSetting = resolveChannelCalendarSetting(merged, {
    channelType: "matrix",
    agentName: "helper"
  });
  const otherSetting = resolveChannelCalendarSetting(merged, {
    channelType: "matrix",
    agentName: "other"
  });

  assert.equal(helperSetting.longPollMs, 9000);
  assert.equal(otherSetting.longPollMs, 45000);
});
