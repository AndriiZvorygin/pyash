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
  return {
    words: Array.from(words),
    patternKey: patternKeyFor(decoded.sentence, codeletIndex),
    handler: "sysh_text_handler",
    label: `text_value_${codeletIndex}`,
    text: Buffer.from(decoded.sentence.ob.text, "utf8"),
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

function assemblyFor(instructions, programVectors = instructions.map((instruction) => [instruction.words])) {
  const patternKeys = [...new Set(instructions.map((instruction) => instruction.patternKey))].sort();
  const patternIds = new Map(patternKeys.map((key, index) => [key, index + 1]));
  const codeletLines = programVectors.flatMap((group) => group.map((vector) =>
    `    dw ${Array.from(vector).map((word) => `0x${word.toString(16).padStart(4, "0")}`).join(", ")}`
  ));
  const textLines = instructions.flatMap((instruction) => instruction.text === null
    ? []
    : [`${instruction.label}: db ${dataBytes(instruction.text)}`]);
  const instructionLines = instructions.map((instruction) => [
    `    dd ${patternIds.get(instruction.patternKey)}, ${instruction.label}, ${instruction.textLength ?? instruction.text.length}, ${instruction.advanceBytes}`
  ]);
  const dispatchLines = patternKeys.map((key, index) => {
    const handler = instructions.find((instruction) => instruction.patternKey === key).handler;
    return [`    ; ${key}`, `    dd ${index + 1}, ${handler}`];
  });

  return [
    "; Generated by Pyash from canonical 16-word VLIW codelets.",
    "; Sentence patterns dispatch through a Sysh-shaped lookup and handler call.",
    "bits 32",
    "",
    "section .rodata",
    "align 2",
    "vliw_program:",
    ...codeletLines,
    "",
    ...textLines,
    "newline: db 10",
    "",
    "section .data",
    "pattern_dispatch_table:",
    ...dispatchLines.flat(),
    "    dd 0, 0",
    "instruction_dispatch_table:",
    ...instructionLines.flat(),
    "",
    "section .text",
    "global _start",
    "_start:",
    "    mov esi, vliw_program             ; program instruction pointer",
    "    mov edi, instruction_dispatch_table",
    `    mov ecx, ${instructions.length}`,
    "execution_loop:",
    "    test ecx, ecx",
    "    jz execution_done",
    "    push ecx",
    "    push esi",
    "    push edi",
    "    mov eax, [edi]                    ; canonical sentence-pattern id",
    "    call codeGet                     ; resolve handler address",
    "    test eax, eax",
    "    jz dispatch_error",
    "    push dword [edi + 8]             ; text byte length",
    "    push dword [edi + 4]             ; text value or named state",
    "    call eax                         ; Sysh-style indirect handler call",
    "    pop edi",
    "    pop esi",
    "    pop ecx",
    "    add esi, [edi + 12]              ; advance by this sentence's VLIW vectors",
    "    add edi, 16",
    "    dec ecx",
    "    jmp execution_loop",
    "execution_done:",
    "    xor ebx, ebx",
    "    jmp good_exit",
    "dispatch_error:",
    "    mov ebx, 1",
    "good_exit:",
    "    mov eax, 1",
    "    int 0x80",
    "",
    "; Sysh codeGet shape: dictionary key in eax, handler address returned in eax.",
    "codeGet:",
    "    push ebx",
    "    mov ebx, pattern_dispatch_table",
    "codeGet_loop:",
    "    cmp dword [ebx], 0",
    "    je codeGet_missing",
    "    cmp eax, [ebx]",
    "    je codeGet_found",
    "    add ebx, 8",
    "    jmp codeGet_loop",
    "codeGet_found:",
    "    mov eax, [ebx + 4]",
    "    pop ebx",
    "    ret",
    "codeGet_missing:",
    "    xor eax, eax",
    "    pop ebx",
    "    ret",
    "",
    "; Caller pushes length then pointer; handlers consume both arguments.",
    "sysh_declare_text_handler:",
    "    pop eax",
    "    pop ebx",
    "    pop ebx",
    "    push eax",
    "    ret",
    "sysh_text_handler:",
    "    mov edx, [esp + 8]",
    "    mov ecx, [esp + 4]",
    "    call sysh_say",
    "    pop eax",
    "    pop ebx",
    "    pop ebx",
    "    push eax",
    "    ret",
    "sysh_text_line_handler:",
    "    mov edx, [esp + 8]",
    "    mov ecx, [esp + 4]",
    "    call sysh_say",
    "    mov edx, 1",
    "    mov ecx, newline",
    "    call sysh_say",
    "    pop eax",
    "    pop ebx",
    "    pop ebx",
    "    push eax",
    "    ret",
    "sysh_say:",
    "    mov ebx, 1",
    "    mov eax, 4",
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
    return assemblyFor(lowerNamedTextProgram(program, groups), groups);
  }

  const instructions = pack.codelets.map(lowerLegacyTextCodelet);
  return assemblyFor(instructions, pack.codelets.map((vector) => [vector]));
}
