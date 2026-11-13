import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parse } from "../program/understand/index.mjs";
import { resolveChildAgentTarget, commandSession as terminal } from "../program/verbs/command_session.mjs";
import { requestManagedTerminal } from "../program/agent/managed_terminal_ipc.mjs";

async function withProject(run) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-terminal-verb-"));
  const project = path.join(temporary, "project");
  const world = path.join(temporary, "world");
  await fs.mkdir(project);
  await fs.mkdir(world);
  try {
    await run({ temporary, project, world });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function rememberFor({ project, world, runtimeRoot, minds = {}, delegation = {}, commandMode = null }) {
  const facts = new Map([
    ["world root", { ob: { filename: world } }],
    ["agent sandbox", { ob: { boolean: true } }],
    ["agent cwd", { ob: { filename: project } }],
    ["sandbox configure", { ob: { map: {
      cwd: { filename: project },
      "writable roots": { ve: { values: [project] } },
      "command env allowlist": { ve: { values: ["PATH", "HOME", "TERM"] } }
    } } }],
    ["agent delegation configure", { ob: { map: delegation } }],
    ["ollama host", { ob: { text: "http://ollama.test" } }]
  ]);
  if (runtimeRoot) facts.set("run root", { ob: { filename: runtimeRoot } });
  if (commandMode) facts.set("command configure", { ob: { map: {
    "policy mode": { ob: { wo: commandMode } },
    "classifier enabled": { ob: { bool: true } }
  } } });
  for (const [name, profile] of Object.entries(minds)) facts.set(name, profile);
  return (name) => facts.get(name) ?? null;
}

function terminalSentence(action, request = {}) {
  return parse(`su name command session be command session as wo ${action} ob text ${JSON.stringify(JSON.stringify(request))} do`);
}

test("terminal launch is restricted to the licensed project working directory", async () => {
  await withProject(async ({ project, temporary, world }) => {
    const runtimeRoot = path.join(temporary, "pyash-runtime");
    const remember = rememberFor({ project, world, runtimeRoot });
    const calls = [];
    const requestTerminal = async (...args) => {
      calls.push(args);
      return { id: "terminal-1", status: "running" };
    };
    const started = await terminal(terminalSentence("start", {
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready')"]
    }), { remember, requestTerminal, runtimeContext: { agentName: "mind", backend: "ollama" } });
    assert.equal(JSON.parse(started.ob.text).id, "terminal-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], project, "terminal manager scope must follow the agent project, not Pyash runtime");

    await assert.rejects(() => terminal(terminalSentence("start", {
      command: process.execPath,
      args: [],
      cwd: temporary
    }), { remember, requestTerminal, runtimeContext: { agentName: "mind", backend: "ollama" } }), /outside the agent's active project root/u);
    assert.equal(calls.length, 1);
  });
});

test("terminal hard-denies internal mind runners even when command mode allows", async () => {
  await withProject(async ({ project, world }) => {
    const remember = rememberFor({ project, world, commandMode: "allow" });
    await assert.rejects(() => terminal(terminalSentence("start", {
      command: "node",
      args: ["../pyac/pyash-dev/command/mind_ollama_runner.mjs"],
      cwd: project
    }), { remember }), /internal Pyash mind runner/u);
  });
});

test("terminal starts a real PTY in the project when the Pyash runtime is elsewhere", async () => {
  await withProject(async ({ project, temporary, world }) => {
    const runtimeRoot = path.join(temporary, "pyash-runtime");
    const remember = rememberFor({ project, world, runtimeRoot });
    let started;
    try {
      const result = await terminal(terminalSentence("start", {
        command: process.execPath,
        args: ["-e", "process.stdout.write('PROJECT_TERMINAL_ROOT_OK\\n')"],
        cwd: project
      }), { remember, runtimeContext: { agentName: "mind", backend: "ollama" } });
      started = JSON.parse(result.ob.text);

      let read;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await terminal(terminalSentence("read", {
          id: started.id,
          after: 0,
          maxBytes: 4096
        }), { remember, runtimeContext: { agentName: "mind", backend: "ollama" } });
        read = JSON.parse(response.ob.text);
        if (read.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.equal(read.status, "exited");
      assert.equal(read.exitCode, 0);
      assert.match(read.output, /PROJECT_TERMINAL_ROOT_OK/u);
    } finally {
      await requestManagedTerminal(world, project, { action: "shutdown" }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
});

test("child coding agents obey parent backend and model allowlists and receive a separate session", async () => {
  await withProject(async ({ project, temporary, world }) => {
    const minds = {
      mind: {
        mood: "ya", be: "mind", su: { name: "mind" },
        as: { text: "qwen3.5:9b" }, fromstate: { text: "ollama" }
      },
      zai: {
        mood: "ya", be: "mind", su: { name: "zai" },
        as: { text: "glm-5.3-flash" }, fromstate: { text: "zai" },
        from: { text: "https://api.z.ai/api/coding/paas/v4" }
      }
    };
    const delegation = {
      "zai allowed backends": { ve: { values: ["ollama"] } },
      "zai allowed models": { ve: { values: ["qwen3.5:9b"] } }
    };
    const remember = rememberFor({ project, world, runtimeRoot: path.join(temporary, "pyash-runtime"), minds, delegation });
    const requests = [];
    const managerRoots = [];
    const requestTerminal = async (_world, root, request) => {
      managerRoots.push(root);
      requests.push(request);
      if (request.action === "start") return { id: "child-terminal", status: "running" };
      if (request.action === "read") return { id: request.id, status: "running", cursor: 5, output: "session: child\npyash> " };
      if (request.action === "write") return { id: request.id, status: "running" };
      throw new Error(`unexpected terminal action: ${request.action}`);
    };
    const started = await terminal(terminalSentence("start coding agent", {
      mind: "mind",
      cwd: project,
      instruction: "Inspect the parser and report findings."
    }), {
      remember,
      requestTerminal,
      runtimeContext: { agentName: "zai", backend: "zai", host: "https://api.z.ai/api/coding/paas/v4" },
      sleepFn: async () => {}
    });
    const result = JSON.parse(started.ob.text);
    assert.equal(result.mind, "mind");
    assert.equal(result.backend, "ollama");
    assert.equal(result.model, "qwen3.5:9b");
    assert.match(result.sessionName, /^child-/u);
    assert.equal(result.instructionState, "sent");
    assert.equal(requests[0].env.PYA_SADDLE_SESSION_NAME, result.sessionName);
    assert.equal(requests[0].env.PYA_SADDLE_MODEL, "qwen3.5:9b");
    assert.ok(managerRoots.every((root) => root === project), "child terminal lifecycle must use one project-scoped manager");
    assert.equal(requests.at(-1).input, "Inspect the parser and report findings.\r");

    await assert.rejects(() => terminal(terminalSentence("start coding agent", { mind: "zai" }), {
      remember,
      requestTerminal,
      runtimeContext: { agentName: "zai", backend: "zai" }
    }), /child backend zai is not allowed/u);
    await assert.rejects(() => terminal(terminalSentence("start coding agent", {
      mind: "mind", model: "qwen3.5:27b"
    }), {
      remember,
      requestTerminal,
      runtimeContext: { agentName: "zai", backend: "zai" }
    }), /model allowlist/u);
    assert.equal(requests.length, 3);
  });
});

test("child model policy defaults to the configured parent backend allowlist", () => {
  assert.throws(() => resolveChildAgentTarget({
    parentBackend: "zai",
    childMind: "zai",
    profile: { be: "mind", su: { name: "zai" }, fromstate: { text: "zai" }, as: { text: "glm-5.3-flash" } },
    allowedBackends: ["ollama"]
  }), /child backend zai is not allowed/u);
});
