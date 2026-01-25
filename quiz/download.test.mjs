import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

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

test("download without to filename defaults to cwd basename", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-download-"));
  const originalCwd = process.cwd();
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "ok";
  try {
    process.chdir(tmpDir);
    await interpret(parse(
      'be download from filename "https://example.com/file.txt" as wo web do'
    ));
    const outPath = path.join(tmpDir, "file.txt");
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "ok");
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
    const outPath = path.join(tmpDir, "download.mock");
    const content = await fs.readFile(outPath, "utf8");
    assert.equal(content, "ok");
    assert.equal(result?.value?.filename, tmpDir);
  } finally {
    process.chdir(originalCwd);
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});
