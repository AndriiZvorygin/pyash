import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildProgram } from "../program/program.mjs";
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

test("compile Pyash text codelets through VLIW to a Sysh-shaped NASM hello world", async () => {
  forget();
  const source = await fs.readFile("examples/pyash/nasm-hello-world.pya", "utf8");
  const { sentences } = buildProgram(source);
  const codelets = lowerParagraph(sentences);
  const pack = encodePyacPack(codelets);

  await withTempDirectory(async (directory) => {
    const packPath = path.join(directory, "hello.pyac");
    const asmPath = path.join(directory, "hello.asm");
    const objectPath = path.join(directory, "hello.o");
    const executablePath = path.join(directory, "hello");
    await fs.writeFile(packPath, pack);

    await interpret(parse(
      `from filename "${packPath}" fromstate pyac tostate nasm to filename "${asmPath}" be compile do`
    ));

    const assembly = await fs.readFile(asmPath, "utf8");
    assert.match(assembly, /vliw_program:/);
    assert.match(assembly, /pattern_dispatch_table:/);
    assert.match(assembly, /call codeGet/);
    assert.match(assembly, /call eax/);

    await execFileAsync("nasm", ["-f", "elf", "-o", objectPath, asmPath], { timeout: 120000 });
    await execFileAsync("ld", ["-m", "elf_i386", "-o", executablePath, objectPath], { timeout: 120000 });
    const { stdout } = await execFileAsync(executablePath, [], { timeout: 120000 });
    assert.equal(stdout, "Hello, world!");
  });
});

test("NASM VLIW compiler rejects semantics without a target handler", () => {
  const codelets = lowerParagraph([parse("ob num 1 to num 1 be plus do")]);
  assert.throws(
    () => compilePyacPackToNasm(encodePyacPack(codelets)),
    (error) => error.code === "unsupported-codelet" && /numeric-plus/.test(error.message)
  );
});
