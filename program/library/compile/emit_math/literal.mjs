// Literal-operand arithmetic with no named destination writes the `result`
// fact. The second operand may arrive in any operand case; per the VLIW ISA the
// phrase's case is just its actual case, and the decoder reads the HNUC without
// privileging one role. Operator semantics and zero guards follow
// program/verbs/mathematics.
const RIGHT_OPERAND_ROLES = ["to", "from", "with", "by"];

const OPERATORS = {
  plus: {
    expr: (left, right) => `(${left} + ${right})`
  },
  subtract: {
    expr: (left, right) => `(${left} - ${right})`
  },
  multiply: {
    expr: (left, right) => `(${left} * ${right})`
  },
  divide: {
    expr: (left, right) => `(${left} / ${right})`,
    guard: (right) => ({ zero: right, message: "divide: by cannot be zero" })
  },
  remains: {
    expr: (left, right) => `(${left} % ${right})`,
    cExpr: (left, right) => `fmod(${left}, ${right})`,
    guard: (right) => ({ zero: right, message: "remains: from cannot be zero" })
  },
  exponential: {
    expr: (left, right) => `(${left} ** ${right})`,
    cExpr: (left, right) => `pow(${left}, ${right})`
  },
  xor: {
    expr: (left, right) => `(${left} ^ ${right})`,
    cExpr: (left, right) => `((long)(${left}) ^ (long)(${right}))`
  }
};

function numericOperand(slot, { lang, locals, declared, sanitizeName }) {
  if (!slot) return null;
  if (slot.num !== undefined) {
    const value = Number(slot.num);
    return Number.isNaN(value) ? "0" : String(value);
  }
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (lang === "c") {
      if (locals?.has(name) || declared?.has(name) || declared?.has(slot.name)) return name;
      return null;
    }
    if (locals?.has(name) || declared?.has(name) || declared?.has(slot.name)) {
      return `${name}.ob?.num ?? ${name}`;
    }
    return null;
  }
  return null;
}

export function handleLiteralMath(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes } = context;
  const { sanitizeName, markDeclared } = helpers;
  const operator = OPERATORS[baseBe];
  if (!operator) return null;
  if (sentence.to?.name || sentence.to?.genitive) return null;
  const role = RIGHT_OPERAND_ROLES.find((name) => sentence[name] !== undefined);
  if (!role) return null;
  const left = numericOperand(sentence.ob, { lang, locals, declared, sanitizeName });
  const right = numericOperand(sentence[role], { lang, locals, declared, sanitizeName });
  if (left == null || right == null) return null;
  const emit = lang === "c" ? (operator.cExpr ?? operator.expr) : operator.expr;
  const expr = emit(left, right);
  const needsDecl = lang === "c" && !locals?.has("result") && !declared?.has("result");
  if (markDeclared) markDeclared(declared, "result");
  if (declaredTypes) declaredTypes.set("result", "number");

  const guard = operator.guard?.(right);
  const zeroCheck = guard
    ? lang === "c"
      ? `if ((${guard.zero}) == 0) { fprintf(stderr, ${JSON.stringify(`${guard.message}\n`)}); exit(1); }`
      : `if ((${guard.zero}) === 0) throw new Error(${JSON.stringify(guard.message)});`
    : null;

  if (lang === "c") {
    const decl = needsDecl ? "double result = 0;" : null;
    const assign = `result = ${expr};`;
    return [decl, zeroCheck, assign].filter(Boolean).join("\n");
  }
  const assign = `globalThis.result = { su: { name: "result" }, ob: { num: ${expr} }, be: "number", mood: "ya" };`;
  return [zeroCheck, assign].filter(Boolean).join("\n");
}
