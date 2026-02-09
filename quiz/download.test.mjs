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
