import fs from "node:fs/promises";
import { buildProgram } from "../../program.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { deriveSignatureFromDefinition, joinSignatureWords } from "../../bridge/signature.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";

function sanitizeName(name = "") {
  return String(name)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1");
}

function exprForSlot(slot = {}, { sentenceArg, locals, declared, defaultExpr, field = "num" } = {}) {
  if (!slot) return defaultExpr ?? null;

  if (slot.genitive && sentenceArg) {
    const path = pathFromGenitive(slot.genitive, sentenceArg);
    if (path) return path;
  }

  if (slot.at && slot.name && field === "num") {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    const idxOffset = typeof idxExpr === "number" ? idxExpr - 1 : `(${idxExpr}) - 1`;
    return `${vecRef}.obj?.ve?.values?.[${idxOffset}]`;
  }

  if (slot.at && slot.name && field === "num") {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    const idxOffset = typeof idxExpr === "number" ? idxExpr - 1 : `(${idxExpr}) - 1`;
    return `${vecRef}.obj?.ve?.values?.[${idxOffset}]`;
  }

  if (slot.at && slot.name) {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    if (typeof idxExpr === "number") {
      return `${vecRef}.obj?.ve?.values?.[${idxExpr - 1}]`;
    }
    return `${vecRef}.obj?.ve?.values?.[(${idxExpr}) - 1]`;
  }

  if (slot[field] !== undefined) {
    const n = Number(slot[field]);
    return Number.isNaN(n) ? 0 : n;
  }

  if (typeof slot.text === "string") {
    return JSON.stringify(slot.text);
  }

  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name)) return name;
    if (declared?.has(name)) {
      if (field === "text") return `${name}.obj?.text`;
      if (field === "name") return `${name}.obj?.name`;
      return `${name}.obj?.${field}`;
    }
    return name;
  }

  return defaultExpr ?? null;
}

function lvalueForName(name, { declared, locals, field = "num" } = {}) {
  const clean = sanitizeName(name);
  if (locals?.has(clean)) return clean;
  if (declared?.has(clean)) return `${clean}.obj.${field}`;
  return clean;
}

function vectorValuesExpr(slot = {}, { sentenceArg, locals, declared } = {}) {
  if (!slot) return "[]";
  if (slot.ve?.values) {
    const vals = slot.ve.values.map(v =>
      typeof v === "number" ? v : JSON.stringify(v)
    );
    return `[${vals.join(", ")}]`;
  }
  if (slot.genitive && sentenceArg) {
    const path = pathFromGenitive(slot.genitive, sentenceArg);
    if (path) return `${path}?.ve?.values ?? []`;
  }
  if (slot.name) {
    const name = sanitizeName(slot.name);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}?.obj?.ve?.values ?? ${name}?.ve?.values ?? []`;
    }
    return "[]";
  }
  return "[]";
}

function pathFromGenitive(genitive = [], sentenceArg) {
  if (!sentenceArg) return null;
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const chain = chainArr[0] === "this" ? chainArr.slice(1) : chainArr;
  if (chain.length === 0) return sentenceArg;
  return [sentenceArg, ...chain.map(part => `.${part}`)].join("");
}

function valueForRole(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    const access = pathFromGenitive(slot.genitive, sentenceArg);
    return access;
  }
  return `${sentenceArg}.${role}?.${field}`;
}

function targetPath(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    return pathFromGenitive(slot.genitive, sentenceArg);
  }
  return `${sentenceArg}.${role}.${field}`;
}

function transpileSentence(sentence, { lang, sentenceArg, locals, ceremonyFns, declared, loopShim, mindShim, cHelpers } = {}) {
  const obj = sentence.obj ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBe = isPermanent ? beWords.slice(1).join(" ") : verb;
  const effectiveBe = baseBe || sentence.mood;

  // Say -> console.log / printf TODO
  if (baseBe === "say") {
    // Special case: say to <mind> -> invoke mind (JS)
    if (sentence.to?.name && lang !== "c") {
      if (mindShim) mindShim.used = true;
      const mindName = sentence.to.name;
      const resultName = sentence.subj?.name ?? mindName;
      const promptVal = typeof obj.text === "string" ? JSON.stringify(obj.text) : JSON.stringify(obj.name ?? "");
      const explicitModel = obj.model ? JSON.stringify(obj.model) : null;
      const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? obj.window?.num ?? null;
      const lines = ["{"]; // block scope to avoid duplicate const per call
      lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
      lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
      lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3-vl:8b-instruct\""};`);
      lines.push(`const historyMessages = buildMindHistory(${JSON.stringify(mindName)}, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
      lines.push("const messages = [];");
      lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
      lines.push("messages.push(...historyMessages);");
      lines.push(`messages.push({ role: "user", content: ${promptVal} });`);
      lines.push("const reply = callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
      const resVar = sanitizeName(resultName);
      lines.push(`recordMindTurn(${JSON.stringify(mindName)}, { role: "user", content: ${promptVal} }, { role: "assistant", content: reply }, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
      lines.push(`const ${resVar} = { subj: { name: "${resultName}" }, obj: { text: reply }, be: "text", mood: "ya" };`);
      lines.push(`globalThis["${resultName}"] = ${resVar};`);
      lines.push(`console.log(${resVar}.obj?.text ?? ${resVar}.obj?.num);`);
      lines.push("}");
      return lines.join("\n");
    }

    let expr = "undefined";
    if (typeof obj.text === "string") {
      expr = JSON.stringify(obj.text);
    } else if (obj.genitive && sentenceArg) {
      expr = pathFromGenitive(obj.genitive, sentenceArg) ?? expr;
    } else if (obj.name) {
      const name = sanitizeName(obj.name);
      if (locals?.has(name)) {
        expr = name;
      } else if (declared?.has(name)) {
        expr = `${name}.obj?.text ?? ${name}.obj?.num`;
      } else {
        expr = JSON.stringify(obj.name);
      }
    } else {
      const fallback = exprForSlot(obj, {
        sentenceArg,
        locals,
        declared,
        defaultExpr: sentenceArg ? `${sentenceArg}.obj?.text ?? ${sentenceArg}.obj?.num` : undefined,
        field: "text"
      });
      if (fallback) expr = fallback;
    }
    if (lang === "c") {
      if (cHelpers) cHelpers.usesPrintf = true;
      const isText = typeof obj.text === "string";
      const fmt = isText ? "%s" : "%g";
      return `printf("${fmt}\\n", ${expr});`;
    }
    return `console.log(${expr});`;
  }

  // Vector element read: obj name doors at num 2 be read to name picked do
  if (baseBe === "read" && obj?.name && obj.at?.num != null && (sentence.to?.name || sentenceArg)) {
    const baseName = sanitizeName(obj.name);
    const idxVal = Number(obj.at.num);
    const idxExpr = Number.isNaN(idxVal) ? obj.at.num : idxVal;
    const targetName = sentence.to?.name ?? sentence.subj?.name ?? "result";
    const targetLval = lvalueForName(targetName, { declared, locals, field: "num" });
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(obj.name)});`);
      locals?.add(baseName);
    }
    lines.push(`${targetLval} = ${baseName}?.obj?.ve?.values?.[(${idxExpr}) - 1];`);
    return lines.join("\n");
  }

  // Vector element invert (toggle boolean or numeric 0/1): invert obj name doors at num 2 do
  if (baseBe === "invert" && obj?.name && obj.at?.num != null) {
    const baseName = sanitizeName(obj.name);
    const idxVal = Number(obj.at.num);
    const idxExpr = Number.isNaN(idxVal) ? obj.at.num : idxVal;
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(obj.name)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.obj = ${baseName}.obj ?? {};`);
    lines.push(`${baseName}.obj.ve = ${baseName}.obj.ve ?? {};`);
    lines.push(`${baseName}.obj.ve.values = ${baseName}.obj.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr}) - 1;`);
    lines.push(`const _curr = ${baseName}.obj.ve.values[_idx];`);
    lines.push(`${baseName}.obj.ve.values[_idx] = (_curr === "truth" || _curr === true || _curr === 1) ? "lie" : "truth";`);
    return lines.join("\n");
  }

  // Mind (JS only)
  if (baseBe === "mind") {
    if (lang === "c") return "/* TODO: mind in C not supported */";
    if (mindShim) mindShim.used = true;

    const mindName = sentence.to?.name ?? obj.to?.name ?? sentence.subj?.name ?? "mind";

    // Configuration sentence (ya mood)
    if (sentence.mood === "ya") {
      const space = sentence.from?.name ?? obj.space ?? null;
      const model = sentence.as?.name ?? obj.model ?? null;
      const prompt = sentence.accordingto?.name ?? obj.text ?? null;
      const window = sentence.by?.num ?? sentence.by?.quantity?.num ?? sentence.obj?.window?.num ?? obj.window?.num ?? null;
      const lines = [];
      lines.push(`mindConfigs.set(${JSON.stringify(mindName)}, {`);
      if (space) lines.push(`  space: ${JSON.stringify(space)},`);
      if (model) lines.push(`  model: ${JSON.stringify(model)},`);
      if (prompt) lines.push(`  prompt: ${JSON.stringify(prompt)},`);
      if (window) lines.push(`  window: ${Number(window) || 8},`);
      lines.push("});");
      return lines.join("\n");
    }

    // Invocation
    const resultName = sentence.subj?.name ?? "mind_result";
    const explicitModel = obj.model ? JSON.stringify(obj.model) : null;
    const userText = obj.text
      ? JSON.stringify(obj.text)
      : obj.name
        ? JSON.stringify(obj.name)
        : "\"\"";
    const lines = ["{"]; // block scope per invocation
    lines.push(`const cfg = mindConfigs.get(${JSON.stringify(mindName)}) || {};`);
    lines.push(`const host = cfg.space || ((typeof process !== "undefined" && process.env?.OLLAMA_HOST) ? process.env.OLLAMA_HOST : undefined) || "http://localhost:11434";`);
    lines.push(`const model = ${explicitModel ?? "cfg.model || \"qwen3-vl:8b-instruct\""};`);
    const windowVal = sentence.by?.num ?? sentence.by?.quantity?.num ?? obj.window?.num ?? null;
    lines.push(`const historyMessages = buildMindHistory(${JSON.stringify(mindName)}, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
    lines.push("const messages = [];");
    lines.push("if (cfg.prompt) messages.push({ role: \"system\", content: cfg.prompt });");
    lines.push("messages.push(...historyMessages);");
    lines.push(`messages.push({ role: "user", content: ${userText} });`);
    lines.push("const reply = callMind({ host, model, messages, numCtx: cfg.numCtx || 8192 });");
    const resVar = sanitizeName(resultName);
    lines.push(`recordMindTurn(${JSON.stringify(mindName)}, { role: "user", content: ${userText} }, { role: "assistant", content: reply }, ${windowVal !== null ? Number(windowVal) || 8 : "cfg.window || 8"});`);
    lines.push(`const ${resVar} = { subj: { name: "${resultName}" }, obj: { text: reply }, be: "text", mood: "ya" };`);
    lines.push(`globalThis["${resultName}"] = ${resVar};`);
    lines.push(`console.log(${resVar}.obj?.text ?? ${resVar}.obj?.num);`);
    lines.push("}");
    return lines.join("\n");
  }

  // Conditionals (tiny/giant/equally) with then consequence
  if (sentence.consequence && (baseBe === "tiny" || baseBe === "giant" || baseBe === "equally")) {
    const lhs = exprForSlot(obj, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? `${sentenceArg}.obj?.num` : "lhs"
    }) ?? "lhs";
    const rhs = exprForSlot(sentence.from, {
      sentenceArg,
      locals,
      declared,
      defaultExpr: sentenceArg ? `${sentenceArg}.from?.num` : "rhs"
    }) ?? "rhs";
    const op = baseBe === "tiny" ? "<" : baseBe === "giant" ? ">" : "===";
    const consequence = sentence.consequence;
    const body = transpileSentence(consequence, { lang, sentenceArg, locals, declared }) ?? `// TODO: ${JSON.stringify(consequence)}`;
    const finalBody = body.split("\n").map(l => (l ? `  ${l}` : l)).join("\n");
    return `if (${lhs} ${op} ${rhs}) {\n${finalBody}\n}`;
  }

  // Dot product (produce) for vectors
  if (baseBe === "produce" && (obj?.ve || obj?.name || sentence.by || sentence.from)) {
    const leftSlot = (obj && Object.keys(obj).length) ? obj : sentence.from;
    const leftVec = vectorValuesExpr(leftSlot, { sentenceArg, locals, declared });
    const rightVec = vectorValuesExpr(sentence.by || sentence.from, { sentenceArg, locals, declared });
    const targetName = sentence.to?.name || "result";
    const targetBase = sanitizeName(targetName);
    const targetLval = lvalueForName(targetName, { declared, locals, field: "num" });

    const resultName = targetName === "result" ? targetName : "result";
    const resultBase = sanitizeName(resultName);
    const resultLval = lvalueForName(resultName, { declared, locals, field: "num" });

    const lines = [];
    lines.push(`const _a = ${leftVec};`);
    lines.push(`const _b = ${rightVec};`);
    lines.push(`if (_a.length !== _b.length) throw new Error("produce: vectors must be the same length");`);
    lines.push(`let _sum = 0;`);
    lines.push(`for (let i = 0; i < _a.length; i++) { const x = Number(_a[i]); const y = Number(_b[i]); if (Number.isNaN(x) || Number.isNaN(y)) throw new Error("produce: numeric values required"); _sum += x * y; }`);

    const ensureTargetObject = () => {
      if (!declared?.has(targetBase) && !locals?.has(targetBase)) {
        lines.push(`let ${targetBase} = { subj: { name: "${targetName}" }, obj: {}, be: "number", mood: "ya" };`);
        declared?.add(targetBase);
      }
    };
    const ensureResultObject = () => {
      if (!declared?.has(resultBase) && !locals?.has(resultBase)) {
        lines.push(`let ${resultBase} = { subj: { name: "${resultName}" }, obj: {}, be: "number", mood: "ya" };`);
        declared?.add(resultBase);
      }
    };

    ensureTargetObject();
    const targetAssign = targetLval.includes(".obj.") ? targetLval : `${targetBase}.obj.num`;
    lines.push(`${targetAssign} = _sum;`);

    ensureResultObject();
    const resultAssign = resultLval.includes(".obj.") ? resultLval : `${resultBase}.obj.num`;
    lines.push(`${resultAssign} = _sum;`);

    return lines.join("\n");
  }

  // Imperative add
  if (baseBe === "add" && obj.num !== undefined && (sentence.to?.name || sentence.to?.genitive)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const genitiveChain = sentence.to?.genitive?.chain || [];
      const genitiveHint = genitiveChain.find(part => part !== "this");
      const targetNameLiteral = sentence.to?.name
        ? `"${sentence.to.name}"`
        : genitiveHint
          ? `"${genitiveHint}"`
          : sentence.subj?.name
            ? `"${sentence.subj.name}"`
            : "\"\"";
      const targetVarName = sanitizeName((sentence.to?.name || genitiveHint || sentence.subj?.name || "sentence"));
      const isThisGenitive = sentence.to?.genitive?.chain?.[0] === "this";
      const targetVar = isThisGenitive ? sentenceArg : targetVarName || "sentence";
      const targetExpr = sentence.to
        ? `${sentenceArg}.to ?? { subj: { name: ${targetNameLiteral} }, obj: {} }`
        : sentenceArg;
      const lines = [];
      if (!isThisGenitive && !locals?.has(targetVar) && !declared?.has(targetVar)) {
        lines.push(`const ${targetVar} = remember(${targetExpr});`);
        locals?.add(targetVar);
      }
      lines.push(`${targetVar}.obj = ${targetVar}.obj ?? {};`);
      const fieldPath = sentence.to?.genitive
        ? pathFromGenitive(sentence.to.genitive, targetVar) || `${targetVar}.obj.num`
        : `${targetVar}.obj.num`;
      const newVal = `${fieldPath} ?? 0`;
      lines.push(`${fieldPath} = (${newVal}) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} + ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const lines = [];
    lines.push(`${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};`);
    lines.push(`${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) + ${Number.isNaN(safeValue) ? 0 : safeValue};`);
    return lines.join("\n");
  }

  // Text concatenation via add
  if (baseBe === "add" && typeof obj.text === "string" && (sentence.to?.name || sentence.to?.genitive)) {
    const literal = JSON.stringify(obj.text);
    if (sentenceArg) {
      const target = targetPath("to", sentenceArg, "text") ?? sentence.to?.name;
      const init = `${target} = ${target} ?? "";`;
      const concat = `${target} = ${target} + ${literal};`;
      return `${init}\n${concat}`;
    }
    if (lang === "c") {
      const target = sentence.to.name;
      return `/* TODO: string concat add for ${target} */`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.text = (${sentence.to.name}.obj.text ?? "") + ${literal};`;
  }

  if (baseBe === "remember" && sentenceArg) {
    const genitiveChain = sentence.obj?.genitive?.chain || [];
    const genitiveHint = genitiveChain.filter(part => part !== "this").at(-1);
    const rawName = sentence.to?.name?.split(" ")[0] || genitiveHint || "remembered";
    const targetVar = sanitizeName(rawName) || "remembered";
    const source = sentence.obj?.genitive
      ? pathFromGenitive(sentence.obj.genitive, sentenceArg) || `${sentenceArg}.obj`
      : `${sentenceArg}.to`;
    const lines = [];
    if (sentence.exists || sentence.to?.name) {
      lines.push(`let ${targetVar};`);
    }
    lines.push(`${targetVar} = remember(${source});`);
    locals?.add(targetVar);
    return lines.join("\n");
  }

  if (baseBe === "subtract" && obj.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "multiply" && obj.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "divide" && obj.num !== undefined && (sentence.to?.name || sentenceArg)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    const divisor = Number.isNaN(safeValue) ? 1 : safeValue;
    if (sentenceArg) {
      const hasGenitive = Boolean(sentence.to?.genitive);
      if (!hasGenitive && sentence.to?.name) {
        const baseName = sanitizeName(sentence.to.name);
        const target = lvalueForName(sentence.to.name, { declared, locals });
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
        }
        lines.push(`${target} = (${target} ?? 0) / ${divisor};`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) / ${divisor};`;
  }

  if (baseBe === "remains" && (obj.num !== undefined || sentence.from?.num !== undefined) && (sentence.to?.name || sentenceArg)) {
    const divisorRaw = sentence.from?.num ?? obj.num;
    const divisor = typeof divisorRaw === "number" ? divisorRaw : Number(divisorRaw);
    const safeValue = Number.isNaN(divisor) ? 0 : divisor;
    if (sentenceArg) {
      const targetGenitive = sentence.to?.genitive ? pathFromGenitive(sentence.to.genitive, sentenceArg) : null;
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const source =
        sentence.obj?.genitive && sentenceArg
          ? pathFromGenitive(sentence.obj.genitive, sentenceArg)
          : targetGenitive ?? targetName;

      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        lines.push(`let ${targetName};`);
        locals?.add(targetName);
      }

      const lhs = targetGenitive
        ? targetGenitive
        : targetName
          ? lvalueForName(targetName, { declared, locals })
          : targetPath("to", sentenceArg) ?? `${sentenceArg}.obj?.num`;
      const numerator = source ?? lhs;
      const expr = lang === "c"
        ? `fmod(${numerator}, ${safeValue})`
        : `(${numerator} ?? 0) % ${safeValue}`;
      lines.push(`${lhs} = ${expr};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      return `${sentence.to.name} = fmod(${sentence.to.name}, ${safeValue});`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) % ${safeValue};`;
  }

  const name = sentence?.subj?.name;
  const mood = sentence?.mood;
  if (mood === "do" && !sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
    if (fn && (sentence.tloh !== undefined || sentence.until !== undefined)) {
      if (lang === "c") {
        const start = sentence.tloh?.num ?? sentence.tloh ?? 0;
        const hasUntil = sentence.until !== undefined;
        const untilVal = sentence.until?.num ?? sentence.until ?? 0;
        if (hasUntil) {
          const step = untilVal > start ? 1 : -1;
          const cmp = step > 0 ? "<=" : ">=";
          return `for (int tloh = ${start}; tloh ${cmp} ${untilVal}; tloh += ${step}) { ${fn}(); }`;
        }
        return `for (int tloh = ${start}; tloh > 0; tloh--) { ${fn}(); }`;
      }
      const evokerLiteral = inlineSentenceLiteral(sentence, declared);
      if (loopShim) loopShim.used = true;
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      if (lang === "c") return `${fn}();`;
      const arg = inlineSentenceLiteral(sentence, declared);
      return `${fn}(${arg});`;
    }
  }
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);

  if (effectiveBe === "vector" && obj.ve?.values) {
    const values = obj.ve.values
      .map(v => (typeof v === "number" ? v : JSON.stringify(v)))
      .join(", ");
    const vecLiteral = `{ type: "${obj.ve.type || "num"}", values: [${values}] }`;
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "ve", sentence.subj) ?? name;
      return `${target} = ${vecLiteral};`;
    }
    const sentenceObject = `{ subj: { name: "${name}" }, obj: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      return `/* TODO: vector support in C */`;
    }
    return shouldDeclare ? `let ${name} = ${sentenceObject};` : `${name} = ${sentenceObject};`;
  }

  if (effectiveBe === "number" && typeof obj.num !== "undefined") {
    const value = typeof obj.num === "number" ? obj.num : Number(obj.num);
    const safeValue = Number.isNaN(value) ? 0 : value;
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "num", sentence.subj) ?? name;
      return `${target} = ${safeValue};`;
    }
    const sentenceObject = `{ subj: { name: "${name}" }, obj: { num: ${safeValue} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    const decl = shouldDeclare ? (lang === "c" ? "/* TODO: sentence object in C */" : (isPermanent ? "const" : "let")) : "";
    if (lang === "c") {
      // Fallback for C for now: keep scalar style
      if (!shouldDeclare) return `${name} = ${safeValue};`;
      const cdecl = isPermanent ? "const double" : "double";
      return `${cdecl} ${name} = ${safeValue};`;
    }
    return shouldDeclare ? `${decl} ${name} = ${sentenceObject};` : `${name} = ${sentenceObject};`;
  }

  if (effectiveBe === "text" && typeof obj.text === "string") {
    const value = JSON.stringify(obj.text);
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "text") ?? name;
      return `${target} = ${value};`;
    }
    const sentenceObject = `{ subj: { name: "${name}" }, obj: { text: ${value} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      // Fallback for C: keep scalar style
      if (!shouldDeclare) return `${name} = ${value};`;
      const decl = isPermanent ? "const char *" : "char *";
      return `${decl} ${name} = ${value};`;
    }
    return shouldDeclare ? `let ${name} = ${sentenceObject};` : `${name} = ${sentenceObject};`;
  }

  return null;
}

function transpileCeremony(defSentence, bodySentences, { lang, declared }) {
  const signatureWords = deriveSignatureFromDefinition(defSentence);
  const fnBaseName = signatureWords
    ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
    : (defSentence?.subj?.name || "ceremony");
  const fnName = sanitizeName(fnBaseName);

  const bodyLines = [];
  let hasReturn = false;
  const locals = new Set();
  for (const s of bodySentences) {
    const line = transpileSentence(s, { lang, sentenceArg: lang === "c" ? undefined : "sentence", locals, declared });
    if (line) {
      bodyLines.push(line);
      if (line.includes("return")) {
        hasReturn = true;
        break; // stop emitting after first return
      }
    }
  }

  const retLine =
    hasReturn
      ? null
      : lang === "c"
        ? "return;"
        : "return sentence;";

  if (lang === "c") {
    const paramList = "void";
    const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
    return `void ${fnName}(${paramList}) {\n${body}\n}`;
  }

  const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
  return `function ${fnName}(sentence) {\n${body}\n}`;
}

function transpileProgram(sentences, { lang }) {
  const header =
    lang === "c"
      ? "/* Generated by Pyash compile */"
      : "// Generated by Pyash compile";
let lines = [header];
  const mainLines = [];
  let usesRememberShim = false;
  const cHelpers = { usesPrintf: false };
  const loopShim = { used: false };
  const mindShim = { used: false };
  const declared = new Set();
  const ceremonyFns = new Map();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const name = sentence?.subj?.name;

    if (sentence.mood === "def" && sentence.be === "ceremony") {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const fn = transpileCeremony(sentence, body, { lang, declared });
      const signatureWords = deriveSignatureFromDefinition(sentence);
      const fnBaseName = signatureWords
        ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
        : (sentence?.subj?.name || "ceremony");
      const fnName = sanitizeName(fnBaseName);
      ceremonyFns.set(sentence.subj?.name, fnName);
      if (signatureWords) {
        ceremonyFns.set(joinSignatureWords(signatureWords), fnName);
      }
      if (typeof fn === "string" && fn.includes("remember(")) {
        usesRememberShim = true;
      }
      if (lang === "c") {
        lines.push(fn);
      } else {
        lines.push(fn);
      }
      i = j; // skip to end of block
      continue;
    }

    if (sentence.mood === "ya" && name && !sentence.exists && !declared.has(name)) {
      const pyash = sentenceToPyash(sentence);
      throw new Error(`subj quoted.pyash.${pyash}.pyash.quoted be error obj name variable as not exists ya`);
    }

    const line = transpileSentence(sentence, { lang, ceremonyFns, declared, loopShim, mindShim, cHelpers });
    if (typeof line === "string" && line.includes("remember(")) {
      usesRememberShim = true;
    }
    const todoPrefix = lang === "c" ? "/* TODO" : "// TODO";
    const todoSuffix = lang === "c" ? " */" : "";
    const target = (() => {
      if (lang === "c" && sentence.mood === "ya") {
        if (typeof line === "string" && (line.startsWith("double ") || line.startsWith("const char"))) {
          return lines; // keep declarations global
        }
      }
      return lang === "c" ? mainLines : lines;
    })();
    target.push(line ?? `${todoPrefix}: ${JSON.stringify(sentence)}${todoSuffix}`);
    if (name && sentence.mood === "ya") declared.add(name);
  }

  if (lang !== "c") {
    const prelude = [lines[0]];
    if (mindShim.used) {
      prelude.push(`const mindConfigs = new Map();`);
      const waitForHelper = `function waitFor(promise) {\n  if (!promise || typeof promise.then !== \"function\") return promise;\n  const sab = new SharedArrayBuffer(4);\n  const view = new Int32Array(sab);\n  let value;\n  let error;\n  promise.then(v => { value = v; Atomics.store(view, 0, 1); Atomics.notify(view, 0); }).catch(err => { error = err; Atomics.store(view, 0, 1); Atomics.notify(view, 0); });\n  Atomics.wait(view, 0, 0);\n  if (error) throw error;\n  return value;\n}`;
      const mindHelper = `function callMind({ host, model, messages = [], numCtx = 8192 }) {\n  const transport = globalThis?.ollamaChat;\n  if (typeof transport === \"function\") {\n    const res = transport({ host, model, messages, numCtx });\n    return waitFor(res);\n  }\n  if (typeof fetch !== \"function\") {\n    throw new Error(\"mind: provide globalThis.ollamaChat or fetch\");\n  }\n  const resp = waitFor(fetch(String(host).replace(/\\/$/, \"\") + \"/api/chat\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ model, messages, options: { num_ctx: numCtx }, stream: false })\n  }));\n  const data = waitFor(typeof resp.json === \"function\" ? resp.json() : Promise.resolve({ message: { content: String(resp) } }));\n  return data?.message?.content ?? data?.response ?? data?.output ?? data?.data ?? \"\";\n}`;
      const mindHistory = `const mindHistory = new Map();\nfunction buildMindHistory(name, windowSize = 8) {\n  const arr = mindHistory.get(name) || [];\n  const max = windowSize * 2;\n  return arr.slice(-max);\n}\nfunction recordMindTurn(name, userMsg, assistantMsg, windowSize = 8) {\n  const arr = mindHistory.get(name) || [];\n  if (userMsg) arr.push(userMsg);\n  if (assistantMsg) arr.push(assistantMsg);\n  const max = windowSize * 2;\n  const trimmed = arr.slice(-max);\n  mindHistory.set(name, trimmed);\n}`;
      prelude.push(waitForHelper);
      prelude.push(mindHelper);
      prelude.push(mindHistory);
    }
    if (usesRememberShim) {
      const rememberShim = `const remember = (typeof globalThis.remember === "function" ? globalThis.remember : (ref) => {\n  if (ref && typeof ref === "object") return ref;\n  if (typeof ref === "string" && globalThis && Object.prototype.hasOwnProperty.call(globalThis, ref)) return globalThis[ref];\n  return ref;\n});`;
      prelude.push(rememberShim);
    }
    if (loopShim.used) {
      const loopHelper = `function runLoop(sentence, fn) {\n  for (;;) {\n    const currTloh = sentence?.tloh?.num ?? sentence?.tloh ?? 0;\n    const hasUntil = sentence?.until !== undefined;\n    const currUntil = sentence?.until?.num ?? sentence?.until;\n    if (hasUntil ? currTloh === currUntil : currTloh === 0) break;\n    const prevTloh = sentence?.tloh;\n    const prevUntil = sentence?.until;\n    const nextSentence = fn(sentence);\n    sentence = { ...sentence, ...(nextSentence || {}) };\n    if (sentence.tloh === undefined) sentence.tloh = prevTloh;\n    if (sentence.until === undefined) sentence.until = prevUntil;\n    let nextTloh;\n    if (hasUntil) {\n      nextTloh = currTloh + (currUntil > currTloh ? 1 : -1);\n    } else {\n      nextTloh = currTloh - 1;\n    }\n    sentence.tloh = typeof sentence.tloh === \"object\" ? { ...sentence.tloh, num: nextTloh } : nextTloh;\n  }\n  return sentence;\n}`;
      prelude.push(loopHelper);
    }
    lines = prelude.concat(lines.slice(1));
  }

  if (lang === "c") {
    const headers = [];
    if (cHelpers.usesPrintf) headers.push("#include <stdio.h>");
    if (lines.some(l => typeof l === "string" && l.includes("fmod("))) headers.push("#include <math.h>");
    if (headers.length) lines.unshift(...headers);
    const body = mainLines.map(l => `  ${l}`).join("\n");
    lines.push("int main(void) {");
    lines.push(body || "  return 0;");
    lines.push("  return 0;");
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

function inlineSentenceLiteral(value, declared = new Set()) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => inlineSentenceLiteral(v, declared)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entriesArr = Object.entries(value);
    if (entriesArr.length === 1 && entriesArr[0][0] === "name") {
      const nameVal = entriesArr[0][1];
      if (typeof nameVal === "string" && declared.has(nameVal)) {
        return nameVal;
      }
    }
    const entries = Object.entries(value).map(([key, val]) => {
      if (key === "name" && typeof val === "string" && declared.has(val)) {
        return `${key}: ${val}`;
      }
      return `${key}: ${inlineSentenceLiteral(val, declared)}`;
    });
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

async function compile_from_filename_to_filename(sentence) {
  const sourceFilename =
    sentence?.from?.filename ??
    sentence?.obj?.filename ??
    sentence?.filename;

  let sourceText = sentence?.fromtext?.text ?? sentence?.from?.text ?? sentence?.text ?? sentence?.obj?.text;

  if (!sourceText && sentence?.obj?.name) {
    const recalled = remember(sentence.obj.name);
    sourceText = recalled?.obj?.text;
  }

  if (!sourceText && sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  }
  if (typeof sourceText !== "string") {
    throw new Error("compile: source text is required (from text or from filename)");
  }

  // Allow escaped newlines in inline text blocks
  sourceText = sourceText.replaceAll("\\n", "\n");

  const program = buildProgram(sourceText);

  const targetLang = (sentence?.become?.name || "javascript").toLowerCase();
  const body = transpileProgram(program.sentences, { lang: targetLang });
  const wrappedText = `quoted.${targetLang}.\n${body}.${targetLang}.quoted`;

  const targetFilename = sentence?.to?.filename;
  if (targetFilename) {
    await fs.writeFile(targetFilename, body, "utf8");
  }

  const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.subj?.name;
  if (targetName) {
    doRemember({
      subj: { name: targetName },
      be: sentence?.become?.name ?? "javascript",
      obj: { text: wrappedText, sentences: program.sentences },
      mood: "ya",
    });
  }

  return { obj: { text: wrappedText, sentences: program.sentences }, be: sentence?.become?.name ?? "javascript" };
}

export default compile_from_filename_to_filename;
export { transpileSentence };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename", "fromstate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "obj", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "fromstate", "name", "tostate", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "fromstate", "name", "become", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "obj", "name", "num", "fromstate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "fromstate", "name", "num", "tostate", "name", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "num", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  }
];
