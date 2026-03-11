import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function runWithStdin(script, payload, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => resolve({ code, stdout, stderr }));
    proc.stdin.end(payload);
  });
}

test("mind ollama runner reads stdin payload when spawned as child process", async () => {
  const payload = JSON.stringify({
    mode: "generate",
    model: "qwen3.5:9b",
    prompt: "hello",
    keep_alive: 0,
    host: "http://127.0.0.1:1"
  });
  const res = await runWithStdin("command/mind_ollama_runner.mjs", payload);
  assert.equal(/missing request payload/i.test(res.stderr), false);
});

test("mind openai runner reads stdin payload when spawned as child process", async () => {
  const payload = JSON.stringify({
    mode: "generate",
    model: "gpt-test",
    prompt: "hello",
    host: "http://127.0.0.1:1"
  });
  const res = await runWithStdin("command/mind_openai_runner.mjs", payload, {
    OPENAI_API_KEY: "test-key"
  });
  assert.equal(/missing request payload/i.test(res.stderr), false);
});
