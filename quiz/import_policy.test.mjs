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
    "  su name image do ob name receipt image import ya",
    "  su name no caption image do ob text \"receipt image import\" ya",
    "  su name file do ob text \"file classify\" ya",
    "  su name read tool do ob text \"be read from filename <path>\" ya",
    "prah"
  ].join("\n");
  const policy = parseImportPolicyText(text);
  assert.equal(policy.imageAction, "receipt image import");
  assert.equal(policy.noCaptionImageAction, "receipt image import");
  assert.equal(policy.fileAction, "file classify");
  assert.equal(policy.readToolGuidance, "be read from filename <path>");
});

test("import policy merge prefers agent override", () => {
  const base = {
    imageAction: "world image",
    fileAction: "world file",
    defaultAction: "world default",
    noCaptionImageAction: "",
    readToolGuidance: "world read"
  };
  const override = {
    imageAction: "agent image",
    noCaptionImageAction: "agent no caption",
    readToolGuidance: "agent read"
  };
  const merged = mergeImportPolicies(base, override);
  assert.equal(merged.imageAction, "agent image");
  assert.equal(merged.fileAction, "world file");
  assert.equal(merged.defaultAction, "world default");
  assert.equal(merged.noCaptionImageAction, "agent no caption");
  assert.equal(merged.readToolGuidance, "agent read");
});

test("import policy loader merges world and agent files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-import-policy-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "helper");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name image do ob text \"world image\" ya",
    "  su name file do ob text \"world file\" ya",
    "  su name see tool do ob text \"be see from filename <image>\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(agentHouse, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name image do ob text \"agent image\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");
  const policy = await loadImportPolicyWithGlobal({ worldRoot, agentHouse });
  assert.equal(policy.imageAction, "agent image");
  assert.equal(policy.fileAction, "world file");
  assert.equal(policy.seeToolGuidance, "be see from filename <image>");
});
