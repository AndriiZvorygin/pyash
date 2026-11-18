import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { stripTerminalControlSequences } from "../program/agent/coding_saddle_tui.mjs";
import { buildSaddleSteeringInput } from "../program/agent/coding_saddle.mjs";
import { resolveSaddleProjectWorldRoot } from "../command/pyash_saddle.mjs";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firstModel = "qwen3.5:9b";
const secondModel = "SparkLLM/Spark-X2.6-4B:q4_k_m";

function waitForOutput(getOutput, needle, { timeoutMs = 90000, afterIndex = 0 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      if (output.indexOf(needle, afterIndex) >= 0) {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForOutputAfter(getOutput, marker, needle, { timeoutMs = 90000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      const markerIndex = output.indexOf(marker);
      if (markerIndex >= 0 && output.indexOf(needle, markerIndex + marker.length) >= 0) {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)} after ${JSON.stringify(marker)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("saddle CLI switches Ollama models in a PTY and runs the default Bash tool", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-pty-"));
  const projectRoot = path.join(tempRoot, "project");
  const projectWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectRoot });
  const usageDir = path.join(tempRoot, "usage");
  const sessionName = `pty-model-switch-${process.pid}-${Date.now()}`;
  const bashMarker = "SADDLE_BASH_PTY_OK";
  const stderrMarker = "SADDLE_BASH_STDERR_PTY";
  const continuationContext = "Should our Robot Science Fiction magazine repository start with a README?";
  const continuationOffer = "A short README would help. I can create magazine/README.md with the magazine premise. Want me to write it?";
  const continuationCreateCommand = "mkdir -p magazine && cat > magazine/README.md <<'EOF'\n# Robot Science Fiction Magazine\n\nA home for speculative stories about robots and the futures they shape.\nEOF";
  const continuationVerifyCommand = "test -s magazine/README.md";
  const cleanupRequest = "please also remove any Python-style directories";
  const approvalRequest = "remove the scaffold directory";
  const proposalResponse = "Yes, I can create agents.md for the Robot Science Fiction magazine. Want me to create it?";
  const steeringInput = buildSaddleSteeringInput({
    originalInput: "so should we start with an agents.md perhaps?",
    assistantResponse: proposalResponse,
    additions: "go ahead"
  });
  const createAgentsCommand = "cat > agents.md <<'EOF'\n# Robot Science Fiction Magazine\n\nProject guidance.\nEOF";
  const verifyAgentsCommand = "test -s agents.md";
  const approvalCommand = "rm -rf ./magaiize";
  const verifyLocalScaffoldCommand = "test ! -e ./magaiize";
  const cleanupDirectory = path.join(projectRoot, "magaiize", "src", "__pycache__");
  const removePythonDirectoryCommand = "find ./magaiize -type d -name '__pycache__' -empty -prune -exec rmdir {} +";
  const verifyPythonDirectoriesCommand = "find ./magaiize -type d \\( -name '__pycache__' -o -name '.pytest_cache' \\) -print";
  const failingCommand = `node -e "process.stdout.write('SADDLE_BASH_STDOUT_PTY\\n'); process.stderr.write('${stderrMarker}\\n'); process.exit(7)"`;
  const submissions = [];
  const jobs = new Map();
  let nextJobId = 0;
  const housekeeper = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : null;
    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/snapshot") {
      res.end(JSON.stringify({ hostId: "pty-test", queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/queue") {
      res.end(JSON.stringify({ available: true, queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/runtime/ollama/models") {
      res.end(JSON.stringify({ models: [{ name: firstModel }, { name: secondModel }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      const remoteJobId = `pty-saddle-job-${++nextJobId}`;
      const payload = body?.jobSpec?.payload ?? {};
      submissions.push(payload);
      jobs.set(remoteJobId, payload);
      res.end(JSON.stringify({ remoteJobId }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/job/pty-saddle-job-")) {
      const remoteJobId = decodeURIComponent(req.url.slice("/job/".length));
      const payload = jobs.get(remoteJobId) ?? {};
      if (payload.model === secondModel && !Number(payload.options?.num_ctx)) {
        res.end(JSON.stringify({
          status: "failed",
          error: {
            message: "Ollama inference request failed: ollama request failed 400: {\"error\":\"request (66958 tokens) exceeds the available context size (32768 tokens), try increasing it\"}"
          }
        }));
        return;
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const hasToolResult = messages.some((message) => message?.role === "tool");
      const latestUserIndex = messages.findLastIndex((message) => message?.role === "user");
      const currentTurnMessages = latestUserIndex < 0 ? [] : messages.slice(latestUserIndex + 1);
      const currentTurnToolResults = currentTurnMessages.filter((message) => message?.role === "tool");
      const hasStderrToolResult = messages.some((message) => message?.role === "tool"
        && String(message.content ?? "").includes(stderrMarker));
      const lastUserMessage = [...messages].reverse().find((message) => message?.role === "user")?.content;
      let message;
      if (payload.model === firstModel) {
        message = { role: "assistant", content: "Qwen first model turn passed." };
      } else if (lastUserMessage === continuationContext) {
        message = { role: "assistant", content: continuationOffer };
      } else if (String(lastUserMessage ?? "").includes("Additional context:\ncontinue")
        && !String(lastUserMessage ?? "").includes("Harness completion check")) {
        message = { role: "assistant", content: "I'll create magazine/README.md now." };
      } else if (String(lastUserMessage ?? "").includes("Harness completion check: the original code-change request")
        && String(lastUserMessage ?? "").includes("magazine/README.md")) {
        const fileCreated = currentTurnToolResults.some((tool) => String(tool.content ?? "").includes(continuationCreateCommand));
        const fileVerified = currentTurnToolResults.some((tool) => String(tool.content ?? "").includes(continuationVerifyCommand));
        if (!fileCreated) {
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "pty-continue-create-magazine-readme",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: continuationCreateCommand }) }
            }]
          };
        } else if (!fileVerified) {
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "pty-continue-verify-magazine-readme",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: continuationVerifyCommand }) }
            }]
          };
        } else {
          message = { role: "assistant", content: "Created and verified magazine/README.md." };
        }
      } else if (lastUserMessage === steeringInput) {
        message = { role: "assistant", content: "I'll create agents.md now." };
      } else if (String(lastUserMessage ?? "").includes("Harness completion check: the original code-change request")) {
        const editReturned = currentTurnToolResults.some((tool) => String(tool.content ?? "").includes(createAgentsCommand));
        const verificationReturned = currentTurnToolResults.some((tool) => String(tool.content ?? "").includes(verifyAgentsCommand));
        if (!editReturned) {
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "pty-create-agents-guide",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: createAgentsCommand }) }
            }]
          };
        } else if (!verificationReturned) {
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "pty-verify-agents-guide",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: verifyAgentsCommand }) }
            }]
          };
        } else {
          message = { role: "assistant", content: "Created agents.md and verified it is non-empty." };
        }
      } else if (lastUserMessage === cleanupRequest && currentTurnToolResults.length === 0) {
        message = { role: "assistant", content: "I'll inspect and remove Python-style directories if I find any." };
      } else if (String(lastUserMessage ?? "").includes("Harness completion check: the requested action")) {
        const verificationRequested = String(lastUserMessage).includes("successful verification command after the final change");
        if (verificationRequested && currentTurnToolResults.length === 0) {
          const verificationCommand = String(lastUserMessage).includes("Python-style directories")
            ? verifyPythonDirectoriesCommand
            : verifyLocalScaffoldCommand;
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: verificationCommand === verifyPythonDirectoriesCommand
                ? "pty-verify-python-directories"
                : "pty-verify-local-scaffold",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: verificationCommand }) }
            }]
          };
        } else if (!verificationRequested && currentTurnToolResults.length === 0) {
          message = {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "pty-remove-python-directory",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: removePythonDirectoryCommand }) }
            }]
          };
        } else if (verificationRequested) {
          message = { role: "assistant", content: "Removed Python-style cache directories and verified none remain." };
        } else {
          message = { role: "assistant", content: "Removed Python-style cache directories." };
        }
      } else if (lastUserMessage === "stderr diagnostics" && !hasStderrToolResult) {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "pty-bash-stderr-command",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: failingCommand }) }
          }]
        };
      } else if (hasStderrToolResult) {
        message = { role: "assistant", content: "Spark received the failing Bash command's stderr and exit code 7." };
      } else if (lastUserMessage === approvalRequest && currentTurnToolResults.length === 0) {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "pty-bash-approval-command",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: approvalCommand }) }
          }]
        };
      } else if (lastUserMessage === approvalRequest && currentTurnToolResults.length > 0) {
        message = { role: "assistant", content: "Saddle command turn finished." };
      } else if (hasToolResult) {
        message = { role: "assistant", content: "Spark first turn passed after the Bash command returned its output." };
      } else {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "pty-bash-command",
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: `printf '${bashMarker}\\n'` })
            }
          }]
        };
      }
      res.end(JSON.stringify({ status: "success", result: { message } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await fs.mkdir(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: projectRoot });
  execFileSync("git", ["-c", "user.name=PTY Test", "-c", "user.email=pty@example.invalid", "commit", "--allow-empty", "-m", "initial"], { cwd: projectRoot });
  await fs.mkdir(cleanupDirectory, { recursive: true });
  await new Promise((resolve) => housekeeper.listen(0, "127.0.0.1", resolve));
  const address = housekeeper.address();
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    PYA_SADDLE_CWD: projectRoot,
    PYA_SADDLE_SESSION_NAME: sessionName,
    PYA_SADDLE_MIND: "mind",
    PYA_SADDLE_MODEL: firstModel,
    PYA_SADDLE_HOST: "http://127.0.0.1:1",
    PYA_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${address.port}`,
    PYA_GPU_MANAGER_REQUIRED: "true",
    PYA_GPU_MANAGER_POLL_MS: "1",
    PYA_GPU_MANAGER_TIMEOUT_MS: "90000",
    PYA_OLLAMA_USAGE_DIR: usageDir,
    PYA_WORLD_ROOT: path.join(tempRoot, "gpu-world"),
    PYA_COMMAND_DEBUG: "true",
    PYA_NEWSPAPER: "false",
    PYA_NEWSPAPER_MIND_AUTO: "false"
  };
  for (const key of ["PYA_MIND_RESPONSE", "PYA_COMMAND_RESPONSE", "PYA_HEAR_FIXTURE", "PYA_PIPER_FIXTURE"]) {
    delete env[key];
  }
  const baseIdentityDir = path.join(projectWorldRoot, "house", "base", "identity");
  await fs.mkdir(baseIdentityDir, { recursive: true });
  await fs.copyFile(
    path.join(runtimeRoot, "world", "house", "base", "identity", "TOOLS.md"),
    path.join(baseIdentityDir, "TOOLS.md")
  );

  let transcript = "";
  let child = null;
  let childExit = null;
  let resolveChildExit;
  const exited = new Promise((resolve) => { resolveChildExit = resolve; });
  try {
    child = pty.spawn(process.execPath, [path.join(runtimeRoot, "command", "pyash.mjs"), "saddle"], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: projectRoot,
      env
    });
    child.onData((data) => { transcript += data; });
    child.onExit((event) => {
      childExit = event;
      resolveChildExit(event);
    });

    const restoredMarker = `session: ${sessionName} | restored 0 saved messages`;
    await waitForOutputAfter(() => transcript, restoredMarker, "pyash>", { timeoutMs: 90000 });
    child.write("first model check\r");
    await waitForOutputAfter(() => transcript, "Qwen first model turn passed.", "pyash>");

    child.write(`/model ${secondModel}\r`);
    const selectionMarker = `saved model selection for session: ${sessionName}`;
    await waitForOutputAfter(() => transcript, selectionMarker, "pyash>");
    child.write("hi\r");
    await waitForOutputAfter(() => transcript, "Spark first turn passed after the Bash command returned its output.", "pyash>");
    child.write("stderr diagnostics\r");
    await waitForOutputAfter(() => transcript, "exit code 7.", "pyash>");
    child.write(`${cleanupRequest}\r`);
    await waitForOutputAfter(() => transcript, "Removed Python-style cache directories and verified none remain.", "pyash>");
    child.write(`${approvalRequest}\r`);
    await waitForOutputAfter(() => transcript, "Saddle command turn finished.", "pyash>");
    child.write(`${continuationContext}\r`);
    await waitForOutputAfter(() => transcript, continuationOffer, "pyash>");
    child.write("continue\r");
    await waitForOutputAfter(() => transcript, "Created and verified magazine/README.md.", "pyash>");
    assert.equal(await fs.readFile(path.join(projectRoot, "magazine", "README.md"), "utf8"), "# Robot Science Fiction Magazine\n\nA home for speculative stories about robots and the futures they shape.\n");
    child.write(`\u001b[200~${steeringInput}\u001b[201~\r`);
    await waitForOutput(() => transcript, "[saddle evidence] changed: bash; validation: test -s agents.md; exit: 0");
    assert.equal(await fs.readFile(path.join(projectRoot, "agents.md"), "utf8"), "# Robot Science Fiction Magazine\n\nProject guidance.\n");
    const cleanupTranscript = stripTerminalControlSequences(transcript);
    await assert.rejects(fs.access(cleanupDirectory), cleanupTranscript.slice(-10000));
    await assert.rejects(fs.access(path.join(projectRoot, "magaiize")), cleanupTranscript.slice(-10000));

    const cleanTranscript = stripTerminalControlSequences(transcript);
    assert.match(cleanTranscript, new RegExp(`model: ${secondModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(cleanTranscript, /command defective: status=1|mind_ollama_runner: missing request payload|EPIPE/u);
    assert.ok(submissions.some((payload) => payload.model === firstModel), "the initial Ollama model must reach Housekeeper");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.content === "hi")),
      "the newly selected Ollama model must receive the first user turn");
    const secondModelSubmissions = submissions.filter((payload) => payload.model === secondModel);
    assert.ok(secondModelSubmissions.length > 0);
    assert.deepEqual(secondModelSubmissions[0].tools.map((tool) => tool.function?.name), ["bash"],
      "the selected model must receive exactly one Bash tool");
    const secondModelContext = secondModelSubmissions[0].messages.map((message) => String(message?.content ?? "")).join("\n");
    assert.match(secondModelContext, /Bash-only Saddle/u, "the agent-home tool guide must reach the model context");
    assert.match(secondModelContext, /pyash run --gross --no-newspaper/u,
      "the model context must include the documented Pyash web-search workflow");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(bashMarker))),
    "the real command runner output must be returned to the selected model");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(continuationCreateCommand)
      && String(message.content).includes("exit code: 0"))),
    "a bare continue must carry the prior offer into Bash and create the magazine README");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(continuationVerifyCommand)
      && String(message.content).includes("exit code: 0"))),
    "the continued code task must be verified after the file is created");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "user"
      && String(message.content).includes("Harness completion check: the original code-change request")
      && String(message.content).includes("Previous assistant response")
      && String(message.content).includes("Original request: The user is continuing"))),
    "the harness must retain the previous offer and require the actual resumed action");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(stderrMarker)
      && /status=7/u.test(String(message.content)))),
    "the failed command's exit status and stderr must reach the model after the real process exits");
    assert.match(cleanTranscript, /\[tool call\] bash: printf 'SADDLE_BASH_PTY_OK/u,
      "PTY transcript must identify the command behind a Bash tool call");
    assert.match(cleanTranscript, new RegExp(`\\[tool result\\] bash[\\s\\S]*exit code: 7[\\s\\S]*stderr: ${stderrMarker}`),
      "PTY result preview must include the exit status and captured stderr");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.options?.num_ctx === 131072),
      "the selected model must retry at the first supported context preset that fits the provider error");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(removePythonDirectoryCommand))),
    "a promised repository action must continue into a real Bash deletion command");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(verifyPythonDirectoriesCommand))),
    "the action continuation must run a verification command after deletion");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(approvalCommand)
      && String(message.content).includes("exit code: 0"))),
    "the model must receive the successful destructive command result without an approval round trip");
    assert.doesNotMatch(cleanTranscript, /approval_required|approve command \(destructive\): rm -rf \.\/magaiize/u,
      "a project-local destructive command must not produce an approval request");
    assert.match(cleanTranscript, /\[tool call\] bash: rm -rf \.\/magaiize[\s\S]*\[tool result\] bash[\s\S]*exit code: 0/u,
      "PTY output must show the executed project-local command and its successful exit");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(verifyLocalScaffoldCommand))),
    "the action continuation must verify the project-local directory was removed");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(createAgentsCommand)
      && String(message.content).includes("exit code: 0"))),
    "the accepted interrupted proposal must reach Bash and create the requested guidance file");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(verifyAgentsCommand)
      && String(message.content).includes("exit code: 0"))),
    "the PTY agent must verify the created guidance file before it reports completion");
    assert.match(cleanTranscript, /completion check missing a successful tool call that performs or checks the requested action/u);
    assert.match(cleanTranscript, /completion check missing a successful verification command after the final change/u);
    assert.match(cleanTranscript, /\[saddle evidence\] action complete/u);
    assert.match(cleanTranscript, /\[saddle evidence\] changed: bash; validation: test -s agents\.md; exit: 0/u,
      "an accepted interrupted code proposal must be edited and verified before completion");
    const commandDebugLines = cleanTranscript.match(/\[command debug\] \{[^\r\n]*\}/gu) ?? [];
    assert.ok(commandDebugLines.length >= 1, "PTY transcript should include a debug record for the Bash command");
    const commandDebug = commandDebugLines.map((line) => JSON.parse(line.slice("[command debug] ".length)));
    assert.ok(commandDebug.some((record) => record.cmd.includes(bashMarker) && record.status === 0
      && record.internalMindRunner === false), "Bash scenario must finish successfully through the command runner");
    assert.ok(commandDebug.some((record) => record.cmd === failingCommand && record.status === 7
      && record.stderr.includes(stderrMarker)), "failing Bash scenario must preserve stderr and the nonzero status");
    assert.equal(childExit, null, "the saddle should remain open after both model turns");
  } finally {
    if (child && !childExit) {
      child.write("\u0004");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (!childExit) child.kill();
    }
    await new Promise((resolve) => housekeeper.close(resolve));
    await fs.rm(projectWorldRoot, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
