import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

async function runScript(scriptRelPath, args) {
  const scriptPath = path.resolve(repoRoot, scriptRelPath);
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => { stdout += data.toString("utf8"); });
    proc.stderr.on("data", (data) => { stderr += data.toString("utf8"); });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("extract_report emits deterministic report from newspaper", async () => {
  const runId = "report-extract";
  const runTime = "2026-01-30T00:00:00.000Z";
  const fixturePath = path.join("quiz", "fixtures", "report_extract_fixture.pya");
  const runScriptPath = "command/run_pya_program.mjs";
  const extractScriptPath = "command/extract_report.mjs";

  const runResult = await runScript(runScriptPath, [
    "--run-id", runId,
    "--run-time", runTime,
    fixturePath
  ]);
  assert.equal(runResult.code, 0, runResult.stderr || runResult.stdout);

  const reportResult = await runScript(extractScriptPath, [
    "--run-id", runId
  ]);
  assert.equal(reportResult.code, 0, reportResult.stderr || reportResult.stdout);

  const runRoot = path.resolve(repoRoot);
  const expected = [
    "su name report header be json map def",
    `su name run id ob text \"${runId}\" ya`,
    `su name run time ob text \"${runTime}\" ya`,
    `su name run root ob filename ${runRoot} ya`,
    "su name report header prah",
    "su name platform outcome 1 be json map def",
    "su name platform name ob name step ya",
    "su name platform order ob num 1 ya",
    "su name platform activity ob la su name result ob text \"ok\" be write ya ko ya",
    "su name platform result ob la su name result ob text \"ok\" be write ya ko ya",
    "su name platform status ob text \"ok\" ya",
    "su name platform outcome 1 prah",
    "su name report end be report ya",
    ""
  ].join("\n");

  assert.equal(reportResult.stdout, expected);
});
