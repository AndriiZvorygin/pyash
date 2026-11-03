import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "command/mind_openai_runner.mjs");

function runRunner(args, payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, ...args], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("Z.AI mind runner calls Codex with a temporary isolated Responses profile", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-zai-runner-test-"));
  const binDir = path.join(tempDir, "bin");
  const probePath = path.join(tempDir, "probe.json");
  await fs.mkdir(binDir);
  const fakeCodexPath = path.join(binDir, "codex");
  await fs.writeFile(fakeCodexPath, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const home = process.env.CODEX_HOME;
const config = fs.readFileSync(path.join(home, "config.toml"), "utf8");
const models = JSON.parse(fs.readFileSync(path.join(home, "models.json"), "utf8"));
fs.writeFileSync(process.env.PYA_ZAI_PROBE, JSON.stringify({
  home,
  args: process.argv.slice(2),
  model: models.models[0].slug,
  hasCodingKey: config.includes(process.env.Z_AI_CODING_API_KEY),
  correctProtocol: config.includes('wire_api = "responses"'),
  correctBaseUrl: config.includes('https://api.z.ai/api/v1'),
  contextWindow: Number(config.match(/^model_context_window = (\\d+)$/m)?.[1] || 0)
}));
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "GLM route reached Codex CLI" } }) + "\\n");
`);
  await fs.chmod(fakeCodexPath, 0o700);
  try {
    const result = await runRunner(["--zai-codex"], {
      model: "glm-5.3",
      reasoningEffort: "max",
      contextWindow: 65536,
      toolMapName: "saddle tools",
      messages: [{ role: "user", content: "Reply with a short readiness check." }]
    }, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      PYA_ZAI_PROBE: probePath,
      PYA_COMMAND_RESPONSE: "",
      Z_AI_CODING_API_KEY: "test-only-coding-key"
    });
    assert.equal(result.code, 0, result.stderr);
    const answer = JSON.parse(result.stdout.trim());
    assert.equal(answer.response, "GLM route reached Codex CLI");
    const probe = JSON.parse(await fs.readFile(probePath, "utf8"));
    assert.equal(probe.model, "glm-5.3");
    assert.equal(probe.hasCodingKey, true);
    assert.equal(probe.correctProtocol, true);
    assert.equal(probe.correctBaseUrl, true);
    assert.equal(probe.contextWindow, 65536);
    assert.ok(probe.args.includes("--disable"));
    assert.ok(probe.args.includes("shell_tool"));
    assert.ok(probe.args.includes("--cd"));
    assert.ok(probe.args.includes(root));
    assert.ok(probe.args.includes('mcp_servers.pyash.default_tools_approval_mode="approve"'));
    assert.ok(probe.args.includes("mcp_servers.pyash.required=true"));
    const mcpArgsSetting = probe.args.find((arg) => arg.startsWith("mcp_servers.pyash.args="));
    assert.ok(mcpArgsSetting, "expected Pyash MCP server args in Codex config");
    const mcpArgs = JSON.parse(mcpArgsSetting.slice("mcp_servers.pyash.args=".length));
    assert.ok(mcpArgs.includes("--root"));
    assert.equal(mcpArgs[mcpArgs.indexOf("--root") + 1], root);
    assert.ok(mcpArgs.includes("--config-root"));
    assert.equal(mcpArgs[mcpArgs.indexOf("--config-root") + 1], root);
    assert.equal(mcpArgs.at(-1), "saddle tools");
    assert.ok(probe.args.includes("--sandbox") === false);
    await assert.rejects(fs.access(probe.home));
    assert.equal(result.stdout.includes("test-only-coding-key"), false);
    assert.equal(result.stderr.includes("test-only-coding-key"), false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
