import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

function normalizeLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile js refinery runner executes platforms in deterministic order", async () => {
  const programPath = path.resolve("examples/pyash/refinery-pass.pya");
  const jsSentence = parse(`from filename "${programPath}" to state javascript to text output be compile do`);
  const jsResult = await interpret(jsSentence);
  const js = unwrapQuoted(jsResult?.ob?.text ?? jsResult?.value?.text ?? "", "javascript");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-runjs-refinery-"));
  const entryPath = path.join(tempDir, "compiled.mjs");
  try {
    await fs.writeFile(entryPath, js, "utf8");
    const proc = spawnSync(process.execPath, [entryPath], {
      encoding: "utf8",
      env: { ...process.env, PYA_REFINERY: "line" }
    });
    assert.equal(proc.status, 0, proc.stderr || "compiled runjs exited non-zero");
    const lines = normalizeLines(proc.stdout).filter(line => line === "a" || line === "b");
    assert.deepEqual(lines, ["a", "b"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
