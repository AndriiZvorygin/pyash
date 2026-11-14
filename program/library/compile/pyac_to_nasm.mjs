import { decodeCodelet } from "../vliw/index.mjs";
import { decodePyacPack } from "../vliw/database.mjs";
import { decodePyashProgramOrNull } from "../vliw/sentence.mjs";
import { prepareSyshSentencePattern } from "./sysh_sentence_pattern.mjs";

export class PyacNasmCompileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PyacNasmCompileError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PyacNasmCompileError(code, message, details);
}

function dataBytes(bytes) {
  return bytes.length === 0 ? "0" : Array.from(bytes).join(", ");
}

function patternKeyFor(sentence, codeletIndex) {
  let pattern;
  try {
    pattern = prepareSyshSentencePattern(sentence);
  } catch (error) {
    fail("unsupported-sentence", `PyAC sentence ${codeletIndex} has no NASM dispatch pattern (${error.message})`, {
      codeletIndex
    });
  }
  if (pattern.unmappedCaseFields.length > 0) {
    fail("unmapped-sentence-case", `PyAC sentence ${codeletIndex} has unmapped sentence cases`, {
      codeletIndex,
      fields: pattern.unmappedCaseFields
    });
  }
  return pattern.patternKey;
}

function lowerLegacyTextCodelet(words, codeletIndex) {
  let decoded;
  try {
    decoded = decodeCodelet(words);
  } catch (error) {
    fail(error?.code ?? "invalid-codelet", `PyAC codelet ${codeletIndex} is invalid: ${error?.message ?? String(error)}`, {
      codeletIndex,
      cause: error?.code ?? null
    });
  }
  if (decoded.semantic !== "typed-literal" || decoded.sentence?.be !== "text" || typeof decoded.sentence?.ob?.text !== "string") {
    fail("unsupported-codelet", `PyAC codelet ${codeletIndex} has no NASM lowering (${decoded.semantic})`, {
      codeletIndex,
      semantic: decoded.semantic ?? null
    });
  }
  const text = Buffer.from(decoded.sentence.ob.text, "utf8");
  return {
    words: Array.from(words),
    patternKey: patternKeyFor(decoded.sentence, codeletIndex),
    handler: "sysh_text_handler",
    label: `text_value_${codeletIndex}`,
    text,
    textLength: text.length,
    advanceBytes: 32
  };
}

function sentenceGroups(vectors) {
  const groups = [];
  let group = [];
  for (const [index, vector] of vectors.entries()) {
    group.push(vector);
    if (vector[0] & 1) {
      groups.push(group);
      group = [];
    }
    if (index === vectors.length - 1 && group.length > 0) {
      fail("missing-continuation", "PyAC VLIW program ends in an incomplete sentence");
    }
  }
  return groups;
}

function lowerNamedTextProgram(sentences, groups) {
  if (groups.length !== sentences.length) {
    fail("sentence-vector-count", "PyAC sentence count does not match its VLIW codelet groups", {
      sentences: sentences.length,
      groups: groups.length
    });
  }

  const variables = new Map();
  const instructions = [];
  for (const [index, sentence] of sentences.entries()) {
    const words = groups[index].flatMap((vector) => Array.from(vector));
    const patternKey = patternKeyFor(sentence, index);
    if (
      sentence?.mood === "ya" &&
      sentence?.be === "text" &&
      typeof sentence?.su?.name === "string" &&
      typeof sentence?.ob?.text === "string"
    ) {
      if (variables.has(sentence.su.name)) {
        fail("duplicate-declaration", `PyAC NASM slice does not yet support reassignment of ${sentence.su.name}`, {
          codeletIndex: index,
          name: sentence.su.name
        });
      }
      const label = `text_value_${index}`;
      const text = Buffer.from(sentence.ob.text, "utf8");
      variables.set(sentence.su.name, { label, textLength: text.length });
      instructions.push({
        words,
        patternKey,
        handler: "sysh_declare_text_handler",
        label,
        text,
        advanceBytes: groups[index].length * 32
      });
      continue;
    }

    if (sentence?.mood === "do" && sentence?.be === "write" && typeof sentence?.ob?.name === "string") {
      const variable = variables.get(sentence.ob.name);
      if (!variable) {
        fail("unfulfilled-reference", `PyAC NASM sentence ${index} writes an undeclared text name (${sentence.ob.name})`, {
          codeletIndex: index,
          name: sentence.ob.name
        });
      }
      instructions.push({
        words,
        patternKey,
        handler: "sysh_text_line_handler",
        label: variable.label,
        text: null,
        textLength: variable.textLength,
        advanceBytes: groups[index].length * 32
      });
      continue;
    }

    fail("unsupported-codelet", `PyAC sentence ${index} has no NASM lowering (${sentence?.be ?? "unknown"})`, {
      codeletIndex: index,
      semantic: sentence?.be ?? null
    });
  }
  return instructions;
}

function assemblyFor(instructions) {
  const textLines = instructions.flatMap((instruction) => instruction.text === null
    ? []
    : [
      instruction.label + ": db " + dataBytes(instruction.text)
        + " ; UTF-8 bytes for " + JSON.stringify(instruction.text.toString("utf8"))
    ]);
  const outputLines = [];
  for (const [index, instruction] of instructions.entries()) {
    if (instruction.handler === "sysh_declare_text_handler") {
      outputLines.push("    ; sentence " + (index + 1) + " declares static text; no runtime instruction is needed");
      continue;
    }
    if (instruction.handler !== "sysh_text_handler" && instruction.handler !== "sysh_text_line_handler") {
      fail("unsupported-codelet", "NASM AOT lowering has no direct output for " + instruction.handler, {
        codeletIndex: index,
        handler: instruction.handler
      });
    }
    outputLines.push(
      "    mov ecx, " + instruction.label + " ; sentence " + (index + 1) + " text address",
      "    mov edx, " + instruction.textLength + " ; UTF-8 byte length",
      "    call sysh_say ; statically selected output helper"
    );
    if (instruction.handler === "sysh_text_line_handler") {
      outputLines.push(
        "    mov ecx, newline ; line-feed address",
        "    mov edx, 1 ; line-feed byte length",
        "    call sysh_say ; append the write sentence's newline"
      );
    }
  }

  return [
    "; Generated by Pyash as ahead-of-time 32-bit x86 code.",
    "; Sentence patterns are resolved during compilation; no VLIW dispatch loop is emitted.",
    "bits 32",
    "",
    "section .rodata ; static text constants used by native instructions",
    "align 2",
    ...textLines,
    "newline: db 10 ; line feed for the Pyash write operation",
    "",
    "section .text",
    "global _start",
    "_start: ; native program entry point",
    ...outputLines,
    "    mov ebx, 0 ; successful process exit status",
    "    mov eax, 1 ; Linux i386 exit syscall",
    "    int 0x80",
    "",
    "; Direct helper for Linux write(stdout, ECX, EDX).",
    "sysh_say:",
    "    mov ebx, 1 ; standard output file descriptor",
    "    mov eax, 4 ; Linux i386 write syscall",
    "    int 0x80",
    "    ret",
    ""
  ].join("\n");
}
export function compilePyacPackToNasm(input) {
  let pack;
  try {
    pack = decodePyacPack(input);
  } catch (error) {
    fail(error?.code ?? "invalid-pyac-pack", `invalid PyAC pack: ${error?.message ?? String(error)}`, {
      cause: error?.code ?? null
    });
  }
  if (pack.codelets.length === 0) fail("empty-program", "PyAC NASM compilation requires at least one codelet");

  const hasLegacySemanticAdapter = pack.codelets.some((words) => {
    try {
      decodeCodelet(words);
      return true;
    } catch (error) {
      if (error?.name !== "VliwCodeletError") throw error;
      return false;
    }
  });
  if (!hasLegacySemanticAdapter) {
    const program = decodePyashProgramOrNull(pack.codelets);
    if (!program) fail("unsupported-program", "PyAC NASM input is not a supported Pyash sentence program");
    const groups = sentenceGroups(pack.codelets);
    return assemblyFor(lowerNamedTextProgram(program, groups));
  }

  const instructions = pack.codelets.map(lowerLegacyTextCodelet);
  return assemblyFor(instructions);
}
