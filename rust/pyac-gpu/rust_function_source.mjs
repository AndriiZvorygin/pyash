import { CANDIDATES } from "./rust_function_reduction_candidates.mjs";

export function listReductionCandidates() {
  return CANDIDATES.map((candidate) => ({ ...candidate }));
}

function skipQuotedOrComment(source, index) {
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index + 2);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith("/*", index)) {
    let depth = 1;
    let cursor = index + 2;
    while (cursor < source.length && depth) {
      if (source.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (source.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
      } else cursor += 1;
    }
    if (depth) throw new Error("unterminated Rust block comment");
    return cursor;
  }

  const rawStart = source.slice(index).match(/^(?:br|cr|r)(#*)"/u);
  if (rawStart) {
    const close = `"${"#".repeat(rawStart[1].length)}`;
    const end = source.indexOf(close, index + rawStart[0].length);
    if (end < 0) throw new Error("unterminated Rust raw string");
    return end + close.length;
  }

  const quoteAt = source[index] === "b" && source[index + 1] === '"' ? index + 1 : index;
  if (source[quoteAt] === '"') {
    let cursor = quoteAt + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor++] === '"') return cursor;
    }
    throw new Error("unterminated Rust string");
  }
  if (source[index] === "'") {
    let cursor = index + 1;
    if (source[cursor] === "\\") cursor += 2;
    else cursor += 1;
    if (source[cursor] === "'") return cursor + 1;
  }
  return index;
}

function findBodyStart(source, signatureStart) {
  let parens = 0;
  let brackets = 0;
  for (let cursor = signatureStart; cursor < source.length;) {
    const skipped = skipQuotedOrComment(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    const char = source[cursor];
    if (char === "(") parens += 1;
    else if (char === ")") parens -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    else if (char === "{" && parens === 0 && brackets === 0) return cursor;
    cursor += 1;
  }
  throw new Error("function body was not found");
}

function findBodyEnd(source, bodyStart) {
  let depth = 0;
  for (let cursor = bodyStart; cursor < source.length;) {
    const skipped = skipQuotedOrComment(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}" && --depth === 0) return cursor + 1;
    cursor += 1;
  }
  throw new Error("function body has unmatched braces");
}

export function rustBlockBoundsFrom(source, start) {
  const bodyStart = findBodyStart(source, start);
  return { bodyStart, bodyEnd: findBodyEnd(source, bodyStart) };
}

export function replaceRustFunctionBody(source, functionName, replacement) {
  const declaration = new RegExp(`\\bfn\\s+${functionName}\\s*(?:<[^\\n>]*>)?\\s*\\(`, "gu");
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) throw new Error(`expected one declaration for ${functionName}; found ${matches.length}`);
  const signatureStart = matches[0].index + matches[0][0].length - 1;
  const bodyStart = findBodyStart(source, signatureStart);
  const signature = source.slice(signatureStart, bodyStart);
  const returnType = signature.match(/\)\s*->\s*([^\{]+)$/su)?.[1]?.trim() || "()";
  const bodyEnd = findBodyEnd(source, bodyStart);
  const originalBody = source.slice(bodyStart, bodyEnd);
  const replacementBody = `{ ${replacement} }`;
  return {
    source: `${source.slice(0, bodyStart)}${replacementBody}${source.slice(bodyEnd)}`,
    originalBody,
    replacementBody,
    returnType,
  };
}

export function replaceCandidateBody(source, functionName, variant = "error") {
  const candidate = CANDIDATES.find(({ name }) => name === functionName);
  if (!candidate) throw new Error(`unknown reduction function: ${functionName}`);
  if (!new Set(["baseline", "error", "minimal"]).has(variant)) throw new Error(`variant ${variant} is not supported`);
  const stub = variant === "error" ? candidate.stub : candidate.minimalStub;
  if (variant === "minimal" && !stub) throw new Error(`variant ${variant} is not supported for ${functionName}`);
  const replaced = replaceRustFunctionBody(source, candidate.functionName ?? functionName, stub);
  if (!replaced.returnType.startsWith(candidate.expected)) {
    throw new Error(`${functionName} return type changed: expected ${candidate.expected}, got ${replaced.returnType}`);
  }
  return {
    source: variant === "baseline" ? source : replaced.source,
    candidate,
    variant,
    originalBody: replaced.originalBody,
    replacementBody: variant === "baseline" ? replaced.originalBody : replaced.replacementBody,
  };
}
