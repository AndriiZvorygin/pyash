import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { command, classifyCommandText, resolveCommandPolicy } from "../program/verbs/command.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";

test("command classifier assigns stable classes", () => {
  assert.equal(classifyCommandText("cat README.md"), "read_only");
  assert.equal(classifyCommandText("echo hi > out.txt"), "write_local");
  assert.equal(classifyCommandText("curl -s https://example.com"), "network");
  assert.equal(classifyCommandText("kill -9 123"), "process_control");
  assert.equal(classifyCommandText("rm -rf /tmp/demo"), "destructive");
  assert.equal(classifyCommandText(""), "unknown");
});

test("command policy resolver reads command configure map", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo deny ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const denied = resolveCommandPolicy({
    sentence: { mood: "do" },
    cmdClass: "read_only"
  });
  assert.equal(denied.mode, "deny");
  assert.equal(denied.class, "read_only");

  const canSentence = resolveCommandPolicy({
    sentence: { mood: "can" },
    cmdClass: "read_only"
  });
  assert.equal(canSentence.mode, "deny", "can should not bypass deny policy");

  const proposeSentence = resolveCommandPolicy({
    sentence: { mood: "propose" },
    cmdClass: "read_only"
  });
  assert.equal(proposeSentence.mode, "ask");
});

test("command policy resolver prefers session map over global map", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo deny ya"));
  await interpret(parse("prah"));
  await interpret(parse("su name session command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("prah"));

  const resolved = resolveCommandPolicy({
    sentence: { mood: "do" },
    cmdClass: "destructive"
  });
  assert.equal(resolved.mode, "allow");
  assert.equal(resolved.source, "session command configure");
});

test("command ask policy returns ratify for propose mood", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const result = await command({
    mood: "propose",
    be: "command",
    su: { name: "run" },
    ob: { text: "echo hi" }
  });
  assert.equal(result?.mood, "do");
  assert.equal(result?.be, "ratify");
  assert.equal(result?.from?.name, "command");
  assert.equal(result?.accordingto?.name, "resume token");
  assert.ok(result?.fromtext?.text);
  assert.match(String(result?.ob?.text ?? ""), /approve command/i);
});

test("command ask policy returns ratify for destructive do mood", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const result = await command({
    mood: "do",
    be: "command",
    ob: { text: "rm -rf /tmp/test" }
  });
  assert.equal(result?.mood, "do");
  assert.equal(result?.be, "ratify");
});

test("command approved resume bypasses ask gate once", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo ask ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));

  const sentence = {
    mood: "propose",
    be: "command",
    su: { name: "run" },
    ob: { text: "cat" },
    fromtext: { text: "hi\n" }
  };
  const first = await command(sentence);
  assert.equal(first?.be, "ratify");

  const resumed = await command({
    ...sentence,
    accordingto: { name: "ratify decision" },
    totext: { text: "truth" }
  });
  assert.equal(resumed?.be, "command");
  assert.match(String(resumed?.ob?.text ?? ""), /hi/);
});

test("command sandbox allows network-class commands even when network flag is disabled", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse("su name sandbox configure be map def"));
  await interpret(parse("su name network ob bool lie ya"));
  await interpret(parse("prah"));
  await assert.doesNotReject(
    () => interpret(parse('be command ob text "echo https://example.com" do'))
  );
});

test("command sandbox blocks write target outside writable roots", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse("su name sandbox configure be map def"));
  await interpret(parse('su name writable roots ob ve filename "/tmp" ya'));
  await interpret(parse("prah"));

  await assert.rejects(
    () => command({
      mood: "do",
      be: "command",
      ob: { text: "echo hi" },
      to: { filename: "/workplace/blocked.txt" }
    }),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.su?.name, "command sandbox defective");
      return true;
    }
  );
});

test("command sandbox blocks cwd outside writable roots", async () => {
  forget();
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse("su name sandbox configure be map def"));
  await interpret(parse('su name writable roots ob ve filename "/tmp" ya'));
  await interpret(parse('su name cwd ob filename "/workplace" ya'));
  await interpret(parse("prah"));

  await assert.rejects(
    () => command({
      mood: "do",
      be: "command",
      ob: { text: "pwd" }
    }),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.su?.name, "command sandbox defective");
      return true;
    }
  );
});

test("command sandbox defaults to agent cwd roots when agent sandbox is enabled", async () => {
  forget();
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-cmd-"));
  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse("exists su name agent sandbox ob bool truth be default ya"));
  await interpret(parse(`exists su name agent cwd ob filename "${agentDir}" be default ya`));

  await assert.rejects(
    () => command({
      mood: "do",
      be: "command",
      ob: { text: "echo hi" },
      to: { filename: "../outside.txt" }
    }),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.su?.name, "command sandbox defective");
      return true;
    }
  );
});

test("command sandbox uses world conduct agent policy as authoritative roots", async () => {
  forget();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-"));
  const worldRoot = path.join(rootDir, "world");
  const agentDir = path.join(worldRoot, "house", "policy-agent");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(worldRoot, "conduct", "agent.pya"), "# strict house-only policy\n", "utf8");

  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse(`exists su name world root ob filename "${worldRoot}" be default ya`));
  await interpret(parse("exists su name agent sandbox ob bool truth be default ya"));
  await interpret(parse(`exists su name agent cwd ob filename "${agentDir}" be default ya`));
  await interpret(parse("su name sandbox configure be map def"));
  await interpret(parse(`su name writable roots ob ve filename "${rootDir}" ya`));
  await interpret(parse("prah"));

  await assert.rejects(
    () => command({
      mood: "do",
      be: "command",
      ob: { text: "echo hi" },
      to: { filename: path.join(rootDir, "outside.txt") }
    }),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.su?.name, "command sandbox defective");
      return true;
    }
  );
});

test("command sandbox allows world conduct project roots for an agent", async () => {
  forget();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-policy-allow-"));
  const worldRoot = path.join(rootDir, "world");
  const agentName = "policy-agent";
  const agentDir = path.join(worldRoot, "house", agentName);
  const projectDir = path.join(rootDir, "workspace");
  const outputFile = path.join(projectDir, "allowed.txt");
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "conduct", "agent.pya"),
    [
      `su name ${agentName} directory license be map def`,
      `  su name "${projectDir}" ob ve text "read" "write" "command" ya`,
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );

  await interpret(parse("su name command configure be map def"));
  await interpret(parse("su name policy mode ob wo allow ya"));
  await interpret(parse("su name classifier enabled ob bool truth ya"));
  await interpret(parse("prah"));
  await interpret(parse(`exists su name world root ob filename "${worldRoot}" be default ya`));
  await interpret(parse("exists su name agent sandbox ob bool truth be default ya"));
  await interpret(parse(`exists su name agent cwd ob filename "${agentDir}" be default ya`));

  const result = await command({
    mood: "do",
    be: "command",
    ob: { text: "echo allowed" },
    to: { filename: outputFile }
  });

  assert.equal(result?.be, "command");
  const written = await fs.readFile(outputFile, "utf8");
  assert.match(written, /allowed/);
});

test("command audit omits unknown class in by while preserving known classes", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence), runRoot: process.cwd() });
  try {
    await interpret(parse("su name command configure be map def"));
    await interpret(parse("su name policy mode ob wo allow ya"));
    await interpret(parse("su name classifier enabled ob bool truth ya"));
    await interpret(parse("prah"));

    await command({
      mood: "do",
      be: "command",
      ob: { text: "true" }
    });
    const unknownAudit = records.find((sentence) => sentence?.be === "command audit");
    assert.ok(unknownAudit);
    assert.equal(unknownAudit.by, undefined);

    await command({
      mood: "do",
      be: "command",
      ob: { text: "echo hi" }
    });
    const knownAudit = records.find((sentence) => sentence?.be === "command audit" && sentence?.by?.name === "read_only");
    assert.ok(knownAudit);
  } finally {
    clearExchangeRecorder();
  }
});
