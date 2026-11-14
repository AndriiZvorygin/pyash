import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import {
  encodePyacPack,
  lowerParagraph
} from "../program/library/vliw/index.mjs";
import { compilePyacPackToNasm } from "../program/library/compile/pyac_to_nasm.mjs";

const execFileAsync = promisify(execFile);

async function withTempDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-pyac-nasm-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function compileAndRun(sourcePath, executablePath, compiler, args) {
  await execFileAsync(compiler, [...args, "-o", executablePath, sourcePath], { timeout: 120000 });
  return (await execFileAsync(executablePath, [], { timeout: 120000 })).stdout;
}

async function assembleAndRun(assemblyPath, directory, executableName) {
  const objectPath = path.join(directory, `${executableName}.o`);
  const executablePath = path.join(directory, executableName);
  await execFileAsync("nasm", ["-f", "elf", "-o", objectPath, assemblyPath], { timeout: 120000 });
  await execFileAsync("ld", ["-m", "elf_i386", "-o", executablePath, objectPath], { timeout: 120000 });
  return (await execFileAsync(executablePath, [], { timeout: 120000 })).stdout;
}

test("one explicit Pyash hello-world program compiles to JS, C, VLIW C, and direct VLIW NASM", async () => {
  forget();
  const source = await fs.readFile("examples/pyash/nasm-hello-world.pya", "utf8");

  await withTempDirectory(async (directory) => {
    const jsPath = path.join(directory, "hello.mjs");
    const regularCPath = path.join(directory, "hello.c");
    const sourcePath = path.resolve("examples/pyash/nasm-hello-world.pya");
    forget();
    await interpret(parse(
      `from filename "${sourcePath}" fromstate pyash tostate javascript to filename "${jsPath}" be compile do`
    ));
    assert.equal((await execFileAsync("node", [jsPath])).stdout, "Hello, world!\n");
    forget();
    await interpret(parse(
      `from filename "${sourcePath}" fromstate pyash tostate c to filename "${regularCPath}" be compile do`
    ));
    assert.equal(await compileAndRun(regularCPath, path.join(directory, "hello-c"), "cc", ["-std=c11"]), "Hello, world!\n");

    const packPath = path.join(directory, "hello.pyac");
    const cPath = path.join(directory, "hello-vliw.c");
    const asmPath = path.join(directory, "hello-vliw.asm");
    forget();
    await interpret(parse(
      `from filename "${sourcePath}" fromstate pyash to filename "${packPath}" tostate pyac be compile do`
    ));
    const pack = new Uint8Array(await fs.readFile(packPath));
    assert.equal(new TextDecoder().decode(pack.slice(0, 8)), "PYACVLIW");
    assert.equal((pack.byteLength - 32) % 32, 0);

    forget();
    await interpret(parse(
      `from filename "${packPath}" fromstate pyac tostate c to filename "${cPath}" be compile do`
    ));
    assert.equal(await compileAndRun(cPath, path.join(directory, "hello-vliw-c"), "cc", ["-std=c11"]), "Hello, world!\n");

    forget();
    await interpret(parse(
      `from filename "${packPath}" fromstate pyac tostate nasm to filename "${asmPath}" be compile do`
    ));
    const assembly = await fs.readFile(asmPath, "utf8");
    assert.match(assembly, /ahead-of-time 32-bit x86 code/);
    assert.match(assembly, /call sysh_say/);
    assert.match(assembly, /UTF-8 byte length/);
    assert.doesNotMatch(assembly, /vliw_program:|pattern_dispatch_table:|call codeGet|call eax/);
    assert.equal(await assembleAndRun(asmPath, directory, "hello-nasm"), "Hello, world!\n");
  });
});

test("NASM VLIW compiler rejects semantics without a target handler", () => {
  const codelets = lowerParagraph([parse("ob num 1 to num 1 be plus do")]);
  assert.throws(
    () => compilePyacPackToNasm(encodePyacPack(codelets)),
    (error) => error.code === "unsupported-codelet" && /numeric-plus/.test(error.message)
  );
});

test("NASM legacy anonymous text literals keep their original concatenated output", async () => {
  const codelets = lowerParagraph([
    parse('ob text "Hello, " be text ya'),
    parse('ob text "world!" be text ya')
  ]);
  const assembly = compilePyacPackToNasm(encodePyacPack(codelets));
  await withTempDirectory(async (directory) => {
    const assemblyPath = path.join(directory, "legacy-hello.asm");
    await fs.writeFile(assemblyPath, assembly);
    assert.equal(await assembleAndRun(assemblyPath, directory, "legacy-hello"), "Hello, world!");
  });
});
