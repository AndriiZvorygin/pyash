import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { buildProgram } from "../program/program.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";
import { clearRunToolEventRecorder, setRunToolEventRecorder } from "../program/bridge/newspaper.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const examplePath = path.join(repoRoot, "examples", "pyash", "agent-research-workflow.pya");
const runnerPath = path.join(repoRoot, "command", "run_pya_program.mjs");
const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");

async function importResearchTools() {
  await interpret(parse(
    `from filename ${JSON.stringify(path.join(repoRoot, "module", "research_tools.pya"))} ob name research tools to name research tools be import do`
  ));
}

function capabilityEntries() {
  const map = remember("research tools")?.ob?.map ?? {};
  return Object.values(map).filter((entry) => entry?.mood === "can");
}

function toolBySubject(tools, subject) {
  return tools.find((tool) => {
    const description = String(tool?.function?.description ?? "");
    return description.startsWith(`su name ${subject} `) || description.startsWith(`su name research tools ${subject} `);
  });
}

function toolResponse(toolName, args, id) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{
        id,
        type: "function",
        function: { name: toolName, arguments: args }
      }]
    }
  };
}

function parsedLines(text) {
  return buildProgram(String(text)).sentences;
}

async function runFixtureExample({ cwd, runId, response }) {
  const fixturePath = path.join(cwd, "search.json");
  await fs.writeFile(fixturePath, JSON.stringify({
    results: [{
      url: "https://example.com/pyash-research.html",
      title: "Pyash research source",
      content: "Pyash is a sentence-shaped language with typed cases."
    }]
  }), "utf8");
  await fs.mkdir(path.join(cwd, "configure"), { recursive: true });
  await fs.mkdir(path.join(cwd, "examples", "pyash"), { recursive: true });
  await fs.mkdir(path.join(cwd, "module"), { recursive: true });
  await fs.copyFile(examplePath, path.join(cwd, "examples", "pyash", "agent-research-workflow.pya"));
  await fs.copyFile(path.join(repoRoot, "module", "research_tools.pya"), path.join(cwd, "module", "research_tools.pya"));
  await fs.writeFile(
    path.join(cwd, "configure", "default.pya"),
    'exists su name web search motor ob filename "https://search.example/" be default ya\n',
    "utf8"
  );
  const env = { ...process.env };
  for (const name of [
    "PYA_MIND_RESPONSE",
    "PYA_WEB_SEARCH_FIXTURE",
    "PYA_DOWNLOAD_RESPONSE",
    "PYA_HEAR_FIXTURE",
    "PYA_PIPER_FIXTURE",
    "PYA_SEE_VL_FIXTURE"
  ]) delete env[name];
  env.PYA_MIND_RESPONSE = JSON.stringify(response);
  env.PYA_WEB_SEARCH_FIXTURE = fixturePath;
  env.PYA_DOWNLOAD_RESPONSE = "<html><body><h1>Pyash</h1><p>Typed cases make workflows inspectable.</p><p>Source: https://example.com/pyash-research.html</p></body></html>";
  return execFileAsync(process.execPath, [
    runnerPath,
    "--newspaper",
    "--run-id", runId,
    "--run-time", "2026-08-18T12:00:00Z",
    path.join(cwd, "examples", "pyash", "agent-research-workflow.pya")
  ], { cwd, env, timeout: 120000 });
}

test("research tool map exposes exactly three bounded capabilities", async () => {
  forget();
  await importResearchTools();

  const entries = capabilityEntries();
  assert.deepEqual(entries.map((entry) => String(entry.su?.name ?? "").replace(/^research tools /, "")).sort(), ["download", "read markdown", "search"]);
  assert.equal(remember("research tools")?.as?.wo, "sandpit");
  assert.equal(remember("research tools")?.ob?.map?.agent?.ob?.boolean, true);

  const { tools, toolMap } = buildToolSchemas("research tools");
  assert.equal(tools.length, 3);
  assert.deepEqual([...toolMap.keys()].filter((key) => key.startsWith("be ")).sort(), [
    "be download as wo web from filename to filename",
    "be read atmost byte become wo markdown from filename fromstate wo html",
    "be search by num fromstate wo web ob text"
  ]);

  const searchTool = toolBySubject(tools, "search");
  const downloadTool = toolBySubject(tools, "download");
  const readTool = toolBySubject(tools, "read markdown");
  assert.deepEqual(searchTool?.function?.parameters?.required, ["ob"]);
  assert.deepEqual(downloadTool?.function?.parameters?.required, ["from"]);
  assert.deepEqual(readTool?.function?.parameters?.required ?? [], []);
  const toolEntries = Object.values(remember("research tools")?.ob?.map ?? {});
  assert.equal(toolEntries.find((entry) => entry?.be === "download")?.to?.filename, "retrieved.html");
  assert.equal(toolEntries.find((entry) => entry?.be === "read")?.atmost?.byte, 65536);
  assert.equal(toolEntries.find((entry) => entry?.be === "search")?.by?.num, 3);
});

test("fixture research workflow records evidence, writes the report, and replays", async () => {
  forget();
  await importResearchTools();
  const { tools } = buildToolSchemas("research tools");
  const searchTool = toolBySubject(tools, "search");
  const downloadTool = toolBySubject(tools, "download");
  const readTool = toolBySubject(tools, "read markdown");
  assert.ok(searchTool && downloadTool && readTool);

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-research-"));
  const runId = "agent-research-fixture";
  const response = [
    toolResponse(searchTool.function.name, { ob: "Pyash language" }, "search-1"),
    toolResponse(downloadTool.function.name, { from: "https://example.com/pyash-research.html" }, "download-1"),
    toolResponse(readTool.function.name, {}, "read-1"),
    { message: { role: "assistant", content: "Pyash uses typed cases to make workflows inspectable. Source: https://example.com/pyash-research.html" } }
  ];
  await runFixtureExample({ cwd, runId, response });

  const reportPath = path.join(cwd, "examples", "out", "agent-research", "report.md");
  const report = await fs.readFile(reportPath, "utf8");
  assert.match(report, /typed cases/);
  assert.match(report, /https:\/\/example\.com\/pyash-research\.html/);
  const sessionDir = path.join(cwd, "examples", "out", "agent-research", "session");
  const sessionFiles = (await fs.readdir(sessionDir)).filter((name) => name.endsWith(".pya"));
  assert.equal(sessionFiles.length, 1);
  const session = await fs.readFile(path.join(sessionDir, sessionFiles[0]), "utf8");
  assert.match(session, /Pyash Andrii Zvorygin/);
  assert.match(session, /typed cases/);

  const newspaperPath = path.join(cwd, "newspaper", `${runId}.pya`);
  const newspaper = parsedLines(await fs.readFile(newspaperPath, "utf8"));
  const runStart = newspaper.findIndex((sentence) => sentence?.be === "run");
  const runEnd = newspaper.findIndex((sentence) => sentence?.be === "end");
  assert.ok(runStart >= 0 && runStart < runEnd);
  const toolEvents = newspaper.filter((sentence) => sentence?.be === "tool");
  assert.equal(toolEvents.length, 3);
  assert.deepEqual(toolEvents.map((event) => event?.ob?.la?.be), ["search", "download", "read"]);
  assert.ok(toolEvents.every((event) => event?.to?.la?.mood === "ya"));
  assert.ok(newspaper.some((sentence) => sentence?.be === "artifact" && sentence?.to?.filename?.endsWith("report.md")));
  const artifactHashes = newspaper
    .filter((sentence) => sentence?.be === "artifact" && sentence?.fromtext?.text)
    .map((sentence) => sentence.fromtext.text);
  assert.ok(artifactHashes.length >= 2);
  for (const hash of artifactHashes) {
    await fs.access(path.join(cwd, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.html`)).catch(async () => {
      await fs.access(path.join(cwd, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.md`)).catch(async () => {
        await fs.access(path.join(cwd, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.txt`));
      });
    });
  }

  const resultPath = path.join(cwd, "artifacts", runId, "result.pya");
  const result = await fs.readFile(resultPath, "utf8");
  assert.match(result, /typed cases/);
  assert.doesNotMatch(result, /be session/);
  const replay = await execFileAsync(process.execPath, [replayPath, "--run-id", runId, "--run-root", cwd], {
    cwd,
    timeout: 120000
  });
  assert.match(replay.stdout, /be replay ya/);
});

test("download escape is surfaced as a typed tool event", async () => {
  forget();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-research-download-"));
  doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: cwd } });
  doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
  await interpret(parse("su name tools as wo sandpit be map def"));
  await interpret(parse("su name agent ob bool truth ya"));
  await interpret(parse("su name download be download from filename input as wo web to filename input can"));
  await interpret(parse("prah"));
  const { tools, toolMap } = buildToolSchemas("tools");
  const downloadTool = toolBySubject(tools, "download");
  const events = [];
  setRunToolEventRecorder((event) => { events.push(event); return true; });
  try {
    const result = await runToolChat({
      sentence: parse('be write ob text "research" for name helper to name text out with name tools do'),
      mindName: "helper",
      model: "fixture",
      dialogue: "helper research",
      callPrompt: "download",
      historyMessages: [],
      toolMap,
      tools,
      toolBlock: "",
      backendName: "",
      ollamaHost: "",
      reasoningEffort: "",
      mindDebug: false,
      debugMind: () => {},
      inputs: {
        inputText: "download",
        mockResponseRaw: JSON.stringify([
          toolResponse(downloadTool.function.name, { from: "https://example.com/source", to: "../escape.html" }, "escape-1"),
          { message: { role: "assistant", content: "download failed" } }
        ])
      }
    });
    assert.equal(result, "download failed");
    const resultEvent = events.find((event) => event.stage === "result");
    assert.match(String(resultEvent?.toolText ?? ""), /download defective/);
  } finally {
    clearRunToolEventRecorder();
  }
});

test("missing downloaded content keeps the typed read failure", async () => {
  forget();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-research-read-"));
  doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: cwd } });
  doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
  await interpret(parse("su name tools as wo sandpit be map def"));
  await interpret(parse("su name read markdown be read from filename input fromstate wo html become wo markdown can"));
  await interpret(parse("prah"));
  const { tools, toolMap } = buildToolSchemas("tools");
  const readTool = toolBySubject(tools, "read markdown");
  const events = [];
  try {
    const result = await runToolChat({
      sentence: parse('be write ob text "research" for name helper to name text out with name tools do'),
      mindName: "helper",
      model: "fixture",
      dialogue: "helper research",
      callPrompt: "read",
      historyMessages: [],
      toolMap,
      tools,
      toolBlock: "",
      backendName: "",
      ollamaHost: "",
      reasoningEffort: "",
      mindDebug: false,
      debugMind: () => {},
      onToolCall: async (event) => events.push(event),
      inputs: {
        inputText: "read",
        mockResponseRaw: JSON.stringify([
          toolResponse(readTool.function.name, { from: "missing.html" }, "read-1"),
          { message: { role: "assistant", content: "read failed" } }
        ])
      }
    });
    assert.equal(result, "read failed");
    assert.match(String(events.find((event) => event.stage === "result")?.toolText ?? ""), /file or directory unavailable error/);
  } finally {
    clearRunToolEventRecorder();
  }
});

test("max tool calls counts each call in one model response and rejects the excess", async () => {
  forget();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-research-limit-"));
  doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: cwd } });
  doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
  await interpret(parse("su name tools as wo sandpit be map def"));
  await interpret(parse("su name agent ob bool truth ya"));
  await interpret(parse("su name write one be write ob text input to filename \"one.txt\" can"));
  await interpret(parse("su name touch two be touch to filename \"two.txt\" can"));
  await interpret(parse("prah"));
  const { tools, toolMap } = buildToolSchemas("tools");
  const oneTool = toolBySubject(tools, "write one");
  const twoTool = toolBySubject(tools, "touch two");
  const events = [];
  setRunToolEventRecorder((event) => { events.push(event); return true; });
  try {
    await assert.rejects(
      () => runToolChat({
        sentence: parse('be write ob text "research" for name helper to name text out with name tools do'),
        mindName: "helper",
        model: "fixture",
        dialogue: "helper research",
        callPrompt: "write",
        historyMessages: [],
        toolMap,
        tools,
        toolBlock: "",
        backendName: "",
        ollamaHost: "",
        reasoningEffort: "",
        mindDebug: false,
        debugMind: () => {},
        inputs: {
          inputText: "write",
          mockResponseRaw: JSON.stringify({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                toolResponse(oneTool.function.name, { ob: "one" }, "one-1").message.tool_calls[0],
                toolResponse(twoTool.function.name, {}, "two-1").message.tool_calls[0]
              ]
            }
          })
        },
        maxToolCalls: 1
      }),
      (error) => error?.sentence?.su?.name === "mind tool call limit exceeded"
        && error?.sentence?.mood === "do"
    );
    assert.equal(await fs.readFile(path.join(cwd, "one.txt"), "utf8"), "one");
    await assert.rejects(() => fs.access(path.join(cwd, "two.txt")));
    assert.ok(events.some((event) => event.stage === "result" && /mind tool call limit exceeded/.test(String(event.toolText))));
  } finally {
    clearRunToolEventRecorder();
  }
});

test("bounded HTML markdown dispatch honors atmost byte", async () => {
  forget();
  const filename = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-research-html-")), "source.html");
  await fs.writeFile(filename, `<p>${"Pyash ".repeat(20000)}</p>`, "utf8");
  await interpret(parse(`from filename ${JSON.stringify(filename)} fromstate wo html become wo markdown atmost byte 64 to name text bounded be read do`));
  assert.ok(Buffer.byteLength(remember("bounded")?.ob?.text ?? "", "utf8") <= 64);
});
