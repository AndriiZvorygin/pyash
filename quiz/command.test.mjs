import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { command } from "../program/verbs/command.mjs";
import { runWithMindInterruptSignal } from "../program/agent/interrupt.mjs";
import { startStreamTail } from "../program/verbs/mind/stream.mjs";

function assertCommandSucceeded(result) {
  assert.equal(result?.be, "command");
  assert.equal(typeof result?.ob?.text, "string");
}

async function makeTempRunRoot() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-run-root-"));
  const commandDir = path.join(tempRoot, "command");
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(
    path.join(commandDir, "probe.mjs"),
    'console.log("probe-ok");\n',
    "utf8"
  );
  return tempRoot;
}

test("command executes quoted command text and returns stdout", async () => {
  process.env.PYA_COMMAND_RESPONSE = "hi";
  const sentence = parse(
    "ob wo quoted.command.printf hi.command.quoted be command do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.ob?.text ?? result?.value?.text, "hi");
  delete process.env.PYA_COMMAND_RESPONSE;
});

test("command direct node uses process exec path when PATH is empty", async () => {
  const priorPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const sentence = parse(
      "ob wo quoted.command.node -p 6*7.command.quoted be command do"
    );
    const result = await command(sentence, { remember: () => null });
    assertCommandSucceeded(result);
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  }
});

test("command subprocess is terminated by the active saddle interrupt signal", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const commandPromise = runWithMindInterruptSignal({ signal: controller.signal }, () => command({
    mood: "do",
    be: "command",
    ob: { text: "sleep 1" }
  }, { remember: () => null }));

  setTimeout(() => controller.abort("test interrupt"), 50);
  await assert.rejects(commandPromise, /command defective/u);
  assert.ok(Date.now() - startedAt < 700, "the command runner should stop before its natural exit");
});

test("streaming command closes its stream when the active saddle interrupt signal fires", async () => {
  const controller = new AbortController();
  const streamName = `interrupt-stream-${process.pid}-${Date.now()}`;
  const result = await runWithMindInterruptSignal({ signal: controller.signal }, () => command({
    mood: "do",
    be: "command",
    su: { name: streamName },
    ob: { text: "sleep 1" },
    vyah: { ve: { type: "name", values: ["stream"] } }
  }, { remember: () => null }));
  const streamPath = result?.ob?.filename;
  assert.ok(streamPath);

  try {
    controller.abort("test stream interrupt");
    const deadline = Date.now() + 600;
    let content = "";
    while (Date.now() < deadline) {
      content = await fs.readFile(streamPath, "utf8").catch(() => "");
      if (content.includes("[PYA_STREAM_END]")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(content, /\[PYA_STREAM_END\]/u);
  } finally {
    await fs.rm(streamPath, { force: true });
  }
});

test("streaming command persists process diagnostics for a failed child", async () => {
  const streamName = `failed-stream-${process.pid}-${Date.now()}`;
  const result = await command({
    mood: "do",
    be: "command",
    su: { name: streamName },
    ob: { text: "node -e \"process.stderr.write('provider-error-marker'); process.exit(7)\"" },
    vyah: { ve: { type: "name", values: ["stream"] } }
  }, { remember: () => null });
  const streamPath = result?.ob?.filename;
  const processPath = streamPath.replace(/\.stream\.txt$/u, ".process.txt");

  try {
    const processReport = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("stream did not close")), 3000);
      const stop = startStreamTail({
        filename: streamPath,
        onLine: () => {},
        onEnd: (report) => {
          clearTimeout(timeout);
          stop();
          resolve(report);
        },
        onError: (error) => {
          clearTimeout(timeout);
          stop();
          reject(error);
        }
      });
    });

    assert.match(processReport, /status: 7/u);
    assert.match(processReport, /signal: none/u);
    assert.match(processReport, /stdout bytes: 0/u);
    assert.match(processReport, /provider-error-marker/u);
    assert.equal(await fs.readFile(processPath, "utf8"), processReport);
  } finally {
    await fs.rm(streamPath, { force: true });
    await fs.rm(processPath, { force: true });
  }
});

test("command rewrites node command/* to run-root relative path from agent cwd", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-agent-"));
  const agentCwd = path.join(tempRoot, "world", "house", "tester");
  await fs.mkdir(agentCwd, { recursive: true });
  const rememberFn = (name) => {
    if (name === "agent sandbox") return { ob: { boolean: true } };
    if (name === "agent cwd") return { ob: { filename: agentCwd } };
    if (name === "run root") return { ob: { filename: process.cwd() } };
    if (name === "world root") return { ob: { filename: path.join(tempRoot, "world") } };
    if (name === "agent name") return { ob: { text: "tester" } };
    return null;
  };
  try {
    const sentence = parse("ob wo quoted.command.node command/pyash.mjs --help.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("command rewrites node command/* using world root when run root is missing", async () => {
  const tempRoot = await makeTempRunRoot();
  const agentCwd = path.join(tempRoot, "sandpit");
  await fs.mkdir(agentCwd, { recursive: true });
  try {
    const rememberFn = (name) => {
      if (name === "agent sandbox") return { ob: { boolean: true } };
      if (name === "agent cwd") return { ob: { filename: agentCwd } };
      if (name === "world root") return { ob: { filename: path.join(tempRoot, "world") } };
      return null;
    };
    const sentence = parse("ob wo quoted.command.node command/probe.mjs.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("command rewrites node command/* by discovering run root from agent cwd", async () => {
  const tempRoot = await makeTempRunRoot();
  const agentCwd = path.join(tempRoot, "world", "house", "pyash-agent");
  await fs.mkdir(agentCwd, { recursive: true });
  try {
    const rememberFn = (name) => {
      if (name === "agent sandbox") return { ob: { boolean: true } };
      if (name === "agent cwd") return { ob: { filename: agentCwd } };
      return null;
    };
    const sentence = parse("ob wo quoted.command.node command/probe.mjs.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("command prefers fromtext input when sentence has from la provenance", async () => {
  const sentence = {
    mood: "do",
    be: "command",
    ob: { text: "cat" },
    from: { la: { be: "mind" } },
    fromtext: { text: "hello from fromtext" }
  };
  const result = await command(sentence, { remember: () => null });
  assertCommandSucceeded(result);
  assert.equal(String(result?.ob?.text ?? "").trim(), "hello from fromtext");
});

test("command fromtext resolves genitive before stray text tail", async () => {
  const rememberFn = (name) => {
    if (name === "payload") {
      return { be: "text", ob: { text: "hello from payload" } };
    }
    return null;
  };
  const sentence = {
    mood: "do",
    be: "command",
    ob: { text: "cat" },
    fromtext: {
      genitive: { chain: ["payload", "ob", "text"] },
      text: "}"
    }
  };
  const result = await command(sentence, { remember: rememberFn });
  assertCommandSucceeded(result);
  assert.equal(String(result?.ob?.text ?? "").trim(), "hello from payload");
});

test("command timeout surfaces as command defective instead of empty success", async () => {
  const rememberFn = (name) => {
    if (name !== "sandbox configure") return null;
    return {
      ob: {
        map: {
          "timeout ms": { ob: { num: 10 } },
          cwd: { ob: { filename: process.cwd() } },
          "writable roots": { ob: { ve: { type: "filename", values: [process.cwd(), "/tmp"] } } },
          "command env allowlist": { ob: { ve: { type: "text", values: ["PATH", "HOME", "PWD", "SHELL"] } } }
        }
      }
    };
  };
  const sentence = parse("ob text \"sleep 1\" be command do");
  await assert.rejects(
    () => command(sentence, { remember: rememberFn }),
    /command defective: status=unknown signal=SIGKILL[\s\S]*timed out: true[\s\S]*timeout after 10ms/u
  );
});

test("command failure exposes command, working directory, and both output streams", async () => {
  const cmd = "node -e \"process.stdout.write('stdout-marker\\n'); process.stderr.write('stderr-marker\\n'); process.exit(7)\"";
  await assert.rejects(
    () => command({ mood: "do", be: "command", ob: { text: cmd } }, { remember: () => null }),
    (error) => {
      assert.match(error.message, /command defective: status=7 signal=/u);
      assert.ok(error.message.includes(`command: ${cmd}`));
      assert.ok(error.message.includes(`working directory: ${process.cwd()}`));
      assert.match(error.message, /stdout:\nstdout-marker/u);
      assert.match(error.message, /stderr:\nstderr-marker/u);
      assert.equal(error.sentence.ob.raw.status, 7);
      assert.equal(error.sentence.ob.raw.stdout, "stdout-marker\n");
      assert.equal(error.sentence.ob.raw.stderr, "stderr-marker\n");
      return true;
    }
  );
});

test("command failure says explicitly when stdout and stderr are empty", async () => {
  const cmd = "node -e \"process.exit(3)\"";
  await assert.rejects(
    () => command({ mood: "do", be: "command", ob: { text: cmd } }, { remember: () => null }),
    (error) => {
      assert.match(error.message, /status=3/u);
      assert.match(error.message, /stdout:\n<empty>/u);
      assert.match(error.message, /stderr:\n<empty>/u);
      return true;
    }
  );
});

test("command failure bounds long output while retaining its beginning and tail", async () => {
  const cmd = `node -e "process.stdout.write('START' + 'x'.repeat(6000) + 'END'); process.exit(4)"`;
  await assert.rejects(
    () => command({ mood: "do", be: "command", ob: { text: cmd } }, { remember: () => null }),
    (error) => {
      assert.match(error.message, /START/u);
      assert.match(error.message, /characters omitted; showing output tail/u);
      assert.match(error.message, /END/u);
      assert.ok(error.message.length < 6000, `diagnostic should be bounded, got ${error.message.length} chars`);
      return true;
    }
  );
});

test("command mirrors stderr live during verbose runs", async () => {
  const priorVerbose = process.env.PYA_RUN_VERBOSE;
  const originalWrite = process.stderr.write;
  let mirrored = "";
  process.env.PYA_RUN_VERBOSE = "1";
  process.stderr.write = (chunk, encoding, callback) => {
    mirrored += String(chunk ?? "");
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const sentence = parse("ob text \"node -e \\\"process.stderr.write('live stderr\\\\n')\\\"\" be command do");
    const result = await command(sentence, { remember: () => null });
    assertCommandSucceeded(result);
    assert.match(mirrored, /live stderr/u);
  } finally {
    process.stderr.write = originalWrite;
    if (priorVerbose === undefined) delete process.env.PYA_RUN_VERBOSE;
    else process.env.PYA_RUN_VERBOSE = priorVerbose;
  }
});

test("command honors inline timeout override", async () => {
  const priorInline = process.env.PYA_COMMAND_INLINE_TIMEOUTS;
  const rememberFn = (name) => {
    if (name !== "sandbox configure") return null;
    return {
      ob: {
        map: {
          "timeout ms": { ob: { num: 10 } },
          cwd: { ob: { filename: process.cwd() } },
          "writable roots": { ob: { ve: { type: "filename", values: [process.cwd(), "/tmp"] } } },
          "command env allowlist": { ob: { ve: { type: "text", values: ["PATH", "HOME", "PWD", "SHELL"] } } }
        }
      }
    };
  };
  process.env.PYA_COMMAND_INLINE_TIMEOUTS = "1";
  try {
    const sentence = parse("ob text \"PYA_COMMAND_TIMEOUT_MS=1000 sleep 0.05\" be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    if (priorInline === undefined) delete process.env.PYA_COMMAND_INLINE_TIMEOUTS;
    else process.env.PYA_COMMAND_INLINE_TIMEOUTS = priorInline;
  }
});
