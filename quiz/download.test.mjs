import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildYtDlpArgs } from "../program/verbs/download/runners.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("yt-dlp defaults to quiet headless output and allows explicit progress overrides", () => {
  const defaults = buildYtDlpArgs({
    url: "https://example.com/video",
    outputPath: "video.mp4",
    intent: "video"
  });
  assert.deepEqual(defaults.slice(0, 2), ["--quiet", "--no-progress"]);
  assert.deepEqual(defaults.slice(-1), ["https://example.com/video"]);

  const optedIn = buildYtDlpArgs({
    url: "https://example.com/video",
    extraArgs: ["--no-quiet", "--progress"]
  });
  assert.deepEqual(optedIn.slice(-3), ["--no-quiet", "--progress", "https://example.com/video"]);
});

test("download infers fromstate from URL and writes mock output", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-"));
  const outPath = path.join(tmpDir, "mock.txt");
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "ok";
  try {
    const sentence = parse(
      `be download from filename "https://example.com/file.txt" as wo web to filename "${outPath}" do`
    );
    await interpret(sentence);
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "ok");
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("download magnet backend missing is deterministic", async () => {
  forget();
  await assert.rejects(
    () => interpret(parse('be download fromstate magnet from filename "magnet:?xt=urn:btih:demo" to filename "out.torrent" do')),
    (err) => err?.sentence?.su?.name === "download defective"
      && String(err?.sentence?.ob?.text ?? "").includes("backend missing")
  );
});

test("download video uses ytdlp path with mock response", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-"));
  const outPath = path.join(tmpDir, "mock.mp4");
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "video";
  try {
    await interpret(parse(
      `be download from filename "https://example.com/video" as wo video to filename "${outPath}" do`
    ));
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "video");
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("download-ytdlp example accepts URL and destination as agent inputs", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-example-"));
  const programPath = path.join(repoRoot, "examples", "pyash", "download-ytdlp.pya");
  const runnerPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const runId = `download-example-${process.pid}`;
  const outputPath = path.join(tmpDir, "nested", "agent-video.mp4");
  const source = await fs.readFile(programPath, "utf8");
  const originalResponse = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "agent video fixture";
  try {
    assert.match(source, /ob text text video_url be input ya/u);
    assert.match(source, /ob filename text video_output be input ya/u);
    assert.match(source, /from filename of video_url as wo video to filename of video_output/u);
    assert.doesNotMatch(source, /BaW_jenozKc|examples\/out\/video\.mp4/u);

    const result = spawnSync(process.execPath, [
      runnerPath,
      "--run-id", runId,
      programPath,
      "https://www.youtube.com/watch?v=agent-fixture",
      outputPath,
      "--verbose"
    ], { cwd: tmpDir, encoding: "utf8", env: process.env });
    assert.equal(result.status, 0, `expected agent download example to pass\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(outputPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    assert.equal(await fs.readFile(outputPath, "utf8"), "agent video fixture");
    const runResult = await fs.readFile(path.join(tmpDir, "artifacts", runId, "result.pya"), "utf8");
    assert.match(runResult, new RegExp(outputPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  } finally {
    if (originalResponse === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = originalResponse;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("download without to filename defaults to cwd artifacts day directory", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-"));
  const originalCwd = process.cwd();
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "ok";
  try {
    process.chdir(tmpDir);
    const result = await interpret(parse(
      'be download from filename "https://example.com/file.txt" as wo web do'
    ));
    const day = new Date();
    const dayStamp = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
    const outPath = path.join(tmpDir, "artifacts", dayStamp, "file.txt");
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "ok");
    assert.equal(result?.value?.filename, outPath);
  } finally {
    process.chdir(originalCwd);
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("download supports ob wo all during months for yt-dlp", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-"));
  const originalCwd = process.cwd();
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "ok";
  try {
    process.chdir(tmpDir);
    const result = await interpret(parse(
      'be download ob wo all during months 1 from filename "https://example.com/playlist" as wo audio do'
    ));
    const day = new Date();
    const dayStamp = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
    const outDir = path.join(tmpDir, "artifacts", dayStamp);
    const outPath = path.join(outDir, "download.mock");
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "ok");
    assert.equal(result?.value?.filename, outDir);
  } finally {
    process.chdir(originalCwd);
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("download http uses library fresh cache by default", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-cache-"));
  const worldRoot = path.join(tmpDir, "world");
  const out1 = path.join(tmpDir, "first.txt");
  const out2 = path.join(tmpDir, "second.txt");
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  try {
    await interpret(parse(`exists su name world root ob filename "${worldRoot}" be default ya`));
    process.env.PYA_DOWNLOAD_RESPONSE = "cached";
    await interpret(parse(`be download from filename "https://example.com/cached.txt" as wo web to filename "${out1}" do`));
    delete process.env.PYA_DOWNLOAD_RESPONSE;
    await interpret(parse(`be download from filename "https://example.com/cached.txt" as wo web to filename "${out2}" do`));
    assert.equal(await fs.readFile(out1, "utf8"), "cached");
    assert.equal(await fs.readFile(out2, "utf8"), "cached");
    const cacheDir = path.join(worldRoot, "library", "fresh");
    const entries = await fs.readdir(cacheDir);
    assert.ok(entries.length >= 1);
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("download no cache override bypasses fresh cache", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-nocache-"));
  const worldRoot = path.join(tmpDir, "world");
  const out1 = path.join(tmpDir, "first.txt");
  const out2 = path.join(tmpDir, "second.txt");
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  try {
    await interpret(parse(`exists su name world root ob filename "${worldRoot}" be default ya`));
    process.env.PYA_DOWNLOAD_RESPONSE = "first";
    await interpret(parse(`be download from filename "https://example.com/nocache.txt" as wo web to filename "${out1}" do`));
    await interpret(parse("exists su name download no cache ob bool truth be default ya"));
    process.env.PYA_DOWNLOAD_RESPONSE = "second";
    await interpret(parse(`be download from filename "https://example.com/nocache.txt" as wo web to filename "${out2}" do`));
    assert.equal(await fs.readFile(out1, "utf8"), "first");
    assert.equal(await fs.readFile(out2, "utf8"), "second");
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});
