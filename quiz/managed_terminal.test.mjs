import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManagedTerminalManager, spawnNodePty } from "../program/agent/managed_terminal.mjs";
import { managedTerminalSocketPath, requestManagedTerminal } from "../program/agent/managed_terminal_ipc.mjs";

const execFileAsync = promisify(execFile);

test("managed terminal runtime identity scopes the manager to one project root", () => {
  assert.notEqual(
    managedTerminalSocketPath("/world", { projectRoot: "/project-a", uid: "user" }),
    managedTerminalSocketPath("/world", { projectRoot: "/project-b", uid: "user" })
  );
});

function fakePty() {
  const handlers = { data: null, exit: null };
  const writes = [];
  const sizes = [];
  const pty = {
    writes,
    sizes,
    onData(handler) { handlers.data = handler; return { dispose() {} }; },
    onExit(handler) { handlers.exit = handler; return { dispose() {} }; },
    write(value) { writes.push(value); },
    resize(columns, rows) { sizes.push([columns, rows]); },
    kill(signal) { handlers.exit?.({ exitCode: 0, signal }); }
  };
  return {
    pty,
    emitData(value) { handlers.data?.(value); },
    emitExit(value = { exitCode: 0, signal: undefined }) { handlers.exit?.(value); }
  };
}

test("managed terminal starts an authorized process and forwards opaque input and output", async () => {
  const fake = fakePty();
  const launches = [];
  const events = [];
  const manager = createManagedTerminalManager({
    spawnPty: async (command, args, options) => {
      launches.push({ command, args, options });
      return fake.pty;
    },
    authorizeLaunch: async (request) => request.cwd === "/project",
    persistEvent: async (event) => events.push(event),
    idFactory: () => "terminal-one"
  });

  const started = await manager.start({
    command: "apt-get",
    args: ["install", "ripgrep"],
    cwd: "/project",
    columns: 100,
    rows: 40
  });
  assert.equal(started.id, "terminal-one");
  assert.equal(started.status, "running");
  assert.deepEqual(launches[0], {
    command: "apt-get",
    args: ["install", "ripgrep"],
    options: { cwd: "/project", cols: 100, rows: 40, env: undefined }
  });

  const input = "y\t\r";
  await manager.write({ id: started.id, input });
  assert.deepEqual(fake.pty.writes, [input]);

  fake.emitData("Reading package lists...\r\n");
  const read = await manager.read({ id: started.id, after: 0 });
  assert.equal(read.output, "Reading package lists...\r\n");
  assert.equal(read.cursor, 1);
  assert.equal(read.status, "running");

  await manager.resize({ id: started.id, columns: 120, rows: 50 });
  assert.deepEqual(fake.pty.sizes, [[120, 50]]);
  assert.deepEqual(events.map((event) => event.type), ["started", "input", "output", "resized"]);
});

test("managed terminal rejects launches outside the authorized project", async () => {
  let spawned = false;
  const manager = createManagedTerminalManager({
    spawnPty: async () => { spawned = true; return fakePty().pty; },
    authorizeLaunch: async () => false
  });

  await assert.rejects(() => manager.start({
    command: "apt-get",
    args: ["install", "ripgrep"],
    cwd: "/outside"
  }), /terminal command denied/u);
  assert.equal(spawned, false);
});

test("managed terminal reports exit and rejects writes after process completion", async () => {
  const fake = fakePty();
  const manager = createManagedTerminalManager({
    spawnPty: async () => fake.pty,
    authorizeLaunch: async () => true,
    idFactory: () => "terminal-exit"
  });
  const started = await manager.start({ command: "true", cwd: "/project" });
  fake.emitExit({ exitCode: 7, signal: undefined });

  assert.equal((await manager.status({ id: started.id })).exitCode, 7);
  await assert.rejects(() => manager.write({ id: started.id, input: "ignored" }), /terminal is not running/u);
});

test("managed terminal bounds persisted event data and reports when evidence is truncated", async () => {
  const fake = fakePty();
  const events = [];
  const manager = createManagedTerminalManager({
    spawnPty: async () => fake.pty,
    authorizeLaunch: async () => true,
    persistEvent: async (event) => events.push(event),
    idFactory: () => "terminal-bounded",
    maxPersistedBytes: 512
  });
  const started = await manager.start({ command: "test", cwd: "/project" });
  fake.emitData("x".repeat(4096));
  const status = await manager.status({ id: started.id });
  assert.equal(status.persistenceTruncated, true);
  assert.equal(events.filter((event) => event.type === "persistence-limit").length, 1);
});

test("managed terminal reserves an active slot before awaiting PTY startup", async () => {
  const fake = fakePty();
  let allowStart;
  const gate = new Promise((resolve) => { allowStart = resolve; });
  const manager = createManagedTerminalManager({
    spawnPty: async () => {
      await gate;
      return fake.pty;
    },
    authorizeLaunch: async () => true,
    maxActiveSessions: 1
  });
  const first = manager.start({ command: "first", cwd: "/project" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => manager.start({ command: "second", cwd: "/project" }),
    /active-session limit reached/u
  );
  allowStart();
  assert.equal((await first).status, "running");
});

test("Node PTY adapter provides a real terminal and accepts input after the saddle client is gone", async () => {
  const manager = createManagedTerminalManager({
    spawnPty: spawnNodePty,
    authorizeLaunch: async ({ cwd }) => cwd === process.cwd(),
    maxOutputBytes: 8192
  });
  const source = "process.stdin.once('data', data => { process.stdout.write(JSON.stringify({ tty: process.stdin.isTTY, input: data.toString(), mind: process.env.PYA_SADDLE_MIND, leaked: Object.hasOwn(process.env, 'PYASH_TERMINAL_TEST_SECRET') })); process.exit(0); });";
  const started = await manager.start({
    command: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      PYA_SADDLE_MIND: "child-mind",
      PYASH_TERMINAL_TEST_SECRET: "must-not-be-inherited"
    }
  });
  await manager.write({ id: started.id, input: "answer\t\r" });

  let result = null;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    result = await manager.read({ id: started.id, after: 0 });
    if (result.output.includes("\"tty\":true")) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(result.output, /"tty":true/u);
  assert.match(result.output, /"input":"answer\\t\\n"/u);
  assert.match(result.output, /"mind":"child-mind","leaked":false/u);
  let status = await manager.status({ id: started.id });
  while (status.status === "running" && Date.now() < deadline + 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = await manager.status({ id: started.id });
  }
  assert.equal(status.status, "exited");
});

test("managed terminal daemon persists a real PTY transcript and stops cleanly", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-terminal-ipc-"));
  const projectRoot = path.join(temporary, "project");
  const worldRoot = path.join(temporary, "world");
  await Promise.all([
    fs.mkdir(projectRoot, { recursive: true }),
    fs.mkdir(worldRoot, { recursive: true })
  ]);
  const socketPath = managedTerminalSocketPath(worldRoot, { projectRoot });
  let daemonStarted = false;
  try {
    await requestManagedTerminal(worldRoot, projectRoot, { action: "list" });
    daemonStarted = true;
    const source = "process.stdout.write('ready\\n'); process.stdin.once('data', data => { process.stdout.write('received:' + data.toString()); process.exit(0); });";
    const terminal = await requestManagedTerminal(worldRoot, projectRoot, {
      action: "start",
      command: process.execPath,
      args: ["-e", source],
      cwd: projectRoot
    });
    let view;
    const readyDeadline = Date.now() + 5000;
    do {
      view = await requestManagedTerminal(worldRoot, projectRoot, {
        action: "read", id: terminal.id, after: 0, maxBytes: 4096
      });
      if (view.output.includes("ready")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < readyDeadline);
    assert.match(view.output, /ready/u);
    await requestManagedTerminal(worldRoot, projectRoot, {
      action: "write", id: terminal.id, input: "opaque\tinput\r"
    });
    const outputDeadline = Date.now() + 5000;
    do {
      view = await requestManagedTerminal(worldRoot, projectRoot, {
        action: "read", id: terminal.id, after: view.cursor, maxBytes: 4096
      });
      if (view.output.includes("received:")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < outputDeadline);
    assert.match(view.output, /received:opaque\tinput/u);

    const evidencePath = path.join(worldRoot, "house", "coding saddle", "terminal", `${terminal.id}.pya`);
    const { stdout } = await execFileAsync(process.execPath, ["command/pya_to_json.mjs", evidencePath, "--pretty"], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const evidence = JSON.parse(stdout);
    const serialized = JSON.stringify(evidence);
    assert.match(serialized, /terminal event 1/u);
    assert.match(serialized, /input sha256/u);
    assert.match(serialized, /outputSha256/u);
  } finally {
    if (daemonStarted) {
      await requestManagedTerminal(worldRoot, projectRoot, { action: "shutdown" }).catch(() => {});
    }
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.rm(path.dirname(socketPath), { recursive: true, force: true });
  }
});
