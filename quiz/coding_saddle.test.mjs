import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { allRemember, forget, remember } from "../program/remember/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { classifyCommandText } from "../program/library/command_policy.mjs";
import { resolveCodingSaddleHousePath } from "../program/agent/coding_saddle_house.mjs";
import {
  ensureSessionFile,
  beginSessionTurn,
  buildSessionNameForDate,
  buildSessionNamePrefix
} from "../program/agent/session.mjs";
import {
  getCodingSaddleProfile,
  readCodingSaddleState,
  saddleSessionProfileKey,
  setCodingSaddleProfile,
  writeCodingSaddleState
} from "../program/agent/coding_saddle_state.mjs";
import {
  assessSaddleCompletion,
  buildSaddleWorktreeReviewCommand,
  buildSaddleStrataContextOptions,
  buildSaddleMindSentence,
  createSaddleInputDecoder,
  DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
  discoverSaddleModels,
  formatSaddleCompletionEvidence,
  formatSaddleBackendPicker,
  formatSaddleModelPicker,
  formatSaddleStatus,
  layoutSaddleInput,
  listSaddleBackendOptions,
  listSaddleMindNames,
  normalizeSaddleThinkSelection,
  resolveSaddleThinkSetting,
  isSaddleCodeChangeRequest,
  SADDLE_OLLAMA_CONTEXT_PRESETS,
  parseSaddleMindCommand,
  resolveSaddleModelOption,
  resolveSaddleModelSelection,
  resolveSaddleMindProfile,
  runSaddleTurnWithEvidence,
  saddleSlashCommandCompletions,
  saddleToolEventLabel,
  startSaddleProgress
} from "../program/agent/coding_saddle.mjs";
import {
  dischargeSaddleModel,
  loadSaddleSessionHistory,
  prepareSaddle,
  renderSaddleSessionHistory,
  resolveSaddleProjectWorldRoot,
  runSaddleTurn,
  waitForSaddleMindStream
} from "../command/pyash_saddle.mjs";

test("coding saddle reloads named and explicitly selected session history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-history-"));
  const sessionDir = path.join(root, "session");
  const dateCompact = buildSessionNamePrefix().slice(0, 8);
  const dailyName = buildSessionNameForDate({ baseName: "coding", dateCompact });
  const dailyFile = path.join(sessionDir, `${dailyName}.pya`);
  const selectedFile = path.join(sessionDir, "project-review.pya");
  const asChat = (name, content) => sentenceToPyash({
    su: { name }, ob: { text: content }, be: "answer", mood: "ya"
  });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(dailyFile, [
    asChat("user", "Please inspect the config."),
    asChat("agent", "I found the setting in config.pya.")
  ].join("\n") + "\n", "utf8");
  await fs.writeFile(selectedFile, [
    asChat("user", "Review this branch."),
    asChat("agent", "The branch is ready for tests.")
  ].join("\n") + "\n", "utf8");

  try {
    const daily = await loadSaddleSessionHistory({ agentHouse: root, sessionName: "coding" });
    assert.deepEqual(daily.messages, [
      { role: "user", content: "Please inspect the config." },
      { role: "assistant", content: "I found the setting in config.pya." }
    ]);

    const selected = await loadSaddleSessionHistory({ agentHouse: root, sessionFile: selectedFile });
    const rendered = [];
    renderSaddleSessionHistory({
      clearHistory() { rendered.push(["clear"]); },
      writeLine(text) { rendered.push(["line", text]); },
      writeMarkdown(text) { rendered.push(["markdown", text]); }
    }, selected.messages, "project-review");
    assert.deepEqual(rendered, [
      ["clear"],
      ["line", "session: project-review | restored 2 saved messages"],
      ["line", "you> Review this branch."],
      ["line", "saddle>"],
      ["markdown", "The branch is ready for tests."],
      ["line", "--- end of saved history ---"]
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle sends on Enter and keeps Shift+Enter as a newline", async () => {
  const submitted = [];
  const decoder = createSaddleInputDecoder({
    onSubmit: async (value) => submitted.push(value)
  });

  decoder.feed("one\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submitted, ["one"]);

  decoder.feed("two\u001b[13;2uthree");
  assert.deepEqual(submitted, ["one"]);
  assert.equal(decoder.getState().value, "two\nthree");
  decoder.feed("\r");

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submitted, ["one", "two\nthree"]);
  assert.equal(decoder.getState().value, "");
});

test("coding saddle bracketed paste preserves multiline text without sending", async () => {
  const submitted = [];
  const decoder = createSaddleInputDecoder({ onSubmit: (value) => submitted.push(value) });

  decoder.feed("before\u001b[200");
  decoder.feed("~first line\r\nsecond line\nthird line\tindented\u001b[201");
  decoder.feed("~after");

  assert.deepEqual(submitted, []);
  assert.equal(decoder.getState().value, "beforefirst line\nsecond line\nthird line\tindentedafter");
  decoder.feed("\r");
  assert.deepEqual(submitted, ["beforefirst line\nsecond line\nthird line\tindentedafter"]);
});

test("coding saddle waits for the stream terminal before returning a completed turn", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-stream-"));
  const streamFile = path.join(root, "answer.stream.txt");
  const priorManagerRequired = process.env.PYA_GPU_MANAGER_REQUIRED;
  await fs.writeFile(streamFile, `${JSON.stringify("first token")}\n`, "utf8");
  let settled = false;
  const streamed = [];
  const resultPromise = runSaddleTurn({
    input: "answer this",
    model: "glm-5.3-flash",
    backend: "ollama",
    host: "http://localhost:11434",
    housekeeperUrl: "http://housekeeper:18886",
    onAssistantDelta: (delta) => streamed.push(delta),
    mindFn: async (_sentence, options) => {
      assert.equal(process.env.PYA_GPU_MANAGER_REQUIRED, "true");
      options.onAssistantDelta("first token");
      setTimeout(() => {
        fs.appendFile(streamFile, `${JSON.stringify({ type: "terminal", ok: true, envelope: { text: "complete answer" } })}\n[PYA_STREAM_END]\n`, "utf8").catch(() => {});
      }, 120);
      return {
        su: { name: "mind-stream" },
        as: { name: "open" },
        be: "stream",
        ob: { filename: streamFile, kind: "mind" }
      };
    }
  }).finally(() => { settled = true; });

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false, "saddle returned before the stream terminal");
    assert.equal(process.env.PYA_GPU_MANAGER_REQUIRED, "true", "local GPU management was released before the stream finished");
    const result = await resultPromise;
    assert.equal(result.be, "answer");
    assert.equal(result.ob.text, "complete answer");
    assert.deepEqual(streamed, ["first token"]);

    const failedStreamFile = path.join(root, "failed.stream.txt");
    await fs.writeFile(failedStreamFile, `${JSON.stringify({ type: "terminal", ok: false, error: { message: "provider interrupted" } })}\n[PYA_STREAM_END]\n`, "utf8");
    await assert.rejects(waitForSaddleMindStream({
      be: "stream",
      ob: { filename: failedStreamFile, kind: "mind" }
    }), /provider interrupted/);
  } finally {
    if (priorManagerRequired === undefined) delete process.env.PYA_GPU_MANAGER_REQUIRED;
    else process.env.PYA_GPU_MANAGER_REQUIRED = priorManagerRequired;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle history restores an unfinished prompt with an explicit status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-pending-"));
  const sessionDir = path.join(root, "session");
  const sessionFile = await ensureSessionFile({ sessionDir, sessionName: "pending", systemPrompt: "system", model: "model" });
  await beginSessionTurn({ sessionFile, userContent: "unfinished question", request: { prompt: "unfinished question" } });

  try {
    const history = await loadSaddleSessionHistory({ agentHouse: root, sessionFile });
    assert.deepEqual(history.messages.map(({ role, content, pending }) => ({ role, content, pending })), [
      { role: "user", content: "unfinished question", pending: true }
    ]);
    const rendered = [];
    renderSaddleSessionHistory({
      clearHistory() {},
      writeLine(text) { rendered.push(text); },
      writeMarkdown() {}
    }, history.messages, "pending");
    assert.ok(rendered.some((line) => line.includes("unfinished turn; no completed response was saved")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle redraw layout wraps long lines once and preserves the cursor row", () => {
  const value = "are you able to access the current directory and its file contents? can you see the sino-pyash folder?";
  const layout = layoutSaddleInput({ value, cursor: value.length, label: "pyash> ", columns: 32 });

  assert.ok(layout.rowCount > 1);
  assert.equal(layout.rowCount, layout.lines.length);
  assert.equal(layout.lines.filter((line) => line.includes("pyash> ")).length, 1);
  assert.ok(layout.lines.every((line) => line.length < 32));
  assert.equal(layout.lines.join("").slice("pyash> ".length), value);
  assert.equal(layout.cursorRow, layout.rowCount - 1);
  assert.equal(layout.cursorColumn, layout.lines.at(-1).length);

  const cursorInsideWrappedLine = layoutSaddleInput({ value: "abcdefghijklmnopqrstuv", cursor: 6, label: "pyash> ", columns: 12 });
  assert.equal(cursorInsideWrappedLine.cursorRow, 1);
  assert.equal(cursorInsideWrappedLine.cursorColumn, 2);

  const multiline = layoutSaddleInput({ value: "first\nsecond", cursor: 12, label: "pyash> ", columns: 32 });
  assert.deepEqual(multiline.lines, ["pyash> first", "second"]);
  assert.equal(multiline.cursorRow, 1);
  assert.equal(multiline.cursorColumn, 6);
});

test("coding saddle supports cursor editing and control actions", () => {
  const events = [];
  const decoder = createSaddleInputDecoder({
    onCancel: () => events.push("cancel"),
    onExit: () => events.push("exit"),
    onScroll: (direction) => events.push(`scroll:${direction}`)
  });

  decoder.feed("abc\u001b[D\u001b[D\u007f");
  assert.equal(decoder.getState().value, "bc");
  assert.equal(decoder.getState().cursor, 0);
  decoder.feed("\u001b[5~\u001b[6~\u0003\u0004");
  assert.deepEqual(events, ["scroll:-1", "scroll:1", "cancel", "exit"]);
});

test("coding saddle autocompletes and cycles slash commands without inserting tabs in ordinary text", () => {
  assert.deepEqual(
    saddleSlashCommandCompletions({ value: "/m", cursor: 2 }).map((choice) => choice.value),
    ["/mind ", "/model "]
  );
  assert.deepEqual(
    saddleSlashCommandCompletions({ value: "/model qwen", cursor: 11 }),
    []
  );

  const decoder = createSaddleInputDecoder({ onAutocomplete: saddleSlashCommandCompletions });
  decoder.feed("/m\t\t");
  assert.equal(decoder.getState().value, "/model ");
  decoder.feed("\t");
  assert.equal(decoder.getState().value, "/mind ");
  decoder.setValue("regular text");
  decoder.feed("\t");
  assert.equal(decoder.getState().value, "regular text");
});

test("coding saddle shows elapsed progress and explicit tool event labels", () => {
  const events = [];
  let tick = null;
  let delay = 0;
  let cleared = false;
  let now = 1000;
  const stop = startSaddleProgress({
    backend: "zai",
    model: "glm-5.3-flash",
    intervalMs: 5000,
    now: () => now,
    onProgress: (line) => events.push(line),
    setIntervalFn: (callback, milliseconds) => {
      tick = callback;
      delay = milliseconds;
      return { unref() {} };
    },
    clearIntervalFn: () => { cleared = true; }
  });
  now = 7000;
  tick();
  stop();

  assert.equal(delay, 5000);
  assert.deepEqual(events, ["working... 6s elapsed (zai / glm-5.3-flash)"]);
  assert.equal(cleared, true);
  assert.equal(saddleToolEventLabel({ stage: "call", toolName: "command" }), "[tool call] command");
  assert.equal(saddleToolEventLabel({ stage: "result", toolName: "repair" }), "[tool result] repair");
});

test("coding saddle completion evidence requires a successful edit and a later command check", () => {
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /name the target file before editing/u);
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /After the final edit/u);
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /active agent house's absolute memory\/MEMORY\.md path/u);
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /validation command and a session or artifact evidence reference/u);
  assert.match(DEFAULT_CODING_SADDLE_SYSTEM_PROMPT, /changed file paths/u);

  const input = "write hello program";
  assert.equal(isSaddleCodeChangeRequest(input), true);
  assert.equal(isSaddleCodeChangeRequest("how does the saddle look now?"), false);
  assert.equal(isSaddleCodeChangeRequest("I did an update; can you test the tools now?"), false);
  assert.equal(isSaddleCodeChangeRequest("see if the file update thing is fixed now"), false);
  assert.equal(isSaddleCodeChangeRequest("check if the file is changed, and update it if needed"), true);
  assert.equal(isSaddleCodeChangeRequest("update the coding saddle tools to show command output"), true);

  const events = [
    {
      stage: "call",
      toolName: "be_write_ob_text_to_filename",
      toolSentence: { be: "write", ob: { text: "console.log('hello')" }, to: { filename: "hello.js" } }
    },
    { stage: "result", toolName: "be_write_ob_text_to_filename", toolText: "written" },
    {
      stage: "call",
      toolName: "be_command_ob_text_to_name_text",
      toolSentence: { be: "command", ob: { text: "node --check hello.js" } }
    },
    {
      stage: "result",
      toolName: "be_command_ob_text_to_name_text",
      toolText: "42\n",
      commandOutcome: { exitCode: 0, signal: null, timedOut: false }
    }
  ];
  const assessment = assessSaddleCompletion(input, events);
  assert.equal(assessment.complete, true);
  assert.deepEqual(assessment.changedPaths, ["hello.js"]);
  assert.equal(assessment.validation.command, "node --check hello.js");
  assert.equal(assessment.validation.exitCode, 0);
  assert.match(formatSaddleCompletionEvidence(assessment), /changed: hello\.js; validation: node --check hello\.js; exit: 0/u);

  const commandWithoutOutcome = assessSaddleCompletion(input, [
    ...events.slice(0, 3),
    { ...events[3], commandOutcome: undefined }
  ]);
  assert.equal(commandWithoutOutcome.complete, false);
  assert.match(commandWithoutOutcome.missing.join(" "), /successful relevant validation/u);

  const beforeEditCheck = assessSaddleCompletion(input, [events[2], events[3], events[0], events[1]]);
  assert.equal(beforeEditCheck.complete, false);
  assert.match(beforeEditCheck.missing.join(" "), /after the final edit/u);

  const irrelevantCommand = assessSaddleCompletion(input, [
    ...events.slice(0, 2),
    { ...events[2], toolSentence: { be: "command", ob: { text: "pwd" } } },
    events[3]
  ]);
  assert.equal(irrelevantCommand.complete, false);

  const failedCheck = assessSaddleCompletion(input, [
    ...events.slice(0, 2),
    events[2],
    { ...events[3], toolText: "command defective: status=1", commandOutcome: { exitCode: 1, signal: null, timedOut: false } }
  ]);
  assert.equal(failedCheck.complete, false);
});

test("coding saddle worktree review uses bounded read-only Git inspection and omits sensitive paths", () => {
  const command = buildSaddleWorktreeReviewCommand({ trackedDiffLimit: 999999, untrackedDiffLimit: 1200 });
  assert.match(command, /git -c core\.quotePath=true status --short --untracked-files=all/u);
  assert.match(command, /git diff --stat HEAD/u);
  assert.match(command, /git diff --no-ext-diff --unified=3 HEAD/u);
  assert.match(command, /git ls-files -z --others --exclude-standard/u);
  assert.match(command, /\*credentials\*\|\*token\*/u);
  assert.match(command, /head -c 24000/u);
  assert.match(command, /head -c 1200/u);
  assert.match(command, /pre-existing worktree changes/u);
  assert.equal(classifyCommandText(command), "read_only");
  assert.doesNotMatch(command, /git (?:add|commit|push|reset|clean)\b/u);
});

test("coding saddle worktree review shows real diffs while omitting sensitive untracked files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-review-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "saddle-test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Saddle Test"], { cwd: root });
    await fs.writeFile(path.join(root, "tracked.txt"), "before\n", "utf8");
    await fs.writeFile(path.join(root, ".env"), "tracked-secret-before\n", "utf8");
    execFileSync("git", ["add", "tracked.txt", ".env"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await fs.writeFile(path.join(root, "tracked.txt"), "after\n", "utf8");
    await fs.writeFile(path.join(root, ".env"), "tracked-secret-after\n", "utf8");
    await fs.writeFile(path.join(root, "new-file.txt"), "new review content\n", "utf8");
    await fs.writeFile(path.join(root, "api-token.txt"), "untracked-secret-do-not-print\n", "utf8");

    const output = execFileSync("bash", ["-lc", buildSaddleWorktreeReviewCommand()], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024
    });
    assert.match(output, /\[worktree status\]/u);
    assert.match(output, /tracked\.txt/u);
    assert.match(output, /\+after/u);
    assert.match(output, /new-file\.txt/u);
    assert.match(output, /new review content/u);
    assert.doesNotMatch(output, /tracked-secret-(?:before|after)|untracked-secret-do-not-print/u);
    assert.match(output, /pre-existing worktree changes/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle collects the worktree review after edits and validation", async () => {
  const order = [];
  const turn = await runSaddleTurnWithEvidence({
    input: "write hello program",
    runTurn: async ({ onToolCall }) => {
      const events = [
        {
          stage: "call",
          toolName: "be_write_ob_text_to_filename",
          toolSentence: { be: "write", ob: { text: "console.log('hello')" }, to: { filename: "hello.js" } }
        },
        { stage: "result", toolName: "be_write_ob_text_to_filename", toolText: "written" },
        {
          stage: "call",
          toolName: "be_command_ob_text_to_name_text",
          toolSentence: { be: "command", ob: { text: "node --check hello.js" } }
        },
        { stage: "result", toolName: "be_command_ob_text_to_name_text", toolText: "", commandOutcome: { exitCode: 0 } }
      ];
      for (const event of events) {
        order.push(event.stage);
        await onToolCall(event);
      }
      return { ob: { text: "Created hello.js and checked its syntax." } };
    },
    onReview: async ({ assessment, events }) => {
      order.push("review");
      assert.equal(assessment.complete, true);
      assert.equal(events.length, 4);
      return "hello.js diff";
    }
  });

  assert.equal(turn.worktreeReview, "hello.js diff");
  assert.deepEqual(order, ["call", "result", "call", "result", "review"]);
});

test("coding saddle gives an incomplete code-change turn one evidence-driven continuation", async () => {
  let calls = 0;
  let continuation = "";
  const turn = await runSaddleTurnWithEvidence({
    input: "write hello program",
    runTurn: async ({ input, onToolCall }) => {
      calls += 1;
      if (calls === 1) return { ob: { text: "done" } };
      continuation = input;
      const writeTool = "be_write_ob_text_to_filename";
      const commandTool = "be_command_ob_text_to_name_text";
      await onToolCall({
        stage: "call",
        toolName: writeTool,
        toolSentence: { be: "write", ob: { text: "console.log('hello')" }, to: { filename: "hello.js" } }
      });
      await onToolCall({ stage: "result", toolName: writeTool, toolText: "written" });
      await onToolCall({
        stage: "call",
        toolName: commandTool,
        toolSentence: { be: "command", ob: { text: "node --check hello.js" } }
      });
      await onToolCall({ stage: "result", toolName: commandTool, toolText: "", commandOutcome: { exitCode: 0 } });
      return { ob: { text: "Created hello.js and checked its syntax." } };
    }
  });

  assert.equal(calls, 2);
  assert.match(continuation, /Original request: write hello program/u);
  assert.equal(turn.retried, true);
  assert.equal(turn.assessment.complete, true);
  assert.equal(turn.result.ob.text, "Created hello.js and checked its syntax.");
});

test("coding saddle does not add a completion pass to general advice", async () => {
  let calls = 0;
  const turn = await runSaddleTurnWithEvidence({
    input: "Do you think the saddle is usable?",
    runTurn: async () => {
      calls += 1;
      return { ob: { text: "Yes, for routine tasks with review." } };
    }
  });
  assert.equal(calls, 1);
  assert.equal(turn.retried, false);
  assert.equal(turn.assessment.required, false);
});

test("coding saddle reports incomplete when the corrective pass still has no successful check", async () => {
  let calls = 0;
  const turn = await runSaddleTurnWithEvidence({
    input: "fix the code bug",
    runTurn: async ({ input, onToolCall }) => {
      calls += 1;
      if (calls === 1) {
        const writeTool = "be_write_ob_text_to_filename";
        await onToolCall({
          stage: "call",
          toolName: writeTool,
          toolSentence: { be: "write", ob: { text: "fixed" }, to: { filename: "fix.js" } }
        });
        await onToolCall({ stage: "result", toolName: writeTool, toolText: "written" });
        return { ob: { text: "fixed" } };
      }
      assert.match(input, /successful relevant validation command/u);
      return { ob: { text: "done" } };
    }
  });

  assert.equal(calls, 2);
  assert.equal(turn.assessment.complete, false);
  assert.match(formatSaddleCompletionEvidence(turn.assessment), /^\[saddle incomplete\]/u);
});

test("coding saddle stores backend and model per selected conversation in Pyash state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-coding-saddle-state-"));
  const statePath = path.join(root, "conduct", "coding-saddle.pya");
  const session = { sessionName: "coding", sessionFile: path.join(root, "session", "20261030-coding.pya") };
  try {
    let state = {
      activeSessionName: "20261030-coding",
      activeSessionFile: session.sessionFile,
      profiles: {}
    };
    state = setCodingSaddleProfile(state, session, {
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3-flash",
      host: "https://api.z.ai/api/v1",
      reasoningEffort: "high"
    });
    await writeCodingSaddleState(statePath, state);

    const savedText = await fs.readFile(statePath, "utf8");
    const loaded = await readCodingSaddleState(statePath);
    assert.match(savedText, /^su name coding saddle active session/m);
    assert.doesNotMatch(savedText, /^\s*\{/m);
    assert.equal(loaded.activeSessionFile, session.sessionFile);
    assert.deepEqual(getCodingSaddleProfile(loaded, session), {
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3-flash",
      host: "https://api.z.ai/api/v1",
      reasoningEffort: "high"
    });
    assert.notEqual(saddleSessionProfileKey(session), saddleSessionProfileKey({ sessionName: "coding" }));
    assert.deepEqual(getCodingSaddleProfile(loaded, { sessionName: "coding" }), {});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle builds a Pyash mind call with backend and session context", () => {
  const sentence = buildSaddleMindSentence({
    input: "inspect the current file",
    model: "qwen3.8:27b",
    backend: "ollama",
    host: "http://mriczo:11434",
    contextWindow: 131072,
    think: true,
    sessionName: "coding",
    historyWindow: 12
  });

  assert.equal(sentence.be, "write");
  assert.equal(sentence.for.name, "coding saddle");
  assert.equal(sentence.with.name, "saddle tools");
  assert.equal(sentence.fromstate.text, "ollama");
  assert.equal(sentence.from.text, "http://mriczo:11434");
  assert.equal(sentence.contextWindow, 131072);
  assert.equal(sentence.think, true);
  assert.equal(sentence.fromtext.name, "session name coding");
  assert.equal(sentence.by.num, 12);
  assert.deepEqual(sentence.vyah.ve.values, ["stream"]);
});

test("coding saddle delegates turns to the existing mind engine", async () => {
  let observed = null;
  const result = await runSaddleTurn({
    input: "run the focused test",
    model: "qwen3.5:9b",
    backend: "ollama",
    host: "http://localhost:11434",
    contextWindow: 65536,
    think: false,
    housekeeperUrl: "http://housekeeper:18886",
    mindFn: async (sentence, options) => {
      assert.equal(process.env.PYA_GPU_HOUSEKEEPER_URL, "http://housekeeper:18886");
      assert.equal(process.env.PYA_GPU_MANAGER_REQUIRED, "true");
      assert.equal(process.env.PYA_GPU_MANAGER_ALLOW_DIRECT, "false");
      observed = { sentence, options };
      return { mood: "ya", be: "text", ob: { text: "done" } };
    }
  });

  assert.equal(result.ob.text, "done");
  assert.equal(observed.sentence.ob.text, "run the focused test");
  assert.equal(observed.sentence.fromstate.text, "ollama");
  assert.equal(observed.sentence.contextWindow, 65536);
  assert.equal(observed.sentence.think, false);
  assert.equal(observed.options.sessionUserContent, "run the focused test");
});

test("duty saddle keeps runtime root separate from its persistent world root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-roots-"));
  const cwd = path.join(root, "project");
  const worldRoot = path.join(root, "state", "world");
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await fs.mkdir(cwd, { recursive: true });
  try {
    await prepareSaddle({
      cwd,
      runtimeRoot,
      worldRoot,
      model: "qwen3.5:9b",
      backend: "ollama",
      host: "http://localhost:11434"
    });
    assert.equal(remember("run root")?.ob?.filename, runtimeRoot);
    assert.equal(remember("world root")?.ob?.filename, worldRoot);
  } finally {
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle restores its saved session backend and model on restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-restore-selection-"));
  const cwd = path.join(root, "project");
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const worldRoot = path.join(root, "world");
  const envKeys = ["PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_HOST"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  await fs.mkdir(cwd, { recursive: true });
  try {
    const first = await prepareSaddle({ cwd, runtimeRoot, worldRoot });
    const session = {
      sessionName: "20261030-coding",
      sessionFile: path.join(first.agentHouse, "session", "20261030-coding.pya")
    };
    let state = setCodingSaddleProfile(first.saddleState, session, {
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3-flash",
      host: "https://api.z.ai/api/v1",
      reasoningEffort: "high"
    });
    state.activeSessionName = session.sessionName;
    state.activeSessionFile = session.sessionFile;
    await writeCodingSaddleState(first.saddleStatePath, state);

    const restored = await prepareSaddle({ cwd, runtimeRoot, worldRoot });
    assert.equal(restored.sessionName, session.sessionName);
    assert.equal(restored.sessionFile, session.sessionFile);
    assert.equal(restored.mindName, "zai");
    assert.equal(restored.backend, "zai");
    assert.equal(restored.model, "glm-5.3-flash");
    assert.equal(restored.host, "https://api.z.ai/api/v1");
    assert.equal(restored.thinkSetting.value, "high");
    assert.equal(restored.selectionSource, "saved session state");
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle does not treat historical transcript models as current selection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-legacy-selection-"));
  const cwd = path.join(root, "project");
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const worldRoot = path.join(root, "world");
  const envKeys = ["PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_HOST"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  await fs.mkdir(cwd, { recursive: true });
  try {
    const initial = await prepareSaddle({ cwd, runtimeRoot, worldRoot });
    const dateCompact = buildSessionNamePrefix().replace(/-$/u, "");
    const sessionName = buildSessionNameForDate({ baseName: "coding", dateCompact });
    const sessionPath = path.join(initial.agentHouse, "session", `${sessionName}.pya`);
    await fs.writeFile(sessionPath, [
      sentenceToPyash({ su: { name: sessionName }, be: "series", mood: "def" }),
      sentenceToPyash({ su: { name: "system" }, ob: { text: "" }, as: { name: "glm-5.3-flash" }, be: "text", mood: "ya" })
    ].join("\n") + "\n", "utf8");

    const restored = await prepareSaddle({ cwd, runtimeRoot, worldRoot });
    assert.equal(restored.mindName, "mind");
    assert.equal(restored.backend, "ollama");
    assert.equal(restored.model, "qwen3.5:9b");
    assert.equal(restored.selectionSource, "configured mind");
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle loads its configured mind when launched from another project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-external-project-"));
  const cwd = path.join(root, "hpuk", "slesh");
  const worldRoot = path.join(root, "world");
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const envKeys = ["PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_HOST"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  await fs.mkdir(cwd, { recursive: true });
  try {
    const config = await prepareSaddle({ cwd, worldRoot });

    assert.equal(config.cwd, cwd);
    assert.equal(path.basename(config.agentHouse), "slesh-coding-saddle");
    assert.equal(remember("agent home file access")?.ob?.boolean, true);
    assert.equal(remember("agent cwd strict relative paths")?.ob?.boolean, true);
    assert.equal(config.runtimeRoot, runtimeRoot);
    assert.equal(config.mindName, "mind");
    assert.equal(config.backend, "ollama");
    assert.equal(config.model, "qwen3.5:9b");
    assert.equal(remember("run root")?.ob?.filename, runtimeRoot);
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle keeps histories per project while reusing the recent model preference", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-project-sessions-"));
  const runtimeRoot = path.join(root, "runtime");
  const projectA = path.join(root, "projects", "alpha");
  const projectB = path.join(root, "projects", "beta");
  const envKeys = ["PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_HOST"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  await fs.mkdir(path.join(runtimeRoot, "configure"), { recursive: true });
  await fs.mkdir(projectA, { recursive: true });
  await fs.mkdir(projectB, { recursive: true });
  try {
    await fs.writeFile(path.join(runtimeRoot, "configure", "default.pya"), [
      "exists su name mind backend be default ob name ollama command mind ya",
      'exists su name mind model ob text "qwen3.5:9b" be default ya',
      'exists su name coding saddle mind ob text "mind" be default ya',
      'exists su name mind be mind from name "http://localhost:11434" via state "qwen3.5:9b" ya',
      'exists su name zai be mind from state "zai" from space "https://api.z.ai/api/v1" via state "glm-5.3-flash" ya'
    ].join("\n") + "\n", "utf8");
    const firstWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectA });
    const legacyHouse = path.join(firstWorldRoot, "house", "coding saddle");
    await fs.mkdir(path.join(legacyHouse, "identity"), { recursive: true });
    await fs.writeFile(path.join(legacyHouse, "identity", "biography.md"), "project identity data\n", "utf8");
    const globalRecentPath = path.join(
      runtimeRoot,
      "world",
      "house",
      "coding saddle",
      "conduct",
      "coding-saddle-recent.pya"
    );
    const recentState = setCodingSaddleProfile({}, { sessionName: "__recent_model__" }, {
      mindName: "zai",
      backend: "zai",
      model: "glm-5.3-flash",
      host: "https://api.z.ai/api/v1",
      reasoningEffort: "high"
    });
    await writeCodingSaddleState(globalRecentPath, recentState);

    const first = await prepareSaddle({ cwd: projectA, runtimeRoot });
    assert.equal(first.worldRoot, firstWorldRoot);
    assert.equal(first.agentHouse, resolveCodingSaddleHousePath({ worldRoot: firstWorldRoot, cwd: projectA }));
    assert.equal(path.basename(first.agentHouse), "alpha-coding-saddle");
    assert.equal(await fs.readFile(path.join(first.agentHouse, "identity", "biography.md"), "utf8"), "project identity data\n");
    await assert.rejects(fs.access(legacyHouse), { code: "ENOENT" });
    assert.equal(first.mindName, "zai");
    assert.equal(first.backend, "zai");
    assert.equal(first.model, "glm-5.3-flash");
    assert.equal(first.thinkSetting.value, "high");
    assert.equal(first.selectionSource, "recent model preference");

    const compactDate = buildSessionNamePrefix().slice(0, 8);
    const todaySession = buildSessionNameForDate({ baseName: "coding", dateCompact: compactDate });
    const transcriptPath = path.join(first.agentHouse, "session", `${todaySession}.pya`);
    await fs.writeFile(transcriptPath, [
      sentenceToPyash({ su: { name: "user" }, ob: { text: "alpha-only history" }, be: "answer", mood: "ya" }),
      sentenceToPyash({ su: { name: "agent" }, ob: { text: "alpha response" }, be: "answer", mood: "ya" })
    ].join("\n") + "\n", "utf8");
    const firstHistory = await loadSaddleSessionHistory({ agentHouse: first.agentHouse, sessionName: "coding" });
    assert.equal(firstHistory.messages.length, 2);

    const projectPreference = setCodingSaddleProfile(first.saddleState, { sessionName: "coding" }, {
      mindName: "mind",
      backend: "ollama",
      model: "qwen3.5:9b",
      host: "http://localhost:11434"
    });
    await writeCodingSaddleState(first.saddleStatePath, projectPreference);
    const resumedFirst = await prepareSaddle({ cwd: projectA, runtimeRoot });
    assert.equal(resumedFirst.selectionSource, "saved session state");
    assert.equal(resumedFirst.mindName, "mind");
    assert.equal(resumedFirst.model, "qwen3.5:9b");

    const second = await prepareSaddle({ cwd: projectB, runtimeRoot });
    assert.notEqual(second.worldRoot, first.worldRoot);
    assert.notEqual(second.agentHouse, first.agentHouse);
    assert.equal(path.basename(second.agentHouse), "beta-coding-saddle");
    assert.equal(second.mindName, "zai");
    assert.equal(second.model, "glm-5.3-flash");
    const secondHistory = await loadSaddleSessionHistory({ agentHouse: second.agentHouse, sessionName: "coding" });
    assert.deepEqual(secondHistory.messages, []);
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle refuses to merge a legacy project house into an existing project-named house", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-house-conflict-"));
  const runtimeRoot = path.join(root, "runtime");
  const cwd = path.join(root, "projects", "biography");
  const envKeys = ["PYA_SADDLE_MIND", "PYA_SADDLE_MODEL", "PYA_SADDLE_HOST"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  await fs.mkdir(path.join(runtimeRoot, "configure"), { recursive: true });
  await fs.mkdir(cwd, { recursive: true });
  try {
    await fs.writeFile(path.join(runtimeRoot, "configure", "default.pya"), [
      "exists su name mind backend be default ob name ollama command mind ya",
      'exists su name mind model ob text "qwen3.5:9b" be default ya',
      'exists su name coding saddle mind ob text "mind" be default ya',
      'exists su name mind be mind from name "http://localhost:11434" via state "qwen3.5:9b" ya'
    ].join("\n") + "\n", "utf8");
    const worldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd });
    const legacyHouse = path.join(worldRoot, "house", "coding saddle");
    const projectHouse = resolveCodingSaddleHousePath({ worldRoot, cwd });
    await fs.mkdir(path.join(legacyHouse, "identity"), { recursive: true });
    await fs.mkdir(path.join(projectHouse, "identity"), { recursive: true });
    await fs.writeFile(path.join(legacyHouse, "identity", "legacy.md"), "keep legacy\n", "utf8");
    await fs.writeFile(path.join(projectHouse, "identity", "current.md"), "keep current\n", "utf8");

    await assert.rejects(
      prepareSaddle({ cwd, runtimeRoot }),
      /coding saddle house migration conflict/
    );
    assert.equal(await fs.readFile(path.join(legacyHouse, "identity", "legacy.md"), "utf8"), "keep legacy\n");
    assert.equal(await fs.readFile(path.join(projectHouse, "identity", "current.md"), "utf8"), "keep current\n");
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle selects named Pyash minds without changing global defaults", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-zai-"));
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const worldRoot = path.join(root, "world");
  try {
    const defaultMind = await prepareSaddle({ cwd: root, runtimeRoot, worldRoot });
    assert.equal(defaultMind.mindName, "mind");
    assert.equal(defaultMind.backend, "ollama");
    assert.equal(defaultMind.model, "qwen3.5:9b");

    const zai = await prepareSaddle({
      cwd: root,
      runtimeRoot,
      worldRoot,
      mindName: "zai"
    });
    assert.equal(zai.mindName, "zai");
    assert.equal(zai.backend, "zai");
    assert.equal(zai.model, "glm-5.3");
    assert.equal(zai.host, "https://api.z.ai/api/coding/paas/v4");
    assert.equal(remember("coding saddle")?.fromstate?.text, "zai");
    assert.equal(remember("coding saddle")?.as?.name, "glm-5.3");
    const zaiCall = await runSaddleTurn({
      input: "test selected Z.AI mind",
      model: zai.model,
      backend: zai.backend,
      host: zai.host,
      mindFn: async (sentence) => sentence
    });
    assert.equal(zaiCall.for.name, "coding saddle");
    assert.equal(zaiCall.fromstate.text, "zai");

    const openai = await prepareSaddle({
      cwd: root,
      runtimeRoot,
      worldRoot,
      mindName: "openai"
    });
    assert.equal(openai.mindName, "openai");
    assert.equal(openai.backend, "openai");
    assert.equal(openai.model, "gpt-5.3-codex");
    assert.equal(openai.host, "https://api.openai.com");
    assert.equal(remember("coding saddle")?.fromstate?.text, "openai");
    assert.equal(remember("coding saddle")?.as?.name, "gpt-5.3-codex");
    const openaiCall = await runSaddleTurn({
      input: "test selected OpenAI mind",
      model: openai.model,
      backend: openai.backend,
      host: openai.host,
      mindFn: async (sentence) => sentence
    });
    assert.equal(openaiCall.fromstate.text, "openai");

    const minimax = await prepareSaddle({
      cwd: root,
      runtimeRoot,
      worldRoot,
      mindName: "minimax"
    });
    assert.equal(minimax.mindName, "minimax");
    assert.equal(minimax.backend, "minimax");
    assert.equal(minimax.model, "MiniMax-M3.1-Flash");
    assert.equal(minimax.host, "https://api.minimax.io/v1");
    const minimaxCall = await runSaddleTurn({
      input: "test selected MiniMax mind",
      model: minimax.model,
      backend: minimax.backend,
      host: minimax.host,
      mindFn: async (sentence) => sentence
    });
    assert.equal(minimaxCall.fromstate.text, "minimax");

    assert.deepEqual(listSaddleMindNames({ minds: allRemember() }), ["mind", "minimax", "openai", "zai"]);
    await assert.rejects(prepareSaddle({ cwd: root, runtimeRoot, worldRoot, mindName: "missing" }), /Pyash mind not found: missing/);
  } finally {
    forget();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("coding saddle status exposes selected Pyash mind and queue state", () => {
  const status = formatSaddleStatus({
    mindName: "stratahelper",
    model: "qwen3.8:27b",
    backend: "strata",
    housekeeperUrl: "http://localhost:18886",
    host: "http://swac:8090",
    cwd: "/tmp/project",
    queue: { queueDepth: 3, queuedCount: 0, runningCount: 3 },
    busy: true
  });

  assert.match(status, /mind: stratahelper/);
  assert.match(status, /model: qwen3\.8:27b/);
  assert.match(status, /route: GPU Housekeeper http:\/\/localhost:18886/);
  assert.doesNotMatch(status, /swac:8090|localhost:11434/);
  assert.match(status, /gpu queue: 0 queued, 3 running/);
  assert.match(status, /state: running/);
});

test("coding saddle status exposes Z.AI reasoning effort instead of hiding the effective default", () => {
  const defaultEffort = resolveSaddleThinkSetting({ backend: "zai" });
  assert.equal(defaultEffort.value, "low");

  const status = formatSaddleStatus({
    mindName: "zai",
    model: "glm-5.3-flash",
    backend: "zai",
    host: "https://api.z.ai/api/v1",
    cwd: "/tmp/project",
    thinkMode: defaultEffort.value
  });
  assert.match(status, /reasoning effort: low/u);
  assert.doesNotMatch(status, /reasoning effort: max|thinking: /u);

  assert.equal(resolveSaddleThinkSetting({ backend: "zai", savedEffort: "high" }).value, "high");
  assert.equal(resolveSaddleThinkSetting({ backend: "zai", configuredEffort: "max" }).value, "max");
  assert.equal(resolveSaddleThinkSetting({ backend: "strata" }), null);
});

test("coding saddle resolves Pyash mind cases and rejects non-mind facts", () => {
  assert.deepEqual(resolveSaddleMindProfile({
    mindName: "zai",
    profile: {
      be: "mind",
      fromstate: { name: "zai" },
      from: { name: "https://api.z.ai/api/v1" },
      as: { name: "glm-5.3" }
    }
  }), {
    mindName: "zai",
    backend: "zai",
    model: "glm-5.3",
    host: "https://api.z.ai/api/v1"
  });
  assert.throws(() => resolveSaddleMindProfile({ mindName: "ordinary fact", profile: { be: "text" } }), /Pyash mind not found/);
});

test("coding saddle recognizes /mind list and selection commands, not provider commands", () => {
  assert.deepEqual(parseSaddleMindCommand("/mind"), { type: "list" });
  assert.deepEqual(parseSaddleMindCommand("/mind ZAI"), { type: "select", mindName: "ZAI" });
  assert.equal(parseSaddleMindCommand("/backend zai"), null);
  assert.equal(parseSaddleMindCommand("ordinary prompt mentioning /mind zai"), null);
});

test("coding saddle discovers and selects models from the active backend", async () => {
  const ollama = await discoverSaddleModels({
    backend: "ollama",
    host: "http://mriczo:11434",
    housekeeperUrl: "http://housekeeper:18886",
    currentModel: "qwen3.5:9b",
    fetchFn: async (url) => {
      assert.equal(url, "http://housekeeper:18886/runtime/ollama/models");
      return { ok: true, async json() { return { models: [{ name: "qwen3.5:9b" }, { name: "qwen3.8:27b" }] }; } };
    }
  });

  assert.deepEqual(ollama.models, ["qwen3.5:9b", "qwen3.8:27b"]);
  assert.equal(resolveSaddleModelSelection("2", ollama.models), "qwen3.8:27b");
  assert.match(formatSaddleModelPicker({ models: ollama.models, currentModel: ollama.models[0] }), /1\. qwen3\.5:9b \(current\)/);
});

test("coding saddle lists each configured backend once with its default mind and model", () => {
  const backends = listSaddleBackendOptions({
    minds: [
      { su: { name: "mind" }, be: "mind" },
      { su: { name: "zai" }, be: "mind", fromstate: { text: "zai" }, as: { text: "glm-5.3-flash" }, from: { text: "https://api.z.ai/api/v1" } },
      { su: { name: "openai" }, be: "mind", fromstate: { text: "openai" }, as: { text: "gpt-5.3-codex" }, from: { text: "https://api.openai.com" } },
      { su: { name: "minimax" }, be: "mind", fromstate: { text: "minimax" }, as: { text: "MiniMax-M3.1-Flash" }, from: { text: "https://api.minimax.io/v1" } },
      { su: { name: "alternate zai" }, be: "mind", fromstate: { text: "zai" }, as: { text: "glm-5.3" } }
    ],
    defaultBackend: "ollama",
    defaultModel: "qwen3.5:9b",
    hostForBackend: (backend) => backend === "ollama" ? "http://localhost:11434" : "https://api.example.test",
    currentBackend: "ollama",
    currentMindName: "mind"
  });

  assert.deepEqual(backends.map(({ backend, mindName, model }) => [backend, mindName, model]), [
    ["ollama", "mind", "qwen3.5:9b"],
    ["zai", "zai", "glm-5.3-flash"],
    ["openai", "openai", "gpt-5.3-codex"],
    ["minimax", "minimax", "MiniMax-M3.1-Flash"]
  ]);
  const menu = formatSaddleBackendPicker({ backends });
  assert.match(menu, /1\. Ollama — qwen3\.5:9b \(current\)/);
  assert.match(menu, /2\. Z\.AI — glm-5\.3-flash/);
});

test("coding saddle discovers Strata models through Housekeeper, never its provider endpoint", async () => {
  const result = await discoverSaddleModels({
    backend: "strata",
    host: "http://127.0.0.1:8081",
    housekeeperUrl: "http://housekeeper:18886",
    fetchFn: async (url) => {
      assert.equal(url, "http://housekeeper:18886/runtime/strata/models");
      return { ok: true, async json() { return { data: [{ id: "qwen3.8-flash-next-iq2_xs" }] }; } };
    }
  });
  assert.deepEqual(result.models, ["qwen3.8-flash-next-iq2_xs"]);
  assert.equal(result.available, true);
});

test("coding saddle does not attempt local model discovery without Housekeeper", async () => {
  let fetchCalled = false;
  const result = await discoverSaddleModels({
    backend: "ollama",
    host: "http://localhost:11434",
    fetchFn: async () => { fetchCalled = true; throw new Error("must not call provider directly"); }
  });
  assert.equal(fetchCalled, false);
  assert.equal(result.available, false);
  assert.match(result.error, /Housekeeper URL is required/);
});

test("coding saddle discharges local model residency through Housekeeper", async () => {
  const calls = [];
  const result = await dischargeSaddleModel("qwen3.5:9b", "ollama", {
    housekeeperUrl: "http://housekeeper:18886",
    adapterFactory: ({ baseUrl }) => ({
      async discharge({ profileName }) {
        calls.push({ baseUrl, profileName });
        return { success: true, discharged: true };
      }
    })
  });
  assert.deepEqual(calls, [{ baseUrl: "http://housekeeper:18886", profileName: "qwen3.5:9b" }]);
  assert.deepEqual(result, { success: true, discharged: true });
});

test("coding saddle maps Ollama thinking to boolean and Strata thinking to supported efforts", () => {
  assert.deepEqual(SADDLE_OLLAMA_CONTEXT_PRESETS, [4096, 8192, 16384, 32768, 65536]);
  assert.deepEqual(normalizeSaddleThinkSelection("off", "ollama"), {
    value: "off", think: false, reasoningEffort: null
  });
  assert.deepEqual(normalizeSaddleThinkSelection("on", "ollama"), {
    value: "on", think: true, reasoningEffort: null
  });
  assert.equal(normalizeSaddleThinkSelection("medium", "ollama"), null);
  assert.deepEqual(normalizeSaddleThinkSelection("off", "strata"), {
    value: "none", think: null, reasoningEffort: "none"
  });
  assert.deepEqual(normalizeSaddleThinkSelection("low", "strata"), {
    value: "low", think: null, reasoningEffort: "low"
  });
  assert.deepEqual(normalizeSaddleThinkSelection("on", "strata"), {
    value: "high", think: null, reasoningEffort: "high"
  });
  assert.deepEqual(normalizeSaddleThinkSelection("low", "zai"), {
    value: "low", think: null, reasoningEffort: "low"
  });
  assert.deepEqual(normalizeSaddleThinkSelection("high", "zai"), {
    value: "high", think: null, reasoningEffort: "high"
  });
  assert.deepEqual(normalizeSaddleThinkSelection("max", "zai"), {
    value: "max", think: null, reasoningEffort: "max"
  });
  assert.equal(normalizeSaddleThinkSelection("medium", "zai"), null);
  const strataSentence = buildSaddleMindSentence({
    input: "think this through",
    backend: "strata",
    reasoningEffort: "low"
  });
  assert.equal(strataSentence.reasoningEffort, "low");
  const zaiSentence = buildSaddleMindSentence({
    input: "compare effort levels",
    backend: "zai",
    reasoningEffort: "high"
  });
  assert.equal(zaiSentence.reasoningEffort, "high");
  assert.equal(buildSaddleMindSentence({
    input: "use the default effort",
    backend: "zai",
    reasoningEffort: resolveSaddleThinkSetting({ backend: "zai" }).reasoningEffort
  }).reasoningEffort, "low");
});

test("coding saddle builds Strata context choices from Housekeeper-supported sizes", () => {
  const choices = buildSaddleStrataContextOptions({
    options: [16384, 32768, 65536, 65536, 999999, "bad"],
    currentContextLength: 32768,
    defaultContextLength: 32768
  });
  assert.deepEqual(choices.map((choice) => [choice.label, choice.tokens, choice.current]), [
    ["Default (32K)", 32768, true],
    ["16K", 16384, false],
    ["32K", 32768, true],
    ["64K", 65536, false]
  ]);
  assert.deepEqual(buildSaddleStrataContextOptions({ options: [] }), []);
});

test("coding saddle discovers all account-enabled Z.AI models for the model picker", async () => {
  const result = await discoverSaddleModels({
    backend: "zai",
    host: "https://api.z.ai/api/v1",
    currentModel: "glm-5.3-flash",
    apiKey: "test-coding-key",
    fetchFn: async (url, options) => {
      assert.equal(url, "https://api.z.ai/api/coding/paas/v4/models");
      assert.equal(options.headers.authorization, "Bearer test-coding-key");
      return {
        ok: true,
        async json() {
          return { data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }, { id: "glm-5.3-flashx" }] };
        }
      };
    }
  });

  assert.deepEqual(result.models, ["glm-5.3-flash", "glm-5.3", "glm-5.3-flashx"]);
  assert.deepEqual(result.catalogModels, ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"]);
  assert.equal(result.available, true);
  assert.equal(resolveSaddleModelSelection("3", result.models), "glm-5.3-flashx");
  const contextChoices = [
    { model: "204800", value: "200K", label: "200K", tokens: 204800 },
    { model: "1048576", value: "1M", label: "1M", tokens: 1048576 }
  ];
  assert.equal(resolveSaddleModelOption("200K", contextChoices)?.tokens, 204800);
});

test("coding saddle preserves the current model when catalogue discovery fails", async () => {
  const result = await discoverSaddleModels({
    backend: "strata",
    host: "http://swac:8081",
    housekeeperUrl: "http://housekeeper:18886",
    currentModel: "qwen3.8:27b",
    fetchFn: async (url) => {
      assert.equal(url, "http://housekeeper:18886/runtime/strata/models");
      throw new Error("connection refused");
    }
  });

  assert.deepEqual(result.models, ["qwen3.8:27b"]);
  assert.equal(result.available, false);
  assert.equal(resolveSaddleModelSelection("qwen3.8:27b", result.models), "qwen3.8:27b");
});

test("coding saddle picker keeps Strata targets distinct from Ollama models", () => {
  const options = [
    { value: "qwen3.5:9b", model: "qwen3.5:9b", backend: "ollama" },
    { value: "strata::qwen3.8-flash-next-coder-iq1_m", model: "qwen3.8-flash-next-coder-iq1_m", backend: "strata", host: "http://swac:8081", label: "Strata: qwen3.8-flash-next-coder-iq1_m" }
  ];
  const picker = formatSaddleModelPicker({ models: options, currentModel: "qwen3.5:9b", currentBackend: "ollama" });
  assert.match(picker, /2\. Strata: qwen3\.8-flash-next-coder-iq1_m/);
  assert.doesNotMatch(picker, /swac:8081/);
  assert.deepEqual(resolveSaddleModelOption("2", options), options[1]);
});
