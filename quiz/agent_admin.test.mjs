import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  beginAgent,
  ensureBaseHouseTemplate,
  establishAgent,
  improveAgent,
  listAgents,
  readAgentOrganization,
  restartAgent,
  stopAgent
} from "../program/agent/admin.mjs";
import { readServiceControls } from "../program/agent/scheduler_service_control.mjs";

async function makeWorldRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-admin-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

test("ensureBaseHouseTemplate creates required base directories", async () => {
  const worldRoot = await makeWorldRoot();
  await ensureBaseHouseTemplate({ worldRoot });
  const expected = [
    path.join("house", "base", "identity"),
    path.join("house", "base", "memory"),
    path.join("house", "base", "session"),
    path.join("house", "base", "conduct"),
    path.join("house", "base", "program"),
    path.join("house", "base", "artifacts"),
    path.join("house", "base", "gold", "accepted"),
    path.join("house", "base", "gold", "rejected")
  ];
  for (const rel of expected) {
    const full = path.join(worldRoot, rel);
    const stat = await fs.stat(full);
    assert.equal(stat.isDirectory(), true, `expected directory: ${rel}`);
  }
});

test("establish/list/improve manage a new agent house", async () => {
  const worldRoot = await makeWorldRoot();
  const establishedFirst = await establishAgent({
    worldRoot,
    agentName: "parity coder",
    purpose: "Fix parity regressions and report delta.",
    intervalMinutes: 12,
    nowFn: () => new Date("2026-02-09T10:00:00.000Z")
  });
  assert.equal(establishedFirst.action, "establish");
  assert.equal(establishedFirst.agentName, "parity coder");
  assert.equal(establishedFirst.status, "created");
  assert.equal(establishedFirst.changed, true);

  const establishedSecond = await establishAgent({
    worldRoot,
    agentName: "parity coder",
    purpose: "Fix parity regressions and report delta.",
    intervalMinutes: 12
  });
  assert.equal(establishedSecond.status, "unchanged");
  assert.equal(establishedSecond.changed, false);
  assert.deepEqual(establishedSecond.changes, []);

  const establishedThird = await establishAgent({
    worldRoot,
    agentName: "parity coder",
    purpose: "Fix parity regressions and report delta.",
    intervalMinutes: 30
  });
  assert.equal(establishedThird.status, "updated");
  assert.equal(establishedThird.changed, true);
  assert.equal(establishedThird.changes.includes("calendar"), true);

  const listed = await listAgents({ worldRoot });
  assert.deepEqual(listed, ["parity coder"]);

  const improved = await improveAgent({
    worldRoot,
    agentName: "parity coder",
    note: "Prefer targeted tests before npm test.",
    nowFn: () => new Date("2026-02-09T10:01:00.000Z")
  });
  assert.equal(improved.action, "improve");
  assert.equal(improved.changed, true);
});

test("begin/stop/restart toggle agent schedule services deterministically", async () => {
  const worldRoot = await makeWorldRoot();
  await establishAgent({
    worldRoot,
    agentName: "parity coder",
    purpose: "Fix parity regressions and report delta.",
    intervalMinutes: 12
  });

  const beginRes = await beginAgent({
    worldRoot,
    agentName: "parity coder",
    startScheduler: false
  });
  assert.equal(beginRes.action, "begin");
  assert.equal(beginRes.enabledServices.includes("parity coder heartbeat"), true);

  const controlsAfterBegin = await readServiceControls({ worldRoot });
  assert.equal(controlsAfterBegin.get("parity coder heartbeat"), true);

  const stopRes = await stopAgent({
    worldRoot,
    agentName: "parity coder"
  });
  assert.equal(stopRes.action, "stop");

  const controlsAfterStop = await readServiceControls({ worldRoot });
  assert.equal(controlsAfterStop.get("parity coder heartbeat"), false);

  const restartRes = await restartAgent({
    worldRoot,
    agentName: "parity coder",
    startScheduler: false
  });
  assert.equal(restartRes.action, "restart");

  const controlsAfterRestart = await readServiceControls({ worldRoot });
  assert.equal(controlsAfterRestart.get("parity coder heartbeat"), true);
});

test("establish reconciles role-bearing house organization and reads it back", async () => {
  const worldRoot = await makeWorldRoot();
  const chief = await establishAgent({
    worldRoot,
    agentName: "chief of staff",
    purpose: "Coordinate Headquarters work.",
    organization: {
      role: "Chief of Staff",
      supervisor: "",
      responsibilities: ["coordinate work", "review escalations", "coordinate work"],
      domains: ["headquarters", "operations"]
    }
  });
  const worker = await establishAgent({
    worldRoot,
    agentName: "correspondence worker",
    purpose: "Handle correspondence.",
    organization: {
      role: "Correspondence Worker",
      supervisor: "chief of staff",
      responsibilities: ["classify correspondence", "draft replies"],
      domains: ["correspondence", "operations"]
    }
  });

  assert.equal(chief.status, "created");
  assert.equal(worker.status, "created");
  assert.deepEqual(await listAgents({ worldRoot }), ["chief of staff", "correspondence worker"]);
  assert.deepEqual(await readAgentOrganization({ worldRoot, agentName: chief.agentName }), {
    role: "Chief of Staff",
    supervisor: "",
    responsibilities: ["coordinate work", "review escalations"],
    domains: ["headquarters", "operations"]
  });
  assert.deepEqual(await readAgentOrganization({ worldRoot, agentName: worker.agentName }), {
    role: "Correspondence Worker",
    supervisor: "chief of staff",
    responsibilities: ["classify correspondence", "draft replies"],
    domains: ["correspondence", "operations"]
  });

  const organizationPath = path.join(worker.agentRoot, "conduct", "organization.pya");
  const firstText = await fs.readFile(organizationPath, "utf8");
  assert.match(firstText, /su name organization be map def/);
  assert.match(firstText, /su name responsibilities ob ve text/);

  const updated = await establishAgent({
    worldRoot,
    agentName: "correspondence worker",
    purpose: "Handle correspondence.",
    organization: {
      role: "Correspondence Worker",
      supervisor: "chief of staff",
      responsibilities: ["classify correspondence", "approve drafts"],
      domains: ["correspondence"]
    }
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.changes.includes("organization"), true);
  assert.deepEqual(await readAgentOrganization({ worldRoot, agentName: "correspondence worker" }), {
    role: "Correspondence Worker",
    supervisor: "chief of staff",
    responsibilities: ["classify correspondence", "approve drafts"],
    domains: ["correspondence"]
  });

  const beforeUnchanged = await fs.readFile(organizationPath, "utf8");
  const unchanged = await establishAgent({
    worldRoot,
    agentName: "correspondence worker",
    purpose: "Handle correspondence.",
    organization: {
      role: "Correspondence Worker",
      supervisor: "chief of staff",
      responsibilities: ["classify correspondence", "approve drafts"],
      domains: ["correspondence"]
    }
  });
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.changed, false);
  assert.equal(await fs.readFile(organizationPath, "utf8"), beforeUnchanged);
});

test("legacy house organization reads as empty defaults", async () => {
  const worldRoot = await makeWorldRoot();
  const legacyRoot = path.join(worldRoot, "house", "legacy worker", "conduct");
  await fs.mkdir(legacyRoot, { recursive: true });
  assert.deepEqual(await readAgentOrganization({ worldRoot, agentName: "legacy worker" }), {
    role: "",
    supervisor: "",
    responsibilities: [],
    domains: []
  });
});
