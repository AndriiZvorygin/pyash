import { throwErrorSentence } from "../../../../error.mjs";
import { resolveFilenameLiteral } from "../emit_native_helpers.mjs";

export function handleNativeLicense(context, helpers) {
  const { sentence, baseBe, ob, lang, locals, declared, cHelpers, jsHelpers, rememberFlag } = context;
  const { sanitizeName, inlineSentenceLiteral } = helpers;
  if (baseBe !== "license") return null;
  const targetExpr = resolveFilenameLiteral(ob, { lang, declared, locals, sanitizeName, inlineSentenceLiteral });
  if (!targetExpr) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: license target missing",
      from: { name: "compile" },
      raw: { sentence }
    });
  }
  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesStdlib = true;
      cHelpers.usesPrintf = true;
      cHelpers.usesSysStat = true;
      cHelpers.usesCommand = true;
    }
    const modeNum = sentence.as?.num;
    if (typeof modeNum === "number") {
      const raw = String(modeNum);
      const mode = /^[0-7]+$/.test(raw) ? parseInt(raw, 8) : modeNum;
      return `if (chmod(${targetExpr}, ${Math.trunc(mode)}) != 0) { fprintf(stderr, \"license defective\\n\"); exit(1); }`;
    }
    const modeText = sentence.as?.text;
    if (typeof modeText === "string" && modeText.trim()) {
      const modeLiteral = JSON.stringify(modeText);
      return [
        "char __pyaCmd[PYA_TEXT_CAP] = \"\";",
        `snprintf(__pyaCmd, sizeof(__pyaCmd), "chmod %s %s", ${modeLiteral}, ${targetExpr});`,
        "char *__pyaOut = pya_command(__pyaCmd);",
        "if (!__pyaOut) { fprintf(stderr, \"license defective\\n\"); exit(1); }",
        "if (__pyaOut) free(__pyaOut);"
      ].join("\n");
    }
    const values = sentence.as?.ve?.values;
    if (Array.isArray(values) && values.length > 0) {
      const vecType = sentence.as?.ve?.type;
      const prefix = (typeof vecType === "string" && !["num", "text", "bool", "name", "filename"].includes(vecType))
        ? [vecType]
        : [];
      const merged = [...prefix, ...values].map((v) => String(v ?? ""));
      let groups = { owner: null, flock: null, all: null };
      let current = null;
      for (const token of merged) {
        if (token === "owner" || token === "flock" || token === "all") {
          current = token;
          groups[current] = [];
          continue;
        }
        if (!current) { groups = null; break; }
        groups[current].push(token);
      }
      const bitsFromTokens = (tokens) => {
        if (!Array.isArray(tokens)) return 0;
        let bits = 0;
        if (tokens.includes("read")) bits |= 4;
        if (tokens.includes("write")) bits |= 2;
        if (tokens.includes("command")) bits |= 1;
        return bits;
      };
      let mode;
      if (groups) {
        const owner = bitsFromTokens(groups.owner);
        const flock = bitsFromTokens(groups.flock);
        const all = bitsFromTokens(groups.all);
        mode = (owner << 6) | (flock << 3) | all;
      } else {
        const scope = sentence.for?.name ?? sentence.for?.text;
        const bits = bitsFromTokens(merged);
        if (scope === "owner") mode = bits << 6;
        else if (scope === "flock") mode = bits << 3;
        else if (scope === "all") mode = bits;
      }
      if (mode === undefined) {
        throwErrorSentence({
          name: "compile error",
          message: "compile: license vector defective",
          from: { name: "compile" },
          raw: { sentence }
        });
      }
      return `if (chmod(${targetExpr}, ${Math.trunc(mode)}) != 0) { fprintf(stderr, \"license defective\\n\"); exit(1); }`;
    }
    throwErrorSentence({
      name: "compile error",
      message: "compile: license defective",
      from: { name: "compile" },
      raw: { sentence }
    });
  }
  if (jsHelpers) {
    jsHelpers.usesFs = true;
    jsHelpers.usesPath = true;
    jsHelpers.usesCommand = true;
    jsHelpers.usesResolveFilename = true;
  }
  if (rememberFlag) rememberFlag.used = true;
  const modeNum = sentence.as?.num;
  if (typeof modeNum === "number") {
    const raw = String(modeNum);
    const mode = /^[0-7]+$/.test(raw) ? parseInt(raw, 8) : modeNum;
    return `fs.chmodSync(String(${targetExpr}), ${Math.trunc(mode)});`;
  }
  const modeText = sentence.as?.text;
  if (typeof modeText === "string" && modeText.trim()) {
    return `child_process.execFileSync(\"chmod\", [${JSON.stringify(modeText)}, String(${targetExpr})]);`;
  }
  const values = sentence.as?.ve?.values;
  if (Array.isArray(values) && values.length > 0) {
    const vecType = sentence.as?.ve?.type;
    const prefix = (typeof vecType === "string" && !["num", "text", "bool", "name", "filename"].includes(vecType))
      ? [vecType]
      : [];
    const merged = [...prefix, ...values].map((v) => String(v ?? ""));
    let groups = { owner: null, flock: null, all: null };
    let current = null;
    for (const token of merged) {
      if (token === "owner" || token === "flock" || token === "all") {
        current = token;
        groups[current] = [];
        continue;
      }
      if (!current) { groups = null; break; }
      groups[current].push(token);
    }
    const bitsFromTokens = (tokens) => {
      if (!Array.isArray(tokens)) return 0;
      let bits = 0;
      if (tokens.includes("read")) bits |= 4;
      if (tokens.includes("write")) bits |= 2;
      if (tokens.includes("command")) bits |= 1;
      return bits;
    };
    let mode;
    if (groups) {
      const owner = bitsFromTokens(groups.owner);
      const flock = bitsFromTokens(groups.flock);
      const all = bitsFromTokens(groups.all);
      mode = (owner << 6) | (flock << 3) | all;
    } else {
      const scope = sentence.for?.name ?? sentence.for?.text;
      const bits = bitsFromTokens(merged);
      if (scope === "owner") mode = bits << 6;
      else if (scope === "flock") mode = bits << 3;
      else if (scope === "all") mode = bits;
    }
    if (mode === undefined) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: license vector defective",
        from: { name: "compile" },
        raw: { sentence }
      });
    }
    return `fs.chmodSync(String(${targetExpr}), ${Math.trunc(mode)});`;
  }
  throwErrorSentence({
    name: "compile error",
    message: "compile: license defective",
    from: { name: "compile" },
    raw: { sentence }
  });
}
