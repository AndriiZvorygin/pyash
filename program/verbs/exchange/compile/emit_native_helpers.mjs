import { throwErrorSentence } from "../../../error.mjs";

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
  throwErrorSentence({
    name: "compile error",
    message: "compile: boolean clause unsupported",
    from: { name: "compile" },
    raw: { clause }
  });
}

export { resolveFilenameLiteral, boolExprForClause };
