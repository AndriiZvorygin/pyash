import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

function normalizeLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

test("runjs records exchange lines in newspaper", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-js-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"hello\" to filename \"out.txt\" be write do\n", "utf8");

  const scriptPath = path.join(repoRoot, "runjs");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-js-exchange",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-js-exchange.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.ok(lines.some(line => line.includes("be artifact") && line.includes("out.txt")));
  assert.ok(lines.some(line => line.includes("be exchange") && line.includes("as name write")));
  const artifactLine = lines.find(line => line.includes("be artifact") && line.includes("out.txt"));
  const toMatch = artifactLine.match(/to filename (\"([^\"]+)\"|([^ ]+))/);
  assert.ok(toMatch);
  const locator = toMatch[2] || toMatch[3];
  const hashMatch = artifactLine.match(/fromtext text \"([a-f0-9]+)\"/);
  assert.ok(hashMatch);
  const hash = hashMatch[1];
  const ext = path.extname(locator);
  const caRel = path.join("artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
  const caPath = path.join(tmpDir, caRel);
  await fs.access(caPath);
  const nameMatch = artifactLine.match(/su name ([^ ]+)/);
  assert.ok(nameMatch);
  const aliasPath = path.join(tmpDir, "artifacts", "run-js-exchange", nameMatch[1]);
  await fs.access(aliasPath);
});
