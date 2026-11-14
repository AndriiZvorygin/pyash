import {
  decodeCodelet,
  decodePyashProgramOrNull,
  scheduleCodeletDependencies
} from "../vliw/index.mjs";
import { decodePyacPack } from "../vliw/database.mjs";
import { transpileProgram } from "./transpile_program.mjs";

const VECTOR_CAPACITY = 16;

export class PyacCCompileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PyacCCompileError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PyacCCompileError(code, message, details);
}

function cString(value) {
  const bytes = Buffer.from(String(value), "utf8");
  return `"${Array.from(bytes, (byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("")}"`;
}

function requireNumber(value, codeletIndex, role) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    fail("invalid-numeric-codelet", `PyAC codelet ${codeletIndex} has an invalid ${role}`, {
      codeletIndex,
      role,
      value
    });
  }
  return value;
}

function namedStateIndex(stateSlots, name, codeletIndex) {
  const index = stateSlots.get(name);
  if (index === undefined) {
    fail("unfulfilled-reference", `PyAC codelet ${codeletIndex} references an uninitialized name (${name})`, {
      codeletIndex,
      name
    });
  }
  return index;
}

function arithmeticExpression(verb, left, right) {
  switch (verb) {
    case "plus":
      return `pya_vliw_add(${left}, ${right})`;
    case "subtract":
      return `((${left}) > (${right}) ? (int64_t)((${left}) - (${right})) : INT64_C(0))`;
    case "multiply":
      return `((int64_t)(${left}) * (int64_t)(${right}))`;
    case "divide":
      return `pya_vliw_divide(${left}, ${right})`;
    case "xor":
      return `((int64_t)((uint16_t)(${left}) ^ (uint16_t)(${right})))`;
    case "exponential":
      return `pya_vliw_power(${left}, ${right})`;
    case "remains":
      return `pya_vliw_remains(${left}, ${right})`;
    default:
      return null;
  }
}

function lowerCodelet(decoded, codeletIndex, stateSlots) {
  const sentence = decoded.sentence;
  const result = `pya_result_${codeletIndex}`;
  const named = sentence?.su?.name;

  if (decoded.semantic === "typed-literal" || decoded.semantic === "named-literal") {
    if (sentence.be === "number") {
      const value = requireNumber(sentence.ob?.num, codeletIndex, "literal");
      const assignment = `${result} = pya_make_number(INT64_C(${value}), ${named ? cString(named) : "NULL"});`;
      if (decoded.semantic === "named-literal") {
        const index = namedStateIndex(stateSlots, named, codeletIndex);
        return [`${assignment}`, `pya_state_${index} = ${result};`];
      }
      return [assignment];
    }
    if (sentence.be === "text" && typeof sentence.ob?.text === "string") {
      const text = cString(sentence.ob.text);
      const assignment = `${result} = pya_make_string(PYA_TEXT, ${text}, sizeof(${text}) - 1, ${named ? cString(named) : "NULL"});`;
      if (decoded.semantic === "named-literal") {
        const index = namedStateIndex(stateSlots, named, codeletIndex);
        return [assignment, `pya_state_${index} = ${result};`];
      }
      return [assignment];
    }
  }

  if (decoded.semantic === "boolean-literal") {
    return [`${result} = pya_make_boolean(${sentence.ob.boolean ? 1 : 0}, ${named ? cString(named) : "NULL"});`];
  }

  if (decoded.semantic === "date") {
    if (typeof sentence.ob?.date !== "string") {
      fail("invalid-date-codelet", `PyAC codelet ${codeletIndex} has an invalid date value`, { codeletIndex });
    }
    const date = cString(sentence.ob.date);
    return [`${result} = pya_make_string(PYA_DATE, ${date}, sizeof(${date}) - 1, ${named ? cString(named) : "NULL"});`];
  }

  if (decoded.semantic === "vector") {
    const vector = sentence.ob?.ve;
    if (!vector || !Array.isArray(vector.values) || vector.values.length > VECTOR_CAPACITY) {
      fail("invalid-vector-codelet", `PyAC codelet ${codeletIndex} has an invalid vector value`, {
        codeletIndex,
        length: vector?.values?.length ?? null
      });
    }
    if (vector.type === "num") {
      const values = vector.values.map((value) => requireNumber(value, codeletIndex, "vector element"));
      return [`${result} = pya_make_number_vector((int64_t[]){${values.join(", ")}}, ${values.length}, ${named ? cString(named) : "NULL"});`];
    }
    if (vector.type === "bool") {
      const values = vector.values.map((value) => {
        if (value !== "truth" && value !== "lie") {
          fail("invalid-vector-codelet", `PyAC codelet ${codeletIndex} has an invalid boolean vector element`, {
            codeletIndex,
            value
          });
        }
        return value === "truth" ? 1 : 0;
      });
      return [`${result} = pya_make_boolean_vector((int64_t[]){${values.join(", ")}}, ${values.length}, ${named ? cString(named) : "NULL"});`];
    }
    if (vector.type === "text" && vector.values.every((value) => typeof value === "string")) {
      const values = vector.values.map(cString);
      const lengths = values.map((value) => `sizeof(${value}) - 1`);
      return [`${result} = pya_make_text_vector((const char *const[]){${values.join(", ")}}, (const size_t[]){${lengths.join(", ")}}, ${values.length}, ${named ? cString(named) : "NULL"});`];
    }
    fail("unsupported-vector-codelet", `PyAC codelet ${codeletIndex} has an unsupported vector type`, {
      codeletIndex,
      type: vector.type
    });
  }

  if (decoded.semantic === "numeric-invert") {
    const value = requireNumber(sentence.ob?.num, codeletIndex, "invert operand");
    return [`${result} = pya_make_number(-INT64_C(${value}), "result");`];
  }

  if (decoded.semantic === "numeric-plus" || decoded.semantic === "numeric-arithmetic") {
    const left = requireNumber(sentence.ob?.num, codeletIndex, "left operand");
    if (decoded.semantic === "numeric-arithmetic") {
      const role = ["to", "from", "with", "by"].find((candidate) => sentence[candidate] !== undefined);
      if (!role) {
        fail("invalid-numeric-codelet", `PyAC codelet ${codeletIndex} has no right operand`, { codeletIndex });
      }
      const operand = sentence[role];
      if (typeof operand?.name === "string") {
        if (sentence.be !== "subtract") {
          fail("unsupported-codelet", `PyAC codelet ${codeletIndex} has an unsupported named operand`, {
            codeletIndex,
            semantic: decoded.semantic,
            verb: sentence.be,
            role
          });
        }
        const stateIndex = namedStateIndex(stateSlots, operand.name, codeletIndex);
        return [
          `if (pya_state_${stateIndex}.kind != PYA_NUMBER) { fputs("unfulfilled-reference\\n", stderr); return 1; }`,
          `pya_state_${stateIndex}.number -= INT64_C(${left});`,
          `${result} = pya_make_number(pya_state_${stateIndex}.number, "result");`
        ];
      }
      const right = requireNumber(operand?.num, codeletIndex, "right operand");
      const expression = arithmeticExpression(sentence.be, `INT64_C(${left})`, `INT64_C(${right})`);
      if (!expression) {
        fail("unsupported-codelet", `PyAC codelet ${codeletIndex} has an unsupported operator (${sentence.be})`, {
          codeletIndex,
          semantic: decoded.semantic,
          verb: sentence.be
        });
      }
      return [`${result} = pya_make_number(${expression}, "result");`];
    }

    const right = requireNumber(sentence.to?.num, codeletIndex, "right operand");
    return [`${result} = pya_make_number(${arithmeticExpression("plus", `INT64_C(${left})`, `INT64_C(${right})`)}, "result");`];
  }

  if (decoded.semantic === "named-query") {
    const index = namedStateIndex(stateSlots, sentence.su.name, codeletIndex);
    return [`${result} = pya_state_${index};`];
  }

  fail("unsupported-codelet", `PyAC codelet ${codeletIndex} has no C lowering (${decoded.semantic})`, {
    codeletIndex,
    semantic: decoded.semantic
  });
}

function cRuntime() {
  return [
    "#include <stdint.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <string.h>",
    "",
    `#define PYA_VECTOR_CAPACITY ${VECTOR_CAPACITY}`,
    "enum { PYA_NUMBER, PYA_TEXT, PYA_BOOLEAN, PYA_DATE, PYA_NUMBER_VECTOR, PYA_BOOLEAN_VECTOR, PYA_TEXT_VECTOR };",
    "typedef struct {",
    "  int kind;",
    "  const char *name;",
    "  int64_t number;",
    "  const char *text;",
    "  size_t text_length;",
    "  size_t length;",
    "  int64_t numbers[PYA_VECTOR_CAPACITY];",
    "  const char *strings[PYA_VECTOR_CAPACITY];",
    "  size_t string_lengths[PYA_VECTOR_CAPACITY];",
    "} pya_value;",
    "",
    "static inline pya_value pya_make_number(int64_t number, const char *name) {",
    "  pya_value value = {0}; value.kind = PYA_NUMBER; value.name = name; value.number = number; return value;",
    "}",
    "static inline pya_value pya_make_boolean(int boolean, const char *name) {",
    "  pya_value value = {0}; value.kind = PYA_BOOLEAN; value.name = name; value.number = boolean != 0; return value;",
    "}",
    "static inline pya_value pya_make_string(int kind, const char *text, size_t length, const char *name) {",
    "  pya_value value = {0}; value.kind = kind; value.name = name; value.text = text; value.text_length = length; return value;",
    "}",
    "static inline pya_value pya_make_number_vector(const int64_t *items, size_t length, const char *name) {",
    "  pya_value value = {0}; value.kind = PYA_NUMBER_VECTOR; value.name = name; value.length = length;",
    "  for (size_t i = 0; i < length; ++i) { value.numbers[i] = items[i]; }",
    "  return value;",
    "}",
    "static inline pya_value pya_make_boolean_vector(const int64_t *items, size_t length, const char *name) {",
    "  pya_value value = {0}; value.kind = PYA_BOOLEAN_VECTOR; value.name = name; value.length = length;",
    "  for (size_t i = 0; i < length; ++i) { value.numbers[i] = items[i] != 0; }",
    "  return value;",
    "}",
    "static inline pya_value pya_make_text_vector(const char *const *items, const size_t *lengths, size_t length, const char *name) {",
    "  pya_value value = {0}; value.kind = PYA_TEXT_VECTOR; value.name = name; value.length = length;",
    "  for (size_t i = 0; i < length; ++i) { value.strings[i] = items[i]; value.string_lengths[i] = lengths[i]; } return value;",
    "}",
    "static inline uint16_t pya_vliw_add(uint16_t left, uint16_t right) {",
    "  uint32_t sum = (uint32_t)left + (uint32_t)right; return (uint16_t)(sum > UINT16_MAX ? UINT16_MAX : sum);",
    "}",
    "static inline int64_t pya_vliw_divide(uint16_t left, uint16_t right) {",
    "  if (right == 0) { fputs(\"division-by-zero\\n\", stderr); exit(1); } return left / right;",
    "}",
    "static inline int64_t pya_vliw_remains(uint16_t left, uint16_t right) {",
    "  if (right == 0) { fputs(\"division-by-zero\\n\", stderr); exit(1); } return left % right;",
    "}",
    "static inline uint16_t pya_vliw_power(uint16_t base, uint16_t exponent) {",
    "  uint32_t value = 1; for (uint16_t i = 0; i < exponent; ++i) {",
    "    if (base != 0 && value > UINT16_MAX / base) return UINT16_MAX;",
    "    value *= base;",
    "  } return (uint16_t)value;",
    "}",
    "static inline void pya_json_string(const char *text, size_t length) {",
    "  putchar('\\\"');",
    "  for (size_t i = 0; i < length; ++i) { unsigned char c = (unsigned char)text[i];",
    "    switch (c) { case '\\\"': fputs(\"\\\\\\\\\\\"\", stdout); break; case '\\\\\': fputs(\"\\\\\\\\\\\\\", stdout); break;",
    "      case '\\b': fputs(\"\\\\b\", stdout); break; case '\\f': fputs(\"\\\\f\", stdout); break;",
    "      case '\\n': fputs(\"\\\\n\", stdout); break; case '\\r': fputs(\"\\\\r\", stdout); break; case '\\t': fputs(\"\\\\t\", stdout); break;",
    "      default: if (c < 0x20) printf(\"\\\\u%04x\", c); else putchar(c); break; }",
    "  } putchar('\\\"');",
    "}",
    "static inline void pya_print_value(const pya_value *value) {",
    "  putchar('{');",
    "  if (value->name) { fputs(\"\\\"su\\\":{\\\"name\\\":\", stdout); pya_json_string(value->name, strlen(value->name)); putchar('}'); putchar(','); }",
    "  switch (value->kind) {",
    "    case PYA_NUMBER: printf(\"\\\"ob\\\":{\\\"num\\\":%lld},\\\"be\\\":\\\"number\\\",\\\"mood\\\":\\\"ya\\\"\", (long long)value->number); break;",
    "    case PYA_TEXT: fputs(\"\\\"ob\\\":{\\\"text\\\":\", stdout); pya_json_string(value->text, value->text_length); fputs(\"},\\\"be\\\":\\\"text\\\",\\\"mood\\\":\\\"ya\\\"\", stdout); break;",
    "    case PYA_BOOLEAN: printf(\"\\\"ob\\\":{\\\"boolean\\\":%s},\\\"mood\\\":\\\"ya\\\"\", value->number ? \"true\" : \"false\"); break;",
    "    case PYA_DATE: fputs(\"\\\"ob\\\":{\\\"date\\\":\", stdout); pya_json_string(value->text, value->text_length); fputs(\"},\\\"be\\\":\\\"date\\\",\\\"mood\\\":\\\"ya\\\"\", stdout); break;",
    "    case PYA_NUMBER_VECTOR: case PYA_BOOLEAN_VECTOR: case PYA_TEXT_VECTOR:",
    "      fputs(\"\\\"ob\\\":{\\\"ve\\\":{\\\"type\\\":\", stdout);",
    "      pya_json_string(value->kind == PYA_NUMBER_VECTOR ? \"num\" : value->kind == PYA_BOOLEAN_VECTOR ? \"bool\" : \"text\", value->kind == PYA_TEXT_VECTOR ? 4 : value->kind == PYA_BOOLEAN_VECTOR ? 4 : 3);",
    "      fputs(\",\\\"values\\\":[\", stdout);",
    "      for (size_t i = 0; i < value->length; ++i) { if (i) putchar(',');",
    "        if (value->kind == PYA_TEXT_VECTOR) pya_json_string(value->strings[i], value->string_lengths[i]);",
    "        else if (value->kind == PYA_BOOLEAN_VECTOR) fputs(value->numbers[i] ? \"\\\"truth\\\"\" : \"\\\"lie\\\"\", stdout);",
    "        else printf(\"%lld\", (long long)value->numbers[i]);",
    "      } fputs(\"]}},\\\"be\\\":\\\"vector\\\",\\\"mood\\\":\\\"ya\\\"\", stdout); break;",
    "    default: fputs(\"\\\"ob\\\":null,\\\"mood\\\":\\\"ya\\\"\", stdout); break;",
    "  } putchar('}'); putchar('\\n');",
    "}",
    ""
  ];
}

function cSourceFor(codelets) {
  let schedule;
  try {
    schedule = scheduleCodeletDependencies(codelets);
  } catch (error) {
    fail(error?.code ?? "invalid-dependencies", `compile: VLIW dependency schedule failed: ${error?.message ?? String(error)}`, {
      cause: error?.code ?? null,
      details: error?.details ?? null
    });
  }

  const stateSlots = new Map();
  for (const decoded of codelets) {
    if (decoded.semantic === "named-literal" && !stateSlots.has(decoded.sentence.su.name)) {
      stateSlots.set(decoded.sentence.su.name, stateSlots.size);
    }
  }
  const statements = [];
  for (const entry of schedule) {
    statements.push(...lowerCodelet(entry.instruction, entry.index, stateSlots));
  }

  return [
    "/* Generated by Pyash compile from the 16-word PyAC VLIW representation. */",
    ...cRuntime(),
    "int main(void) {",
    ...[...stateSlots.values()].map((index) => `  pya_value pya_state_${index} = {0};`),
    ...codelets.map((_, index) => `  pya_value pya_result_${index} = {0};`),
    ...statements.map((statement) => `  ${statement}`),
    ...codelets.flatMap((codelet, index) => (
      codelet.semantic === "named-literal" ? [] : [`  pya_print_value(&pya_result_${index});`]
    )),
    "  return 0;",
    "}",
    ""
  ].join("\n");
}

function restoreInitialNamedDeclarations(sentences) {
  const declared = new Set();
  return sentences.map((sentence) => {
    const name = sentence?.su?.name;
    if (sentence?.mood !== "ya" || typeof name !== "string") return sentence;
    if (declared.has(name)) return sentence;
    declared.add(name);
    return { ...sentence, exists: true };
  });
}

export function compilePyacPackToC(input) {
  let pack;
  try {
    pack = decodePyacPack(input);
  } catch (error) {
    fail(
      error?.code ?? "invalid-pyac-pack",
      `compile: invalid PyAC pack: ${error?.message ?? String(error)}`,
      { cause: error?.code ?? null, details: error?.details ?? null }
    );
  }

  const hasExistingSemanticAdapter = pack.codelets.some((words) => {
    try {
      decodeCodelet(words);
      return true;
    } catch (error) {
      if (error?.name !== "VliwCodeletError") throw error;
      return false;
    }
  });
  const pyashProgram = hasExistingSemanticAdapter
    ? null
    : decodePyashProgramOrNull(pack.codelets);
  if (pyashProgram) {
    return transpileProgram(restoreInitialNamedDeclarations(pyashProgram), { lang: "c" });
  }

  const codelets = pack.codelets.map((words, index) => {
    try {
      return decodeCodelet(words);
    } catch (error) {
      fail(
        error?.code ?? "invalid-codelet",
        `compile: PyAC codelet ${index} is invalid: ${error?.message ?? String(error)}`,
        { codeletIndex: index, cause: error?.code ?? null, details: error?.details ?? null }
      );
    }
  });

  return cSourceFor(codelets);
}
