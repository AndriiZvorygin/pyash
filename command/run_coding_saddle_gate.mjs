import { spawn } from "node:child_process";

const checks = [
  ["node", "--test", "quiz/saddle_tools_signatures.test.mjs"],
  ["node", "--test", "quiz/saddle_tool_flow.test.mjs"],
  ["node", "--test", "quiz/saddle_live_gpt_oss.test.mjs"]
];

function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function runWithRetry(commandParts) {
  const [cmd, ...args] = commandParts;
  const label = commandParts.join(" ");
  let code = await runCommand(cmd, args);
  if (code === 0) return { label, attempts: 1, code };

  console.error(`retrying: ${label}`);
  code = await runCommand(cmd, args);
  return { label, attempts: 2, code };
}

const results = [];
for (const check of checks) {
  // Keep each readiness check isolated and allow one retry.
  // This supports live-model variance without hiding repeated failures.
  // eslint-disable-next-line no-await-in-loop
  const result = await runWithRetry(check);
  results.push(result);
}

const failed = results.filter((entry) => entry.code !== 0);
for (const result of results) {
  const status = result.code === 0 ? "pass" : "fail";
  console.log(`${status}: ${result.label} (attempts=${result.attempts})`);
}

if (failed.length > 0) {
  process.exit(1);
}
