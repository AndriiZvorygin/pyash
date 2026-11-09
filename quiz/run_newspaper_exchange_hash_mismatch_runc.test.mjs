import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

test("runc records successive writes as immutable artifact versions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-hash-c-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "ob text \"alpha\" to filename \"out.txt\" be write do",
    "ob text \"beta\" to filename \"out.txt\" be write do",
    "from filename \"out.txt\" be read do",
    ""
  ].join("\n"), "utf8");

  const scriptPath = path.join(repoRoot, "runc");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-exchange-hash-c",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-exchange-hash-c.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const records = splitSentences(newspaper).map(line => parse(line.trim())).filter(Boolean);
  const versions = records.filter(record => record?.be === "artifact" && record?.to?.filename === "out.txt");
  assert.equal(versions.length, 2);
  assert.notEqual(versions[0].su.name, versions[1].su.name);
  assert.notEqual(versions[0].fromtext.text, versions[1].fromtext.text);
  assert.equal(await fs.readFile(path.join(tmpDir, "out.txt"), "utf8"), "beta");
  assert.equal(records.filter(record => record?.be === "exchange" && record?.as?.name === "read").length, 1);

  await execFileAsync(process.execPath, [
    path.join(repoRoot, "command", "replay_newspaper.mjs"),
    "--run-id", "run-exchange-hash-c",
    "--run-root", tmpDir
  ], { cwd: tmpDir, timeout: 120000 });
});
