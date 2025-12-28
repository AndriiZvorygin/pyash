import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("c ir parser emits stable pyash surface", async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-ir-"));
  const cPath = path.join(outDir, "out.c");
  const exePath = path.join(outDir, "out");

  const program = [
    "#include <stdio.h>",
    "#include \"program/runtime/c_ir.h\"",
    "#include \"program/runtime/c_ir_parse.h\"",
    "int main(void) {",
    "  char err[128] = {0};",
    "  pya_sentence sentence = {0};",
    "  if (!pya_parse_sentence(\"exists su name alpha ob num 1 be number ya\", &sentence, err, sizeof(err))) {",
    "    fprintf(stderr, \"%s\\n\", err);",
    "    return 1;",
    "  }",
    "  pya_emit_sentence(stdout, &sentence);",
    "  pya_free_sentence(&sentence);",
    "  pya_sentence sentence2 = {0};",
    "  if (!pya_parse_sentence(\"ob this ti ob ti num be test do\", &sentence2, err, sizeof(err))) {",
    "    fprintf(stderr, \"%s\\n\", err);",
    "    return 1;",
    "  }",
    "  pya_emit_sentence(stdout, &sentence2);",
    "  pya_free_sentence(&sentence2);",
    "  return 0;",
    "}"
  ].join("\n");

  await fs.writeFile(cPath, program, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-I.", "-o", exePath, cPath, "program/runtime/c_ir.c", "program/runtime/c_ir_parse.c"], { cwd: path.resolve("."), timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });

  const lines = stdout.trim().split(/\n/);
  assert.deepEqual(lines, [
    "exists ob num 1 su name alpha be number ya",
    "ob this ti ob ti num be test do"
  ]);
});
