import { throwErrorSentence } from "../../error.mjs";

function nextTemp(prefix, cState) {
  const next = (cState.tempCounter ?? 0) + 1;
  cState.tempCounter = next;
  return `__pya_${prefix}_${next}`;
}

function resolveFilenameLiteral(slot, { lang, declared, locals, sanitizeName, inlineSentenceLiteral } = {}) {
  if (!slot) return null;
  if (typeof slot.filename === "string") return JSON.stringify(slot.filename);
  if (typeof slot.text === "string") return JSON.stringify(slot.text);
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (lang === "c") {
      if (locals?.has(name) || declared?.has(name) || declared?.has(slot.name)) return name;
      return null;
    }
    const literal = inlineSentenceLiteral(slot, declared);
    return `pyaResolveFilename(${literal})`;
  }
  if (lang !== "c") {
    const literal = inlineSentenceLiteral(slot, declared);
    return `pyaResolveFilename(${literal})`;
  }
  return null;
}

const COMPARISON_OPS = { equally: "==", tiny: "<", giant: ">" };

function comparisonOperand(slot, context, helpers) {
  if (!slot) return null;
  if (slot.num !== undefined) {
    const value = Number(slot.num);
    return Number.isNaN(value) ? "0" : String(value);
  }
  if (slot.boolean !== undefined) {
    if (context.lang === "c") return slot.boolean ? "1" : "0";
    return slot.boolean ? "true" : "false";
  }
  if (typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }
  if (slot.name) {
    const name = helpers.sanitizeName(slot.name);
    if (context.lang === "c") {
      if (context.locals?.has(name) || context.declared?.has(name) || context.declared?.has(slot.name)) {
        return name;
      }
      return null;
    }
    if (context.locals?.has(name) || context.declared?.has(name) || context.declared?.has(slot.name)) {
      const type = context.declaredTypes?.get(slot.name) ?? context.declaredTypes?.get(name);
      if (type === "text") return `${name}.ob?.text`;
      if (type === "boolean") return `${name}.ob?.boolean ?? ${name}`;
      return `${name}.ob?.num ?? ${name}`;
    }
    return null;
  }
  return null;
}

function boolExprForClause(clause, context, helpers) {
  if (!clause || typeof clause !== "object") {
    throwErrorSentence({
      name: "compile error",
      message: "compile: boolean clause missing",
      from: { name: "compile" },
      raw: { clause }
    });
  }
  const clauseBe = clause.be;
  const baseBe = clauseBe ? String(clauseBe).toLowerCase() : "";
  if (baseBe === "exists") {
    const targetExpr = resolveFilenameLiteral(clause.ob, {
      lang: context.lang,
      declared: context.declared,
      locals: context.locals,
      sanitizeName: helpers.sanitizeName,
      inlineSentenceLiteral: helpers.inlineSentenceLiteral
    });
    if (!targetExpr) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: exists target missing",
        from: { name: "compile" },
        raw: { clause }
      });
    }
    if (context.lang === "c") {
      const temp = nextTemp("exists", context.cState);
      const lines = [];
      lines.push(`int ${temp} = 0;`);
      lines.push(`{ struct stat st; ${temp} = (stat(${targetExpr}, &st) == 0); }`);
      return { lines, valueVar: temp };
    }
    const expr = `(() => { const __pyaTarget = ${targetExpr}; if (!__pyaTarget) throw new Error("exists target missing"); return fs.existsSync(String(__pyaTarget)); })()`;
    return { lines: [], valueExpr: expr };
  }
  if (baseBe === "not") {
    if (context.lang === "c") {
      const inner = boolExprForClause(clause.ob?.la, context, helpers);
      const temp = nextTemp("not", context.cState);
      const lines = [];
      if (inner.lines?.length) lines.push(...inner.lines);
      lines.push(`int ${temp} = !(${inner.valueVar});`);
      return { lines, valueVar: temp };
    }
    const inner = boolExprForClause(clause.ob?.la, context, helpers);
    return { lines: [], valueExpr: `(!(${inner.valueExpr}))` };
  }
  if (baseBe === "and" || baseBe === "or") {
    const left = boolExprForClause(clause.ob?.la, context, helpers);
    const right = boolExprForClause(clause.with?.la, context, helpers);
    if (context.lang === "c") {
      const temp = nextTemp(baseBe, context.cState);
      const lines = [];
      if (left.lines?.length) lines.push(...left.lines);
      lines.push(`int ${temp} = 0;`);
      if (baseBe === "and") {
        lines.push(`if (${left.valueVar}) {`);
        if (right.lines?.length) lines.push(...right.lines.map(l => `  ${l}`));
        lines.push(`  ${temp} = ${right.valueVar};`);
        lines.push("} else {");
        lines.push(`  ${temp} = 0;`);
        lines.push("}");
      } else {
        lines.push(`if (${left.valueVar}) {`);
        lines.push(`  ${temp} = 1;`);
        lines.push("} else {");
        if (right.lines?.length) lines.push(...right.lines.map(l => `  ${l}`));
        lines.push(`  ${temp} = ${right.valueVar};`);
        lines.push("}");
      }
      return { lines, valueVar: temp };
    }
    const op = baseBe === "and" ? "&&" : "||";
    return { lines: [], valueExpr: `(${left.valueExpr} ${op} ${right.valueExpr})` };
  }
  const comparison = COMPARISON_OPS[baseBe];
  if (comparison) {
    const rightSlot = clause.from ?? clause.with ?? clause.by;
    const left = comparisonOperand(clause.ob, context, helpers);
    const right = comparisonOperand(rightSlot, context, helpers);
    if (left == null || right == null) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: boolean clause unsupported",
        from: { name: "compile" },
        raw: { clause }
      });
    }
    const textComparison =
      baseBe === "equally" &&
      (typeof clause.ob?.text === "string"
        || typeof rightSlot?.text === "string"
        || context.declaredTypes?.get(clause.ob?.name) === "text"
        || context.declaredTypes?.get(rightSlot?.name) === "text");
    if (textComparison) {
      if (context.lang === "c") {
        const temp = nextTemp("equally", context.cState);
        return { lines: [`int ${temp} = (strcmp(${left}, ${right}) == 0);`], valueVar: temp };
      }
      return { lines: [], valueExpr: `(String(${left}) === String(${right}))` };
    }
    if (context.lang === "c") {
      const temp = nextTemp(baseBe, context.cState);
      return { lines: [`int ${temp} = ((${left}) ${comparison} (${right}));`], valueVar: temp };
    }
    return { lines: [], valueExpr: `((${left}) ${comparison} (${right}))` };
  }
  throwErrorSentence({
    name: "compile error",
    message: "compile: boolean clause unsupported",
    from: { name: "compile" },
    raw: { clause }
  });
}

export { resolveFilenameLiteral, boolExprForClause };
