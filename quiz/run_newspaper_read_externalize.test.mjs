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

test("run newspaper externalizes read text into artifact", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-read-"));
  const inputPath = path.join(tmpDir, "input.txt");
  const body = `${"Solon ".repeat(600)}\n${"Athens ".repeat(600)}`;
  await fs.writeFile(inputPath, body, "utf8");
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, 'from filename "input.txt" be read do\n', "utf8");

  const scriptPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync(process.execPath, [
    scriptPath,
    "--newspaper",
    "--run-id", "run-read-externalize",
    "--run-time", "2026-02-23T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-read-externalize.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  assert.equal(newspaper.includes(body.slice(0, 200)), false, "newspaper should not include raw read text");

  const artifactLine = lines.find((line) => line.includes("be artifact") && line.includes("from name newspaper"));
  assert.ok(artifactLine, "expected newspaper text artifact line");
  const hashMatch = artifactLine.match(/fromtext text \"([a-f0-9]+)\"/);
  assert.ok(hashMatch, "expected sha256 hash on artifact");
  const hash = hashMatch[1];
  const caPath = path.join(tmpDir, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.txt`);
  await fs.access(caPath);

  const readResultLine = lines.find((line) => line.includes("be read ya") && line.includes("artifact "));
  assert.ok(readResultLine, "expected read result to reference artifact marker");
});
