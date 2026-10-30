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
  model: models.models[0].slug,
  hasCodingKey: config.includes(process.env.Z_AI_CODING_API_KEY),
  correctProtocol: config.includes('wire_api = "responses"'),
  correctBaseUrl: config.includes('https://api.z.ai/api/v1')
}));
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "GLM route reached Codex CLI" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 101, cached_input_tokens: 41, cache_write_input_tokens: 2, output_tokens: 23, reasoning_output_tokens: 7 } }) + "\\n");
`);
  await fs.chmod(fakeCodexPath, 0o700);
  try {
    const result = await runRunner(["--zai-codex"], {
      reasoningEffort: "max",
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
    assert.deepEqual(answer.usage, {
      inputTokens: 101,
      cachedInputTokens: 41,
      cacheWriteInputTokens: 2,
      outputTokens: 23,
      reasoningOutputTokens: 7,
      totalTokens: 124
    });
    const probe = JSON.parse(await fs.readFile(probePath, "utf8"));
    assert.equal(probe.model, "glm-5.3-flash");
    assert.equal(probe.hasCodingKey, true);
    assert.equal(probe.correctProtocol, true);
    assert.equal(probe.correctBaseUrl, true);
    await assert.rejects(fs.access(probe.home));
    assert.equal(result.stdout.includes("test-only-coding-key"), false);
    assert.equal(result.stderr.includes("test-only-coding-key"), false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
