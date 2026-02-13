import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseImportPolicyText,
  mergeImportPolicies,
  loadImportPolicyWithGlobal
} from "../program/agent/import/policy.mjs";

test("import policy parser reads map entries", () => {
  const text = [
    "su name import be map def",
    "  su name photograph ob name receipt photograph import ya",
    "  su name file ob text \"file classify\" ya",
    "  su name read tool ob text \"be read from filename <path>\" ya",
    "prah"
  ].join("\n");
  const policy = parseImportPolicyText(text);
  assert.equal(policy.photographAction?.kind, "name");
  assert.equal(policy.photographAction?.name, "receipt photograph import");
  assert.equal(policy.fileAction?.kind, "text");
  assert.equal(policy.fileAction?.text, "file classify");
  assert.equal(policy.readToolGuidance?.kind, "text");
  assert.equal(policy.readToolGuidance?.text, "be read from filename <path>");
});

test("import policy parser keeps ob la sentence actions", () => {
  const text = [
    "su name import be map def",
    "  su name file ob la from filename input to name text import output be read do ko ya",
    "prah"
  ].join("\n");
  const policy = parseImportPolicyText(text);
  assert.equal(policy.fileAction?.kind, "sentence");
  assert.equal(policy.fileAction?.sentence?.be, "read");
  assert.equal(policy.fileAction?.sentence?.from?.filename, "input");
});

test("import policy merge prefers agent override", () => {
  const base = {
    photographAction: { kind: "text", text: "world photograph" },
    fileAction: { kind: "text", text: "world file" },
    defaultAction: { kind: "text", text: "world default" },
    readToolGuidance: { kind: "text", text: "world read" }
  };
  const override = {
    photographAction: { kind: "text", text: "agent photograph" },
    readToolGuidance: { kind: "text", text: "agent read" }
  };
  const merged = mergeImportPolicies(base, override);
  assert.equal(merged.photographAction?.text, "agent photograph");
  assert.equal(merged.fileAction?.text, "world file");
  assert.equal(merged.defaultAction?.text, "world default");
  assert.equal(merged.readToolGuidance?.text, "agent read");
});

test("import policy loader merges world and agent files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-import-policy-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "helper");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name photograph ob text \"world photograph\" ya",
    "  su name file ob text \"world file\" ya",
    "  su name see tool ob text \"be see from filename <photograph>\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(agentHouse, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name photograph ob text \"agent photograph\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");
  const policy = await loadImportPolicyWithGlobal({ worldRoot, agentHouse });
  assert.equal(policy.photographAction?.text, "agent photograph");
  assert.equal(policy.fileAction?.text, "world file");
  assert.equal(policy.seeToolGuidance?.text, "be see from filename <photograph>");
});
