import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildAgentSystemPrompt } from "../program/agent/context.mjs";
import { resolveWorldAgentHouseDirectory } from "../program/library/agent_command_policy.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  ensureCodingSaddleHouse,
  resolveCodingSaddleHousePath,
  seedCodingSaddleHouseGuide
} from "../program/agent/coding_saddle_house.mjs";

test("coding saddle house is project-named, mapped, and safely migrates legacy state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-"));
  const worldRoot = path.join(root, "world");
  const cwd = path.join(root, "projects", "City Simulation");
  const legacy = path.join(worldRoot, "house", "coding saddle");
  const expected = path.join(worldRoot, "house", "city-simulation-coding-saddle");
  await fs.mkdir(path.join(legacy, "session"), { recursive: true });
  await fs.mkdir(expected, { recursive: true });
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.writeFile(path.join(legacy, "session", "coding.pya"), "existing transcript\n", "utf8");
  await fs.writeFile(path.join(worldRoot, "conduct", "agent.pya"), 'su name another agent house directory ob filename "other-house" ya\n', "utf8");

  try {
    const house = await ensureCodingSaddleHouse({ worldRoot, cwd });
    assert.equal(house, expected);
    assert.equal(await fs.readFile(path.join(expected, "session", "coding.pya"), "utf8"), "existing transcript\n");
    await assert.rejects(fs.access(legacy), { code: "ENOENT" });

    const mapping = await fs.readFile(path.join(worldRoot, "conduct", "agent.pya"), "utf8");
    assert.match(mapping, /su name another agent house directory/u);
    assert.ok(mapping.includes(`su name coding saddle house directory ob filename ${JSON.stringify(expected)} ya`));
    assert.equal(resolveWorldAgentHouseDirectory({ worldRoot, agentName: "coding saddle" }), expected);
    const manifest = await fs.readFile(path.join(worldRoot, "coding-saddle-project.pya"), "utf8");
    assert.ok(manifest.includes(`project cwd ob filename ${JSON.stringify(path.resolve(cwd))} ya`));
    for (const line of manifest.trim().split("\n")) assert.equal(parse(line).mood, "ya");
    assert.equal(await ensureCodingSaddleHouse({ worldRoot, cwd }), expected);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle refuses a project-world manifest from a different resolved path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-scope-"));
  const worldRoot = path.join(root, "world");
  const requestedCwd = path.join(root, "project-b");
  await fs.mkdir(worldRoot, { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "coding-saddle-project.pya"),
    `su name coding saddle project cwd ob filename ${JSON.stringify(path.join(root, "project-a"))} ya\n`,
    "utf8"
  );
  try {
    await assert.rejects(ensureCodingSaddleHouse({ worldRoot, cwd: requestedCwd }), /belongs to .*project-a, not .*project-b/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle house migration archives a populated legacy house beside the active project house", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-conflict-"));
  const worldRoot = path.join(root, "world");
  const cwd = path.join(root, "projects", "client");
  const legacy = path.join(worldRoot, "house", "coding saddle");
  const destination = resolveCodingSaddleHousePath({ worldRoot, cwd });
  await fs.mkdir(legacy, { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(legacy, "old.md"), "old state\n", "utf8");
  await fs.writeFile(path.join(destination, "new.md"), "new state\n", "utf8");

  try {
    assert.equal(await ensureCodingSaddleHouse({ worldRoot, cwd }), destination);
    const archive = path.join(path.dirname(legacy), "coding saddle legacy");
    assert.equal(await fs.readFile(path.join(archive, "old.md"), "utf8"), "old state\n");
    assert.equal(await fs.readFile(path.join(destination, "new.md"), "utf8"), "new state\n");
    await assert.rejects(fs.access(legacy), { code: "ENOENT" });
    assert.equal(await ensureCodingSaddleHouse({ worldRoot, cwd }), destination);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle accepts a mapped house reached through a shared-world symlink", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-symlink-"));
  const worldRoot = path.join(root, "dev", "world");
  const cwd = path.join(root, "projects", "biography");
  const sharedHouse = path.join(root, "shared", "biography-coding-saddle");
  const destination = resolveCodingSaddleHousePath({ worldRoot, cwd });
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(sharedHouse, "session"), { recursive: true });
  await fs.writeFile(path.join(sharedHouse, "session", "coding.pya"), "existing transcript\n", "utf8");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.symlink(sharedHouse, destination, "dir");
  await fs.writeFile(
    path.join(worldRoot, "conduct", "agent.pya"),
    `su name coding saddle house directory ob filename ${JSON.stringify(sharedHouse)} ya\n`,
    "utf8"
  );

  try {
    assert.equal(await ensureCodingSaddleHouse({ worldRoot, cwd }), destination);
    assert.equal(await fs.readFile(path.join(destination, "session", "coding.pya"), "utf8"), "existing transcript\n");
    const mapping = await fs.readFile(path.join(worldRoot, "conduct", "agent.pya"), "utf8");
    assert.ok(mapping.includes(`su name coding saddle house directory ob filename ${JSON.stringify(sharedHouse)} ya`));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle seeds and injects its house guide without replacing user identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-guide-"));
  const cwd = path.join(root, "repo");
  const agentHouse = await ensureCodingSaddleHouse({ worldRoot: path.join(root, "world"), cwd });
  const identityDir = path.join(agentHouse, "identity");
  const houseGuide = path.join(identityDir, "HOUSE.md");
  await fs.mkdir(identityDir, { recursive: true });
  await fs.writeFile(path.join(identityDir, "IDENTITY.md"), "Project-specific identity.\n", "utf8");

  try {
    await seedCodingSaddleHouseGuide({ agentHouse, cwd });
    const guide = await fs.readFile(houseGuide, "utf8");
    assert.match(guide, /relative paths from that directory/u);
    assert.match(guide, /memory\/MEMORY\.md/u);
    assert.match(guide, /Shell commands continue to run from the project directory/u);
    const prompt = await buildAgentSystemPrompt({ agentHouse, mindName: "coding saddle" });
    assert.match(prompt, /Coding Saddle House/u);
    assert.match(prompt, /Project-specific identity/u);

    await fs.writeFile(houseGuide, "User-authored house instructions.\n", "utf8");
    await seedCodingSaddleHouseGuide({ agentHouse, cwd });
    assert.equal(await fs.readFile(houseGuide, "utf8"), "User-authored house instructions.\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
