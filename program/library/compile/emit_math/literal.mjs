const OPERATOR_EXPR = {
  plus: (left, right) => `(${left} + ${right})`,
  subtract: (left, right) => `(${left} - ${right})`,
  multiply: (left, right) => `(${left} * ${right})`
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

// A literal-operand arithmetic sentence with no named destination writes the
// same `result` fact the interpreter produces.
export function handleLiteralMath(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes } = context;
  const { sanitizeName, markDeclared } = helpers;
  const operator = OPERATOR_EXPR[baseBe];
  if (!operator) return null;
  if (sentence.to?.name || sentence.to?.genitive) return null;
  const rightSlot = sentence.to ?? sentence.from ?? sentence.by;
  const left = numericOperand(sentence.ob, { lang, locals, declared, sanitizeName });
  const right = numericOperand(rightSlot, { lang, locals, declared, sanitizeName });
  if (left == null || right == null) return null;
  const expr = operator(left, right);
  const needsDecl = lang === "c" && !locals?.has("result") && !declared?.has("result");
  if (markDeclared) markDeclared(declared, "result");
  if (declaredTypes) declaredTypes.set("result", "number");
  if (lang === "c") {
    return needsDecl ? `double result = ${expr};` : `result = ${expr};`;
  }
  return `globalThis.result = { su: { name: "result" }, ob: { num: ${expr} }, be: "number", mood: "ya" };`;
}
