import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listWorldDeclaredAgentHouses,
  resolveWorldAgentDirectoryLicense,
  resolveWorldAgentHouseDirectory
} from "../program/library/agent_command_policy.mjs";

test("agent policy resolves declared house directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-house-"));
  const worldRoot = path.join(root, "world");
  const policyDir = path.join(worldRoot, "conduct");
  await fs.mkdir(policyDir, { recursive: true });
  await fs.writeFile(
    path.join(policyDir, "agent.pya"),
    [
      'su name helper house directory ob filename "world/house/helper-custom" ya',
      "su name helper directory license be map def",
      '  su name "world/house/helper-custom" ob ve text "read" "write" "command" ya',
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );

  const housePath = resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName: "helper",
    includeFallback: false
  });
  assert.equal(housePath, path.join(worldRoot, "house", "helper-custom"));
});

test("agent policy lists declared houses in sorted order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-list-"));
  const worldRoot = path.join(root, "world");
  const policyDir = path.join(worldRoot, "conduct");
  await fs.mkdir(policyDir, { recursive: true });
  await fs.writeFile(
    path.join(policyDir, "agent.pya"),
    [
      'su name beta house directory ob filename "world/house/beta" ya',
      'su name alpha house directory ob filename "world/house/alpha" ya',
      ""
    ].join("\n"),
    "utf8"
  );

  const listed = listWorldDeclaredAgentHouses({ worldRoot });
  assert.deepEqual(
    listed.map((entry) => entry.agentName),
    ["alpha", "beta"]
  );
});

test("agent policy license parsing keeps directory capabilities", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-license-"));
  const worldRoot = path.join(root, "world");
  const policyDir = path.join(worldRoot, "conduct");
  await fs.mkdir(policyDir, { recursive: true });
  await fs.writeFile(
    path.join(policyDir, "agent.pya"),
    [
      'su name helper house directory ob filename "world/house/helper" ya',
      "su name helper directory license be map def",
      '  su name "world/house/helper" ob ve text "read" "write" ya',
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );

  const license = resolveWorldAgentDirectoryLicense({ worldRoot, agentName: "helper" });
  assert.equal(Array.isArray(license?.entries), true);
  assert.equal(license?.entries?.length, 1);
  assert.deepEqual(license?.entries?.[0]?.capabilities, ["read", "write"]);
});

test("agent policy derives house directory from legacy license map when declaration is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-derive-"));
  const worldRoot = path.join(root, "world");
  const policyDir = path.join(worldRoot, "conduct");
  await fs.mkdir(policyDir, { recursive: true });
  await fs.writeFile(
    path.join(policyDir, "agent.pya"),
    [
      "su name helper directory license be map def",
      '  su name "world/house/helper" ob ve text "read" "write" "command" ya',
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );

  const resolved = resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName: "helper",
    includeFallback: false
  });
  assert.equal(resolved, path.join(worldRoot, "house", "helper"));
});
