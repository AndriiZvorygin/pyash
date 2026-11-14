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
    "section .rodata                     ; read-only VLIW program and text constants",
    "align 2                             ; align the following uint16 codelet words",
    "vliw_program:                       ; ESI begins here and advances by sentence",
    "    ; Every following dw row is one 16-word vector: bitmap header, then 15 payload words.",
    ...codeletLines.map((line, index) => line
      + " ; VLIW vector " + (index + 1)
      + ": 16 uint16 words, word 0 is the boundary bitmap, words 1-15 are payload"),
    "",
    "    ; Text labels hold UTF-8 bytes referenced by sentence execution records.",
    ...textLines.map((line) => line + " ; stored constant for a named text value"),
    "newline: db 10                     ; line-feed byte appended by the write handler",
    "",
    "section .data                       ; tables read by the dispatcher",
    "pattern_dispatch_table:             ; each row maps a canonical pattern id to a handler",
    ...dispatchLines.flat().map((line) => line.startsWith("    dd ")
      ? line + " ; pattern id and handler address"
      : line),
    "    dd 0, 0                          ; zero pattern id marks the end of this lookup table",
    "instruction_dispatch_table:         ; each row: pattern id, value pointer, byte length, VLIW byte advance",
    ...instructionLines.flatMap((lines, index) => [
      lines[0] + " ; execution record " + (index + 1) + " contains the fields named above"
    ]),
    "",
    "section .text                       ; executable 32-bit Linux code",
    "global _start                       ; process entry point referenced by the linker",
    "_start:                             ; initialize the interpreter's working registers",
    "    mov esi, vliw_program             ; program instruction pointer",
    "    mov edi, instruction_dispatch_table ; current sentence execution record",
    "    ; The next instruction loads the number of sentence records generated for this program.",
    `    mov ecx, ${instructions.length} ; remaining sentence count`,
    "execution_loop:                     ; dispatch one sentence on every pass",
    "    test ecx, ecx                    ; check whether any sentence records remain",
    "    jz execution_done                ; leave the loop when the count is zero",
    "    push ecx                         ; preserve remaining count across the handler call",
    "    push esi                         ; preserve current VLIW instruction pointer",
    "    push edi                         ; preserve current execution-record pointer",
    "    mov eax, [edi]                    ; EAX = this sentence's canonical pattern id",
    "    call codeGet                     ; look up the handler address for that pattern",
    "    test eax, eax                    ; check if the lookup returned a handler",
    "    jz dispatch_error               ; fail rather than call a missing handler",
    "    push dword [edi + 8]             ; push text byte length as handler argument 2",
    "    push dword [edi + 4]             ; push text pointer/state as handler argument 1",
    "    call eax                         ; execute the sentence's selected handler",
    "    pop edi                          ; restore execution-record pointer",
    "    pop esi                          ; restore VLIW instruction pointer",
    "    pop ecx                          ; restore remaining sentence count",
    "    add esi, [edi + 12]              ; advance past this sentence's VLIW vectors",
    "    add edi, 16                      ; move to the next four-dword record (16 bytes)",
    "    dec ecx                          ; count this sentence as complete",
    "    jmp execution_loop               ; dispatch the next sentence",
    "execution_done:                     ; all sentences completed successfully",
    "    xor ebx, ebx                     ; Linux process exit status 0",
    "    jmp good_exit                    ; terminate through the shared exit path",
    "dispatch_error:                     ; pattern lookup failed",
    "    mov ebx, 1                       ; Linux process exit status 1",
    "good_exit:                           ; Linux i386 process exit syscall",
    "    mov eax, 1                       ; syscall number 1 means exit",
    "    int 0x80                         ; enter kernel with exit status in EBX",
    "",
    "; Sysh codeGet shape: dictionary key in eax, handler address returned in eax.",
    "codeGet:                            ; look up EAX pattern id and return handler in EAX",
    "    push ebx                         ; preserve EBX before using it as the table cursor",
    "    mov ebx, pattern_dispatch_table  ; start at the first id/handler row",
    "codeGet_loop:                       ; inspect one eight-byte table row",
    "    cmp dword [ebx], 0              ; check for the zero-id end marker",
    "    je codeGet_missing              ; stop if no matching row remains",
    "    cmp eax, [ebx]                  ; compare requested id against this row's id",
    "    je codeGet_found                ; return the handler when ids match",
    "    add ebx, 8                      ; advance to the next pair of 32-bit fields",
    "    jmp codeGet_loop                ; continue scanning",
    "codeGet_found:                     ; matching row found",
    "    mov eax, [ebx + 4]              ; load the handler address from the row",
    "    pop ebx                         ; restore the caller's EBX",
    "    ret                             ; return the handler address",
    "codeGet_missing:                   ; no registered handler matched the id",
    "    xor eax, eax                    ; return a null handler marker",
    "    pop ebx                         ; restore the caller's EBX",
    "    ret                             ; let the dispatcher take its error path",
    "",
    "; Caller pushes length then pointer, so handlers see pointer at [esp+4] and length at [esp+8].",
    "sysh_declare_text_handler:          ; declaration only: retain the constant, produce no output",
    "    pop eax                          ; save the return address above the arguments",
    "    pop ebx                          ; remove text pointer argument",
    "    pop ebx                          ; remove text length argument",
    "    push eax                         ; restore the return address",
    "    ret                              ; return without printing a declaration",
    "sysh_text_handler:                  ; legacy text output handler without a trailing newline",
    "    mov edx, [esp + 8]               ; EDX = text byte count",
    "    mov ecx, [esp + 4]               ; ECX = address of text bytes",
    "    call sysh_say                    ; write the text bytes to standard output",
    "    pop eax                          ; save return address before cleaning arguments",
    "    pop ebx                          ; remove text pointer argument",
    "    pop ebx                          ; remove text length argument",
    "    push eax                         ; restore return address for ret",
    "    ret                              ; return with arguments consumed",
    "sysh_text_line_handler:             ; write handler: output text and then one line feed",
    "    mov edx, [esp + 8]               ; EDX = text byte count",
    "    mov ecx, [esp + 4]               ; ECX = address of declared text",
    "    call sysh_say                    ; write the text bytes",
    "    mov edx, 1                       ; EDX = line-feed byte count",
    "    mov ecx, newline                 ; ECX = address of line-feed byte",
    "    call sysh_say                    ; write the line feed",
    "    pop eax                          ; save return address before cleaning arguments",
    "    pop ebx                          ; remove text pointer argument",
    "    pop ebx                          ; remove text length argument",
    "    push eax                         ; restore return address for ret",
    "    ret                              ; return with arguments consumed",
    "sysh_say:                           ; Linux i386 write(fd, buffer, length) syscall wrapper",
    "    mov ebx, 1                       ; EBX = file descriptor 1 (standard output)",
    "    mov eax, 4                       ; EAX = Linux i386 syscall number for write",
    "    int 0x80                         ; write ECX bytes for EDX length to EBX",
    "    ret                              ; return to the text handler",
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
