import fs from "node:fs/promises";
import { buildProgram } from "../../program.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { deriveSignatureFromDefinition, joinSignatureWords } from "../../bridge/signature.mjs";
import { vectorFormatHelper } from "./helpers_js.mjs";
import { TEXT_HELPER, VECTOR_PRINT_HELPER, VECTOR_TYPE_DECL } from "./helpers_c.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { jsonToPyashText, mapSentenceToPyash } from "./json_map.mjs";

function sanitizeName(name = "") {
  const cleaned = String(name)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1");
  // Avoid JS reserved words and special identifiers like "this"
  if (/^(?:this|function|return|class|default|const|let|var|if|for|while|switch|case|break|continue|do|new|try|catch|finally)$/.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}

function mapValueToJson(value, mapDefs, seen) {
  if (!value || typeof value !== "object") return undefined;
  if (value.hollow) return null;
  if (value.text !== undefined) return value.text;
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.ve) {
    const type = value.ve.type || "num";
    if (type === "hollow") return [];
    if (type === "name") {
      return (value.ve.values || []).map((name) => jsonFromMapName(name, mapDefs, seen));
    }
    if (type === "bool" || type === "boolean") {
      return (value.ve.values || []).map((v) => v === "truth" || v === true || v === 1);
    }
    if (type === "num" || type === "number" || type === "text") {
      return value.ve.values || [];
    }
    throw new Error(`json map contents defective: unsupported vector type ${type}`);
  }
  if (value.name) return jsonFromMapName(value.name, mapDefs, seen);
  throw new Error("json map contents defective: unsupported contents");
}

function jsonFromMapName(name, mapDefs, seen) {
  const mapSentence = mapDefs.get(name);
  if (!mapSentence || mapSentence.be !== "json map") {
    throw new Error(`json map referential defective: ${name}`);
  }
  return jsonFromMapSentence(mapSentence, mapDefs, seen);
}

function jsonFromMapSentence(mapSentence, mapDefs, seen) {
  const mapName = mapSentence?.subj?.name ?? "<map>";
  if (seen.has(mapName)) {
    throw new Error("json map export self referential");
  }
  seen.add(mapName);
  const entries = mapSentence?.obj?.map ?? {};
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const jsonValue = mapValueToJson(value, mapDefs, seen);
    if (jsonValue === undefined) continue;
    out[key] = jsonValue;
  }
  seen.delete(mapName);
  return out;
}

function mapDefChainFromName(name, mapDefs) {
  const visited = new Set();
  const defs = [];

  const visit = (mapName) => {
    if (!mapName || visited.has(mapName)) return;
    visited.add(mapName);
    const fact = mapDefs.get(mapName);
    if (!fact || fact.be !== "json map") return;
    const entries = fact?.obj?.map ?? {};
    for (const value of Object.values(entries)) {
      if (value?.name) visit(value.name);
      if (value?.ve?.type === "name") {
        for (const child of value.ve.values || []) {
          if (typeof child === "string") visit(child);
        }
      }
    }
    defs.push(fact);
  };

  visit(name);
  if (defs.length === 0) return "";
  return defs.map(mapSentenceToPyash).join("\n\n");
}

function exprForSlot(slot = {}, { sentenceArg, locals, declared, defaultExpr, field = "num" } = {}) {
  if (!slot) return defaultExpr ?? null;

  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
    if (path) return path;
  }

  if (slot.thisRef && sentenceArg) {
    return valueForRole(slot.thisRef, sentenceArg, field, slot);
  }

  if (slot.at && slot.name) {
    const baseName = sanitizeName(slot.name);
    const vecRef = locals?.has(baseName) || declared?.has(baseName) ? baseName : JSON.stringify(slot.name);
    const idxVal = Number(slot.at.num ?? slot.at);
    const idxExpr = Number.isNaN(idxVal) ? (slot.at?.num ?? slot.at ?? 0) : idxVal;
    return `${vecRef}.obj?.ve?.values?.[${idxExpr}]`;
  }

  if (field === "text" && typeof slot.text === "string") {
    return JSON.stringify(slot.text);
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
    if (locals?.has(name)) {
      if (field === "text") return `${name}.obj?.text`;
      if (field === "name") return `${name}.obj?.name`;
      if (field === "num") return `${name}.obj?.num ?? ${name}`;
      return `${name}.obj?.${field} ?? ${name}`;
    }
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
  if (slot.genitive) {
    const path = pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
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

function pathFromGenitive(genitive = [], sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals = false } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  if (!sentenceArg) {
    if (!allowCGlobals) return null;
    // C ceremonies/loops currently use global loop registers instead of passing a sentence object.
    // Allow the common loop-register genitives (this/fromindex/etc) to resolve to those globals.
    // Supported: `this ti fromindex`, `fromindex num of this`, etc.
    const rootName = typeof chainArr[0] === "string" ? sanitizeName(chainArr[0]) : null;
    if (rootName && (locals?.has(rootName) || declared?.has(rootName))) {
      const rest = chainArr.slice(1);
      if (rest.length === 0) return rootName;
      if (rest.length === 1 && rest[0] === "num") return rootName;
      if (rest.length === 2 && rest[0] === "obj" && (rest[1] === "num" || rest[1] === "text" || rest[1] === "boolean")) return rootName;
      return [rootName, ...rest.map(part => `.${part}`)].join("");
    }
    const isThisPrefix = chainArr[0] === "this";
    const isThisSuffix = chainArr[chainArr.length - 1] === "this";
    const parts = isThisPrefix ? chainArr.slice(1) : (isThisSuffix ? chainArr.slice(0, -1) : null);
    if (parts && parts.length) {
      const head = parts[0];
      if (head === "by") {
        if (parts.length === 1) return "by";
        if (parts.length === 2 && parts[1] === "num") return "by";
        if (parts.length === 3 && parts[1] === "obj" && parts[2] === "num") return "by";
      }
      if (parts.length === 1 && ["fromindex", "toindex", "atindex"].includes(head)) return head;
      if (parts.length === 2 && parts[1] === "num" && ["fromindex", "toindex", "atindex"].includes(head)) return head;
    }
    return null;
  }
  const isLocalRoot = chainArr[0] !== "this" && typeof chainArr[0] === "string" && (locals?.has(sanitizeName(chainArr[0])) || declared?.has(sanitizeName(chainArr[0])));
  const chain = chainArr[0] === "this" ? chainArr.slice(1) : chainArr;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 0) return sentenceArg;
  if (chain.length === 2 && chain[1] === "num" && ["fromindex", "toindex", "atindex", "by"].includes(chain[0])) {
    return `${sentenceArg}.${chain[0]}?.num ?? ${sentenceArg}.${chain[0]}`;
  }
  if (isLocalRoot) {
    const [root, ...rest] = chain;
    if (localsTypes?.get(sanitizeName(root)) === "number") {
      if (rest.length === 1 && rest[0] === "num") return sanitizeName(root);
      if (rest.length === 2 && rest[0] === "obj" && rest[1] === "num") {
        const base = sanitizeName(root);
        return `${base}.obj?.num ?? ${base}`;
      }
    }
    return [sanitizeName(root), ...rest.map(part => `.${part}`)].join("");
  }
  return [sentenceArg, ...chain.map(part => `.${part}`)].join("");
}

function valueForRole(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    const access = pathFromGenitive(slot.genitive, sentenceArg, { allowCGlobals: true });
    return access;
  }
  return `${sentenceArg}.${role}?.${field} ?? ${sentenceArg}.${role}`;
}

function targetPath(role, sentenceArg, field = "num", slot = {}, { locals, declared } = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    return pathFromGenitive(slot.genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  }
  return `${sentenceArg}.${role}.${field}`;
}

function vectorExprFromGenitive(genitive, sentenceArg, { locals, declared } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const [root, tail] = chainArr;
  if (chainArr.length === 2 && tail === "ve") {
    if (root === "this") {
      return sentenceArg ? `${sentenceArg}.obj?.ve ?? ${sentenceArg}.ve` : null;
    }
    const name = sanitizeName(root);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}.obj?.ve ?? ${name}.ve`;
    }
    return `remember(${JSON.stringify(root)})?.obj?.ve`;
  }
  const path = pathFromGenitive(genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  return path;
}

function cExpr(expr) {
  return String(expr ?? "0")
    .replace(/\?\./g, ".")
    .replace(/\.obj\.(num|text|name|boolean)\b/g, "")
    .replace(/\s*\?\?\s*[^)]+/g, "");
}

function transpileSentence(sentence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs } = {}) {
  const obj = sentence.obj ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBe = isPermanent ? beWords.slice(1).join(" ") : verb;
  const effectiveBe = baseBe || sentence.mood;

  if (sentence.mood === "ret") {
    const sourceName = sentence?.ret?.name || sentence?.obj?.name || sentence?.subj?.name;
    if (sourceName) {
      return `return ${sanitizeName(sourceName)};`;
    }
    if (sentence.obj?.genitive && sentenceArg) {
      const expr = pathFromGenitive(sentence.obj.genitive, sentenceArg, { locals, declared, allowCGlobals: lang === "c" });
      if (expr) return `return ${expr};`;
    }
    if (sentence.obj?.num !== undefined) return `return ${Number(sentence.obj.num) || 0};`;
    if (typeof sentence.obj?.text === "string") return `return ${JSON.stringify(sentence.obj.text)};`;
    return lang === "c" ? "return;" : "return sentence;";
  }

  if (baseBe === "compile" && (lang === "c" || lang === "javascript")) {
    const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
    const targetState = (sentence?.tostate?.name || sentence?.become?.name || "").toLowerCase();
    if (sourceState === "json" && targetState === "pyash") {
      const sourceText = sentence?.obj?.text ?? sentence?.from?.text ?? sentence?.fromtext?.text;
      if (typeof sourceText !== "string") {
        throwErrorSentence({
          name: "compile error",
          message: "compile: source text is required (from text or from filename)",
          from: { name: "compile" }
        });
      }
      let parsed;
      try {
        parsed = JSON.parse(sourceText);
      } catch (err) {
        throwErrorSentence({
          name: "compile error",
          message: "compile: invalid json",
          from: { name: "compile" },
          raw: { error: err?.message }
        });
      }
      let text;
      try {
        text = jsonToPyashText(parsed, sentence?.subj?.name ?? "data").text;
      } catch (err) {
        throwErrorSentence({
          name: "compile error",
          message: err?.message ?? "compile: json export failed",
          from: { name: "compile" },
          raw: { error: err?.message }
        });
      }
      const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
      const targetName = sentence?.to?.name ?? "output";
      const safeName = sanitizeName(targetName);
      if (declared) declared.add(targetName);
      if (declaredTypes) declaredTypes.set(targetName, "text");
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
        }
        return `char ${safeName}[PYA_TEXT_CAP] = ${JSON.stringify(wrappedText)};`;
      }
      const sentenceObject = `{ subj: { name: "${targetName}" }, obj: { text: ${JSON.stringify(wrappedText)} }, be: "pyash", mood: "ya" }`;
      return `let ${safeName} = ${sentenceObject};\nglobalThis["${targetName}"] = ${safeName};`;
    }
  }

  // Say -> console.log / printf TODO
  if (baseBe === "say") {
    const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
    const wantJson = format === "json";
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

    const genChain = sentence.obj?.genitive?.chain || [];
    const wantsVector = genChain.at(-1) === "ve" || declaredTypes?.get(sentence.obj?.name) === "vector";

    if (lang === "c" && wantsVector) {
      if (cHelpers) {
        cHelpers.usesPrintf = true;
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const vecName = sentence.obj?.name;
      if (vecName && declaredTypes?.get(vecName) === "vector") {
        return `print_vec_sentence(${JSON.stringify(vecName)}, &${sanitizeName(vecName)});`;
      }
      if (sentence.obj?.genitive) {
        const chain = sentence.obj.genitive.chain || [];
        if (chain.length === 2 && chain[1] === "ve" && chain[0] !== "this") {
          const root = sanitizeName(chain[0]);
          if (locals?.has(root) || declared?.has(root)) return `print_vec(&${root});`;
        }
        const vecExpr = vectorExprFromGenitive(sentence.obj.genitive, sentenceArg, { locals, declared });
        if (vecExpr && !vecExpr.includes("remember(")) return `print_vec(${vecExpr});`;
      }
    }

    let expr = "undefined";
    if (typeof obj.text === "string") {
      expr = JSON.stringify(obj.text);
    } else if (obj.genitive) {
      if (wantsVector) {
        if (jsHelpers) jsHelpers.usesVectorFormat = true;
        const vecExpr = vectorExprFromGenitive(obj.genitive, sentenceArg, { locals, declared });
        if (vecExpr) expr = `formatVector((${vecExpr})?.values ?? [], (${vecExpr})?.type ?? "num")`;
      } else {
        expr = pathFromGenitive(obj.genitive, sentenceArg, { allowCGlobals: true }) ?? expr;
      }
	    } else if (obj.name) {
	      const name = sanitizeName(obj.name);
        const isJsonMap = declaredTypes?.get(obj.name) === "json map";
        if (isJsonMap) {
          if (wantJson) {
            if (lang === "c") {
              expr = sanitizeName(`${obj.name}_json`);
            } else {
              if (jsHelpers) jsHelpers.usesJsonMap = true;
              expr = `formatJsonMap(${JSON.stringify(obj.name)})`;
            }
          } else if (mapDefs?.has(obj.name)) {
            const chain = mapDefChainFromName(obj.name, mapDefs);
            expr = JSON.stringify(chain);
          }
        }
	      if (!isJsonMap && lang === "c" && (locals?.has(name) || declared?.has(name))) {
	        expr = name;
      } else if (!isJsonMap && locals?.has(name)) {
        if (declaredTypes?.get(obj.name) === "vector") {
          if (jsHelpers) jsHelpers.usesVectorFormat = true;
          expr = `formatVectorSentence(${JSON.stringify(obj.name)}, ${name}.obj?.ve ?? ${name}.ve)`;
        } else {
          expr = `${name}.obj?.ve?.values ?? ${name}.obj?.text ?? ${name}.obj?.num`;
        }
	      } else if (!isJsonMap && declared?.has(name)) {
	        if (declaredTypes?.get(obj.name) === "vector") {
	          if (jsHelpers) jsHelpers.usesVectorFormat = true;
	          expr = `formatVectorSentence(${JSON.stringify(obj.name)}, ${name}.obj?.ve ?? ${name}.ve)`;
	        } else {
	          expr = `${name}.obj?.ve?.values ?? ${name}.obj?.text ?? ${name}.obj?.num`;
	        }
	      } else if (!isJsonMap) {
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
    const writeFilename = sentence?.to?.filename;
    if (writeFilename && lang !== "c") {
      if (jsHelpers) jsHelpers.usesFs = true;
      const writeLine = `fs.writeFileSync(${JSON.stringify(writeFilename)}, String(${expr}));`;
      return `${writeLine}\nconsole.log(${expr});`;
    }
    if (lang === "c") {
      if (cHelpers) cHelpers.usesPrintf = true;
      const isText = typeof obj.text === "string"
        || (obj.name && (declaredTypes?.get(obj.name) === "text" || declaredTypes?.get(obj.name) === "json map"))
        || (obj.name && localsTypes?.get(sanitizeName(obj.name)) === "text");
      const fmt = isText ? "%s" : "%g";
      if (writeFilename) {
        if (cHelpers) cHelpers.usesStdlib = true;
        const safePath = JSON.stringify(writeFilename);
        return `FILE *out = fopen(${safePath}, "w");\nif (out) { fprintf(out, "${fmt}", ${expr}); fclose(out); }\nprintf("${fmt}\\n", ${expr});`;
      }
      return `printf("${fmt}\\n", ${expr});`;
    }
    return `console.log(${expr});`;
  }

  if (baseBe === "write" && sentence?.to?.filename) {
    const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
    const wantJson = format === "json";
    let expr = "undefined";
    if (typeof obj.text === "string") {
      expr = JSON.stringify(obj.text);
    } else if (obj.genitive) {
      expr = pathFromGenitive(obj.genitive, sentenceArg, { allowCGlobals: true }) ?? expr;
    } else if (obj.name) {
      const name = sanitizeName(obj.name);
      const isJsonMap = declaredTypes?.get(obj.name) === "json map";
      if (isJsonMap) {
        if (wantJson) {
          if (lang === "c") {
            expr = sanitizeName(`${obj.name}_json`);
          } else {
            if (jsHelpers) jsHelpers.usesJsonMap = true;
            expr = `formatJsonMap(${JSON.stringify(obj.name)})`;
          }
        } else if (mapDefs?.has(obj.name)) {
          const chain = mapDefChainFromName(obj.name, mapDefs);
          expr = JSON.stringify(chain);
        }
      }
      if (!isJsonMap && lang === "c" && (locals?.has(name) || declared?.has(name))) {
        expr = name;
      } else if (!isJsonMap && locals?.has(name)) {
        expr = `${name}.obj?.ve?.values ?? ${name}.obj?.text ?? ${name}.obj?.num`;
      } else if (!isJsonMap && declared?.has(name)) {
        expr = `${name}.obj?.ve?.values ?? ${name}.obj?.text ?? ${name}.obj?.num`;
      } else if (!isJsonMap) {
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
    const writeFilename = sentence.to.filename;
    if (lang !== "c") {
      if (jsHelpers) jsHelpers.usesFs = true;
      return `fs.writeFileSync(${JSON.stringify(writeFilename)}, String(${expr}));`;
    }
    if (cHelpers) {
      cHelpers.usesPrintf = true;
      cHelpers.usesStdlib = true;
    }
    const isText = typeof obj.text === "string"
      || (obj.name && (declaredTypes?.get(obj.name) === "text" || declaredTypes?.get(obj.name) === "json map"))
      || (obj.name && localsTypes?.get(sanitizeName(obj.name)) === "text");
    const fmt = isText ? "%s" : "%g";
    const safePath = JSON.stringify(writeFilename);
    return `FILE *out = fopen(${safePath}, "w");\nif (out) { fprintf(out, "${fmt}", ${expr}); fclose(out); }`;
  }

  // Vector element read: obj name doors at num 2 be read to name picked do
  if (baseBe === "read" && obj?.name && ((obj.at?.num != null || obj.at?.genitive) || (sentence.at?.num != null || sentence.at?.genitive)) && (sentence.to?.name || sentenceArg)) {
    const baseName = sanitizeName(obj.name);
    const atSlot = obj.at ?? sentence.at;
    const idxExpr = (() => {
      if (atSlot?.num != null) {
        const idxVal = Number(atSlot.num);
        return Number.isNaN(idxVal) ? atSlot.num : idxVal;
      }
      if (atSlot?.genitive) {
        return pathFromGenitive(atSlot.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: lang === "c" });
      }
      return null;
    })();
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const targetName = sentence.to?.name ?? sentence.subj?.name ?? "result";
    const targetVar = sanitizeName(targetName);
    const lines = [];
    if (lang === "c") {
      if (cHelpers) {
        cHelpers.usesString = true;
        cHelpers.usesTextHelper = true;
        cHelpers.usesStdlib = true;
        cHelpers.usesPrintf = true;
      }
      const vecType = declaredVectorTypes?.get(obj.name) ?? "num";
      const needsDecl = !locals?.has(targetVar) && !declared?.has(targetVar);
      if (vecType === "num") {
        lines.push(needsDecl ? `double ${targetVar} = 0;` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "number");
        lines.push(`${targetVar} = ${baseName}.num_values[(int)(${idxExpr})];`);
      } else if (vecType === "text") {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", ${baseName}.text_values[(int)(${idxExpr})]);`);
      } else {
        lines.push(needsDecl ? `char ${targetVar}[PYA_TEXT_CAP] = "";` : "");
        if (needsDecl) locals?.add(targetVar);
        if (localsTypes) localsTypes.set(targetVar, "text");
        lines.push(`snprintf(${targetVar}, PYA_TEXT_CAP, "%s", (${baseName}.num_values[(int)(${idxExpr})] != 0) ? "truth" : "lie");`);
      }
      return lines.filter(Boolean).join("\n");
    }
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(obj.name)});`);
      locals?.add(baseName);
    }
    const vecType = declaredVectorTypes?.get(obj.name) ?? "num";
    if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
      lines.push(`let ${targetVar} = { subj: { name: "${targetName}" }, obj: {}, be: "${vecType === "num" ? "number" : "text"}", mood: "ya" };`);
      locals?.add(targetVar);
    }
    if (localsTypes) localsTypes.set(targetVar, vecType === "num" ? "number" : "text");
    const valVar = jsHelpers ? `_val_${jsHelpers.readCounter++}` : "_val";
    lines.push(`const ${valVar} = ${baseName}?.obj?.ve?.values?.[(${idxExpr})];`);
    if (vecType === "num") {
      lines.push(`${targetVar}.obj.num = ${valVar};`);
    } else {
      lines.push(`const _text = (${valVar} === true || ${valVar} === 1) ? "truth" : (${valVar} === false || ${valVar} === 0) ? "lie" : String(${valVar} ?? "");`);
      lines.push(`${targetVar}.obj.text = _text;`);
    }
    return lines.join("\n");
  }

	  // Map/foreach over vector: at all (ceremony or primitive verbs)
	  if (sentence.at?.name === "all" && lang !== "c") {
	    if (ceremonyFns?.get(baseBe)) {
	      const fn = ceremonyFns.get(baseBe);
	      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
	      const literal = inlineSentenceLiteral(sentence, inlineSet);
	      if (sentenceArg && sentence.by?.genitive?.chain?.[0] === "this") {
	        const byExpr = pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared }) ?? "0";
	        return `{\n  const _ev = ${literal};\n  _ev.by = { num: (${byExpr} ?? 0) };\n  runAtAll(_ev, ${fn});\n}`;
	      }
	      return `runAtAll(${literal}, ${fn});`;
	    }
	    if (baseBe === "add" || baseBe === "subtract" || baseBe === "invert") {
	      if (sentenceArg) return `// TODO: ${JSON.stringify(sentence)}`;
	      const vecName = sentence.obj?.name;
	      const toName = sentence.to?.name;
	      const delta = Number(sentence.from?.num ?? sentence.obj?.num ?? 0);
	      const op = baseBe === "invert" ? "invert" : baseBe;
      const opBody =
        baseBe === "invert"
          ? `let val = elem;\n    if (typeof val === "number") return val * -1;\n    if (val === "truth" || val === true) return "lie";\n    if (val === "lie" || val === false) return "truth";\n    return val;`
          : baseBe === "add"
            ? `return (Number(elem) || 0) + ${Number.isNaN(delta) ? 0 : delta};`
            : `return (Number(elem) || 0) - ${Number.isNaN(delta) ? 0 : delta};`;
      const lines = [];
      lines.push(`{`);
      lines.push(`let vecFact = remember(${JSON.stringify(vecName ?? sentence.obj ?? "vec")}) || (typeof ${sanitizeName(vecName ?? "vec")} !== "undefined" ? ${sanitizeName(vecName ?? "vec")} : undefined);`);
      lines.push(`const values = vecFact?.obj?.ve?.values ?? vecFact?.ve?.values ?? [];`);
      lines.push(`const outVals = values.map((elem, i) => {`);
      lines.push(opBody.split("\n").map(l => `  ${l}`).join("\n"));
      lines.push(`});`);
      if (toName) {
        lines.push(`const fact = { subj: { name: ${JSON.stringify(toName)} }, obj: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`globalThis[${JSON.stringify(toName)}] = fact;`);
        lines.push(`if (typeof ${sanitizeName(toName)} !== "undefined") { ${sanitizeName(toName)} = fact; }`);
        lines.push(`/* end map */`);
      } else if (vecName) {
        lines.push(`if (vecFact?.obj?.ve) { vecFact.obj.ve.values = outVals; }`);
        lines.push(`const fallback = { subj: { name: ${JSON.stringify(vecName)} }, obj: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`const finalFact = vecFact || fallback;`);
        lines.push(`globalThis[${JSON.stringify(vecName)}] = finalFact;`);
        lines.push(`if (typeof ${sanitizeName(vecName)} !== "undefined") { ${sanitizeName(vecName)} = finalFact; }`);
        lines.push(`/* end map */`);
      } else {
        lines.push(`const fact = { obj: { ve: { values: outVals } }, be: "vector", mood: "ya" };`);
        lines.push(`/* end map */`);
      }
      lines.push(`}`);
      if (rememberFlag) rememberFlag.used = true;
      return lines.join("\n");
    }
  }

  const atSlot = sentence.at ?? obj.at;
  const atNum = atSlot?.num;
  const atGenitive = atSlot?.genitive;

  // Vector element write (JS)
  if (baseBe === "write" && (sentence.to?.name || obj?.name) && (atNum != null || atGenitive) && lang !== "c") {
    const vecNameRaw = sentence.to?.name ?? obj?.name;
    const baseName = sanitizeName(vecNameRaw);
    const genChain = Array.isArray(atGenitive?.chain) ? atGenitive.chain : [];
    const idxExpr =
      atNum != null
        ? (() => {
            const idxVal = Number(atNum);
            return Number.isNaN(idxVal) ? atNum : idxVal;
          })()
        : genChain.length === 3 && genChain[0] === "this" && genChain[2] === "num" && sentenceArg
          ? `${sentenceArg}.${genChain[1]}?.num ?? ${sentenceArg}.${genChain[1]}`
          : (sentenceArg && atGenitive)
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, localsTypes, declaredTypes })
            : null;
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;

    let valueExpr = "undefined";
    if (obj?.num !== undefined) {
      const numVal = Number(obj.num);
      valueExpr = Number.isNaN(numVal) ? obj.num : numVal;
    } else if (obj?.text !== undefined) {
      valueExpr = JSON.stringify(obj.text);
    } else if (obj?.boolean !== undefined) {
      valueExpr = obj.boolean ? "\"truth\"" : "\"lie\"";
    } else if (obj?.genitive) {
      const genExpr = pathFromGenitive(obj.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes });
      if (genExpr) valueExpr = genExpr;
    } else if (obj?.name) {
      const nameExpr = exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (nameExpr) valueExpr = nameExpr;
    }

    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(vecNameRaw)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.obj = ${baseName}.obj ?? {};`);
    lines.push(`${baseName}.obj.ve = ${baseName}.obj.ve ?? {};`);
    lines.push(`${baseName}.obj.ve.values = ${baseName}.obj.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`${baseName}.obj.ve.values[_idx] = ${valueExpr};`);
    return lines.join("\n");
  }

  // Vector element update in C: add/subtract/invert at index
  if (lang === "c") {
    const vecNameRaw = sentence.to?.name ?? obj?.name;
    if (baseBe === "write" && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr =
        atNum != null
          ? (() => {
              const idxVal = Number(atNum);
              return Number.isNaN(idxVal) ? atNum : idxVal;
            })()
          : atGenitive
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, allowCGlobals: true })
            : null;
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const numExpr =
        obj?.genitive
          ? (pathFromGenitive(obj.genitive, sentenceArg, { locals, declared, localsTypes, declaredTypes, allowCGlobals: true }) ?? "0")
          : (obj?.num !== undefined ? String(Number(obj.num) || 0) : (obj?.boolean ? "1" : "0"));
      const boolExpr =
        obj?.boolean !== undefined
          ? (obj.boolean ? "1" : "0")
          : obj?.text === "truth"
            ? "1"
            : obj?.text === "lie"
              ? "0"
              : numExpr;
      const textVal = obj?.text !== undefined ? JSON.stringify(obj.text) : "\"\"";
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${numExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      lines.push(`    ${vecName}.num_values[_idx] = ${boolExpr};`);
      lines.push(`  } else if (strcmp(${vecName}.type, "text") == 0) {`);
      lines.push(`    ${vecName}.text_values[_idx] = ${textVal};`);
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
    if ((baseBe === "add" || baseBe === "subtract" || baseBe === "invert") && vecNameRaw && (atNum != null || atGenitive)) {
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesString = true;
      }
      const vecName = sanitizeName(vecNameRaw);
      const idxExpr =
        atNum != null
          ? (() => {
              const idxVal = Number(atNum);
              return Number.isNaN(idxVal) ? atNum : idxVal;
            })()
          : atGenitive
            ? pathFromGenitive(atGenitive, sentenceArg, { locals, declared, allowCGlobals: true })
            : null;
      if (idxExpr == null) return `/* TODO: ${JSON.stringify(sentence)} */`;
      const deltaVal = Number(obj?.num ?? sentence.from?.num ?? 0);
      const delta = Number.isNaN(deltaVal) ? 0 : deltaVal;
      const lines = [];
      lines.push(`int _idx = (int)(${idxExpr});`);
      lines.push(`if (_idx >= 0 && _idx < ${vecName}.length) {`);
      lines.push(`  if (!${vecName}.type || strcmp(${vecName}.type, "num") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = -${vecName}.num_values[_idx];`);
      } else if (baseBe === "add") {
        lines.push(`    ${vecName}.num_values[_idx] += ${delta};`);
      } else {
        lines.push(`    ${vecName}.num_values[_idx] -= ${delta};`);
      }
      lines.push(`  } else if (strcmp(${vecName}.type, "bool") == 0) {`);
      if (baseBe === "invert") {
        lines.push(`    ${vecName}.num_values[_idx] = ${vecName}.num_values[_idx] != 0 ? 0 : 1;`);
      }
      lines.push("  }");
      lines.push("}");
      return lines.join("\n");
    }
  }

  // Vector element invert (toggle boolean or numeric 0/1): invert obj name doors at num 2 do
  if (baseBe === "invert" && obj?.name && (atNum != null || atGenitive) && lang !== "c") {
    const baseName = sanitizeName(obj.name);
    const genChain = Array.isArray(atGenitive?.chain) ? atGenitive.chain : [];
    const idxExpr =
      atNum != null
        ? (() => {
            const idxVal = Number(atNum);
            return Number.isNaN(idxVal) ? atNum : idxVal;
          })()
        : genChain.length === 3 && genChain[0] === "this" && genChain[2] === "num" && sentenceArg
          ? `${sentenceArg}.${genChain[1]}?.num ?? ${sentenceArg}.${genChain[1]}`
          : (sentenceArg && atGenitive)
            ? pathFromGenitive(atGenitive, sentenceArg)
            : null;
    if (idxExpr == null) return `// TODO: ${JSON.stringify(sentence)}`;
    const lines = [];
    if (!locals?.has(baseName) && !declared?.has(baseName)) {
      lines.push(`const ${baseName} = remember(${JSON.stringify(obj.name)});`);
      locals?.add(baseName);
    }
    lines.push(`${baseName}.obj = ${baseName}.obj ?? {};`);
    lines.push(`${baseName}.obj.ve = ${baseName}.obj.ve ?? {};`);
    lines.push(`${baseName}.obj.ve.values = ${baseName}.obj.ve.values ?? [];`);
    lines.push(`const _idx = (${idxExpr});`);
    lines.push(`const _curr = ${baseName}.obj.ve.values[_idx];`);
    lines.push(`if (${baseName}.obj.ve.type === "num" || typeof _curr === "number") {`);
    lines.push(`  ${baseName}.obj.ve.values[_idx] = (Number(_curr) || 0) * -1;`);
    lines.push(`} else {`);
    lines.push(`  ${baseName}.obj.ve.values[_idx] = (_curr === "truth" || _curr === true || _curr === 1) ? "lie" : "truth";`);
    lines.push(`}`);
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
	    const lhsSlot =
	      (obj && (obj.name || obj.num !== undefined || obj.text !== undefined || obj.genitive || obj.thisRef))
	        ? obj
	        : (sentence.subj?.name ? { name: sentence.subj.name } : obj);
	    const comparesText =
	      lhsSlot?.text !== undefined ||
	      sentence.from?.text !== undefined ||
	      (lhsSlot?.name && localsTypes?.get(sanitizeName(lhsSlot.name)) === "text");
	    const lhs = (() => {
	      if (lhsSlot?.name) {
	        const baseName = sanitizeName(lhsSlot.name);
	        if (locals?.has(baseName)) {
	          return comparesText ? `${baseName}.obj?.text` : `${baseName}.obj?.num ?? ${baseName}`;
	        }
	      }
	      return exprForSlot(lhsSlot, {
	        sentenceArg,
	        locals,
	        declared,
	        defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.obj?.text` : `${sentenceArg}.obj?.num`) : "lhs",
	        field: comparesText ? "text" : "num"
	      }) ?? "lhs";
	    })();
	    const rhs = exprForSlot(sentence.from, {
	      sentenceArg,
	      locals,
	      declared,
	      defaultExpr: sentenceArg ? (comparesText ? `${sentenceArg}.from?.text` : `${sentenceArg}.from?.num`) : "rhs",
	      field: comparesText ? "text" : "num"
	    }) ?? "rhs";
	    const op = baseBe === "tiny" ? "<" : baseBe === "giant" ? ">" : (lang === "c" ? "==" : "===");
	    const consequence = sentence.consequence;
	    const body = transpileSentence(consequence, { lang, sentenceArg, locals, localsTypes, declared, declaredTypes, declaredVectorTypes }) ?? `// TODO: ${JSON.stringify(consequence)}`;
	    const finalBody = body.split("\n").map(l => (l ? `  ${l}` : l)).join("\n");
    const cLhs = lang === "c"
      ? String(lhs)
          .replace(/\?\./g, ".")
          .replace(/\.obj\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : lhs;
    const cRhs = lang === "c"
      ? String(rhs)
          .replace(/\?\./g, ".")
          .replace(/\.obj\.(num|text|name|boolean)\b/g, "")
          .replace(/\s*\?\?\s*[^)]+/g, "")
      : rhs;
	    const jsLhs = `(${lhs})`;
	    const jsRhs = `(${rhs})`;
    const cLhsWrapped = `(${cLhs})`;
    const cRhsWrapped = `(${cRhs})`;
    if (lang === "c" && comparesText && baseBe === "equally") {
      return `if (strcmp(${cLhsWrapped}, ${cRhsWrapped}) == 0) {\n${finalBody}\n}`;
    }
	    return `if (${lang === "c" ? cLhsWrapped : jsLhs} ${op} ${lang === "c" ? cRhsWrapped : jsRhs}) {\n${finalBody}\n}`;
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

  // Text concatenation via add (numeric source)
  if (baseBe === "add" && (sentence.to?.name || sentence.to?.genitive)) {
    const objExpr = exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    const objTextExpr = exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "text" });
    const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
    const targetIsText =
      targetName &&
      (localsTypes?.get(targetName) === "text" || declaredTypes?.get(targetName) === "text");
    const canUseTextExpr =
      typeof obj.text === "string" ||
      (obj?.name && (localsTypes?.get(sanitizeName(obj.name)) === "text" || declaredTypes?.get(sanitizeName(obj.name)) === "text"));
    const valueExpr =
      (canUseTextExpr && objTextExpr !== null)
        ? (typeof obj.text === "string" ? JSON.stringify(obj.text) : `String(${objTextExpr})`)
        : (objExpr !== null ? `String(${objExpr})` : null);
    if (targetIsText && valueExpr !== null) {
      if (sentenceArg) {
        const target = (() => {
          if (sentence.to?.name) {
            const baseName = sanitizeName(sentence.to.name);
            if (locals?.has(baseName)) return `${baseName}.obj.text`;
            if (declaredTypes?.get(baseName) === "text") return `${baseName}.obj.text`;
          }
          return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
        })();
        const init = `${target} = ${target} ?? "";`;
        const concat = `${target} = ${target} + ${valueExpr};`;
        return `${init}\n${concat}`;
      }
      if (lang === "c") {
        if (cHelpers) {
          cHelpers.usesTextHelper = true;
          cHelpers.usesString = true;
          cHelpers.usesPrintf = true;
        }
        const target = sanitizeName(sentence.to.name);
        if (typeof obj.text === "string") {
          return `pya_concat_buf(${target}, ${JSON.stringify(obj.text)});`;
        }
        const numExpr = exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: "0", field: "num" }) ?? "0";
        return `pya_concat_num_buf(${target}, ${numExpr});`;
      }
      return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.text = (${sentence.to.name}.obj.text ?? \"\") + ${valueExpr};`;
    }
  }

  // Imperative add
  if (baseBe === "add" && obj.num !== undefined && sentenceArg && !sentence.to) {
    const increment = typeof obj.num === "number" ? obj.num : Number(obj.num);
    const safeInc = Number.isNaN(increment) ? 0 : increment;
    const lines = [];
    lines.push(`${sentenceArg}.obj = ${sentenceArg}.obj ?? {};`);
    lines.push(`const _target = ${sentenceArg}.obj?.obj ?? ${sentenceArg}.obj;`);
    lines.push(`_target.num = (_target.num ?? 0) + ${safeInc};`);
    return lines.join("\n");
  }

	  if (baseBe === "add" && obj.num !== undefined && (sentence.to?.name || sentence.to?.genitive)) {
	    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
	    if (sentenceArg) {
	      // Compiler-only sugar: inside ceremonies, `to <localName>` targets the local fact object.
	      if (sentence.to?.name) {
	        const localName = sanitizeName(sentence.to.name);
	        if (locals?.has(localName)) {
	          const inc = Number.isNaN(safeValue) ? 0 : safeValue;
	          const lines = [];
	          lines.push(`${localName}.obj = ${localName}.obj?.obj ?? ${localName}.obj ?? {};`);
	          lines.push(`${localName}.obj.num = (${localName}.obj.num ?? 0) + ${inc};`);
	          return lines.join("\n");
	        }
	      }
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
        ? isThisGenitive
          ? sentenceArg
          : `${sentenceArg}.to ?? { subj: { name: ${targetNameLiteral} }, obj: {} }`
        : sentenceArg;
      const lines = [];
      if (!isThisGenitive && !locals?.has(targetVar) && !declared?.has(targetVar)) {
        lines.push(`const ${targetVar} = remember(${targetExpr});`);
        locals?.add(targetVar);
      }
	      lines.push(`${targetVar}.obj = ${targetVar}.obj?.obj ?? ${targetVar}.obj ?? {};`);
	      const fieldPath = sentence.to?.genitive
	        ? pathFromGenitive(sentence.to.genitive, targetVar, { locals, declared }) || `${targetVar}.obj.num`
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
      const target = (() => {
        if (sentence.to?.name) {
          const baseName = sanitizeName(sentence.to.name);
          if (locals?.has(baseName)) return `${baseName}.obj.text`;
        }
        return targetPath("to", sentenceArg, "text", sentence.to, { locals, declared }) ?? sentence.to?.name;
      })();
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

  if (baseBe === "subtract" && obj.num !== undefined && ((sentence.to?.name || sentence.from?.name) || sentenceArg)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const targetSlot = sentence.to ?? sentence.from;
      const targetRole = sentence.to ? "to" : "from";
      const hasGenitive = Boolean(targetSlot?.genitive);
      if (!hasGenitive && targetSlot?.name) {
        const baseName = sanitizeName(targetSlot.name);
        const lines = [];
        if (!locals?.has(baseName) && !declared?.has(baseName)) {
          lines.push(`let ${baseName};`);
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
        }
        if (lang === "c") {
          lines.push(`${baseName} = (${baseName} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        } else {
          lines.push(`${baseName}.obj = ${baseName}.obj ?? {};`);
          lines.push(`${baseName}.obj.num = (${baseName}.obj.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`);
        }
        return lines.join("\n");
      }
      const target = targetPath(targetRole, sentenceArg, "num", targetSlot, { locals, declared }) ?? targetSlot?.name;
      return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    const targetSlot = sentence.to ?? sentence.from;
    const targetName = targetSlot?.name;
    if (!targetName) return `// TODO: ${JSON.stringify(sentence)}`;
    if (lang === "c") {
      return `${targetName} = ${targetName} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${targetName}.obj = ${targetName}.obj ?? {};\n${targetName}.obj.num = (${targetName}.obj.num ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (
    baseBe === "multiply" &&
    sentence.by &&
    (sentence.obj || sentence.from) &&
    (sentence.to?.name || sentenceArg) &&
    (sentence.by?.name || sentence.by?.genitive || sentence.by?.thisRef || sentence.obj?.name || sentence.obj?.genitive || sentence.obj?.thisRef || sentence.from?.name || sentence.from?.genitive || sentence.from?.thisRef)
  ) {
    const lhsSlot = sentence.obj ?? sentence.from;
    const rhsSlot = sentence.by;
    const numericExpr = (slot) => {
      if (!slot) return "0";
      if (slot.num !== undefined) {
        const n = Number(slot.num);
        return Number.isNaN(n) ? "0" : String(n);
      }
      if (slot.name) {
        const base = sanitizeName(slot.name);
        if (lang === "c") {
          if (locals?.has(base) || declared?.has(base)) return base;
          return base;
        }
        if (localsTypes?.get(base) === "number" || declaredTypes?.get(base) === "number") {
          return `${base}.obj?.num ?? ${base}`;
        }
        if (locals?.has(base)) return base;
        if (declared?.has(base)) return `${base}.obj?.num ?? ${base}`;
        return base;
      }
      const direct = exprForSlot(slot, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
      if (direct) return direct;
      return "0";
    };
    const lhsExpr = numericExpr(lhsSlot);
    const rhsExpr = numericExpr(rhsSlot);
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
        if (localsTypes) localsTypes.set(baseName, "number");
        lines.push(`${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`);
        return lines.join("\n");
      }
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
    }
    if (lang === "c") {
      const baseName = sanitizeName(sentence.to.name);
      const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
      if (needsDecl) locals?.add(baseName);
      return needsDecl
        ? `double ${baseName} = (${lhsExpr}) * (${rhsExpr});`
        : `${baseName} = (${lhsExpr}) * (${rhsExpr});`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${lhsExpr} ?? 0) * (${rhsExpr} ?? 0);`;
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
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
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
      const target = targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? sentence.to?.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    if (lang === "c") {
      return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
    }
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) / ${divisor};`;
  }

	  if (baseBe === "remains" && (obj.num !== undefined || sentence.from?.num !== undefined || obj.name || obj.genitive || obj.thisRef) && (sentence.to?.name || sentenceArg)) {
	    if (sentenceArg) {
	      const targetGenitive = sentence.to?.genitive ? pathFromGenitive(sentence.to.genitive, sentenceArg, { locals, declared }) : null;
	      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
	      const source = (() => {
	        if (sentence.obj?.genitive && sentenceArg) return pathFromGenitive(sentence.obj.genitive, sentenceArg, { locals, declared });
	        if (obj?.name) {
	          const baseName = sanitizeName(obj.name);
	          if (locals?.has(baseName)) return `${baseName}.obj?.num`;
	        }
	        return exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
	      })();
	      const divisorExpr = exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ??
	        exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });

      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        lines.push(`let ${targetName};`);
        locals?.add(targetName);
      }

      const lhs = targetGenitive
        ? targetGenitive
        : targetName
          ? lvalueForName(targetName, { declared, locals })
	          : targetPath("to", sentenceArg, "num", sentence.to, { locals, declared }) ?? `${sentenceArg}.obj?.num`;
      const numerator = source ?? lhs;
      const div = divisorExpr ?? "0";
      lines.push(`if ((${div} ?? 0) === 0) throw new Error("remains: from cannot be zero");`);
      const expr = `(${numerator} ?? 0) % (${div} ?? 0)`;
      lines.push(`${lhs} = ${expr};`);
      return lines.join("\n");
    }
    if (lang === "c") {
      const targetName = sentence.to?.name ? sanitizeName(sentence.to.name) : null;
      const hasExplicitDivisor = sentence.from != null || sentence.by != null;
      const divisor = hasExplicitDivisor
        ? (exprForSlot(sentence.from ?? sentence.by, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0")
        : (exprForSlot(sentence.obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" }) ?? "0");
      // If the user wrote `obj num N to name X be remains do`, treat N as the divisor and X as the dividend.
      // Otherwise, treat `obj ... from ...` as dividend/divisor.
      const numerator = (!hasExplicitDivisor && sentence.obj?.num !== undefined)
        ? (targetName ?? "0")
        : (exprForSlot(sentence.obj, { sentenceArg, locals, declared, defaultExpr: targetName, field: "num" }) ?? targetName ?? "0");
      const lhs = targetName ?? "result";
      const lines = [];
      if (targetName && !locals?.has(targetName) && !declared?.has(targetName)) {
        locals?.add(targetName);
        lines.push(`double ${targetName} = 0;`);
      }
      if (cHelpers) cHelpers.usesPrintf = cHelpers.usesPrintf; // no-op; keep helper object alive
      const cDivisor = cExpr(divisor);
      const cNumerator = cExpr(numerator);
      lines.push(`if ((${cDivisor}) == 0) { /* remains: from cannot be zero */ } else { ${lhs} = fmod(${cNumerator}, ${cDivisor}); }`);
      return lines.join("\n");
    }
    const divisorRaw = sentence.from?.num ?? obj.num;
    const divisor = typeof divisorRaw === "number" ? divisorRaw : Number(divisorRaw);
    const safeValue = Number.isNaN(divisor) ? 0 : divisor;
    return `${sentence.to.name}.obj = ${sentence.to.name}.obj ?? {};\n${sentence.to.name}.obj.num = (${sentence.to.name}.obj.num ?? 0) % ${safeValue};`;
  }

  const name = sentence?.subj?.name;
  const mood = sentence?.mood;
  if (mood === "do" && sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
    if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const evokerLiteral = inlineSentenceLiteral(sentence, inlineSet);
      if (loopShim) loopShim.used = true;
      const genFromExpr = sentence.fromindex?.genitive
        ? pathFromGenitive(sentence.fromindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genToExpr = sentence.toindex?.genitive
        ? pathFromGenitive(sentence.toindex.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (genFromExpr || genToExpr) {
        const lines = ["{"];
        lines.push(`const _call = ${evokerLiteral};`);
        if (genFromExpr) lines.push(`_call.fromindex = { num: ${genFromExpr} };`);
        if (genToExpr) lines.push(`_call.toindex = { num: ${genToExpr} };`);
        lines.push(`runLoop(_call, ${fn});`);
        lines.push("}");
        return lines.join("\n");
      }
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      const inlineSet = new Set([...(declared || []), ...(locals || [])]);
      const arg = inlineSentenceLiteral(sentence, inlineSet);
      const genObjExpr = sentence.obj?.genitive
        ? pathFromGenitive(sentence.obj.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      const genByExpr = sentence.by?.genitive
        ? pathFromGenitive(sentence.by.genitive, sentenceArg, { locals, declared, allowCGlobals: true })
        : null;
      if (sentence.to?.name) {
        const targetVar = sanitizeName(sentence.to.name);
        const lines = [];
        if (!locals?.has(targetVar) && !declared?.has(targetVar)) {
          lines.push(`let ${targetVar};`);
          locals?.add(targetVar);
        }
        if (genObjExpr || genByExpr) {
          lines.push("{");
          lines.push(`const _call = ${arg};`);
          if (genObjExpr) {
            lines.push(`_call.obj = { num: ${genObjExpr} };`);
          }
          if (genByExpr) {
            lines.push(`_call.by = { num: ${genByExpr} };`);
          }
          lines.push(`${targetVar} = ${fn}(_call);`);
          lines.push("}");
        } else {
          lines.push(`${targetVar} = ${fn}(${arg});`);
        }
        return lines.join("\n");
      }
      if (genObjExpr || genByExpr) {
        const lines = ["{", `  const _call = ${arg};`];
        if (genObjExpr) lines.push(`  _call.obj = { num: ${genObjExpr} };`);
        if (genByExpr) lines.push(`  _call.by = { num: ${genByExpr} };`);
        lines.push(`  ${fn}(_call);`, "}");
        return lines.join("\n");
      }
      return `${fn}(${arg});`;
    }
  }

  if (mood === "do" && !sentenceArg) {
    const fn = ceremonyFns?.get(baseBe);
	    if (fn && (sentence.fromindex !== undefined || sentence.toindex !== undefined)) {
	        if (lang === "c") {
	          const loopId = cState ? cState.vectorCounter++ : 0;
	          const byExpr = (() => {
	            if (sentence.by?.num !== undefined) return Number(sentence.by.num) || 0;
	            if (sentence.by?.name) return sanitizeName(sentence.by.name);
	            if (sentence.by?.genitive) return pathFromGenitive(sentence.by.genitive, undefined, { allowCGlobals: true }) ?? "0";
	            return null;
	          })();
	          const fromGenChain = sentence.fromindex?.genitive?.chain;
	          const fromGenFallback = (Array.isArray(fromGenChain) && typeof fromGenChain[0] === "string")
	            ? sanitizeName(fromGenChain[0])
	            : null;
	          const start = sentence.fromindex?.genitive
	            ? (pathFromGenitive(sentence.fromindex.genitive, undefined, { allowCGlobals: true }) ?? fromGenFallback ?? 0)
	            : (sentence.fromindex?.num ?? sentence.fromindex ?? 0);
	          const hasUntil = sentence.toindex !== undefined;
	          const toGenChain = sentence.toindex?.genitive?.chain;
	          const toGenFallback = (Array.isArray(toGenChain) && typeof toGenChain[0] === "string")
	            ? sanitizeName(toGenChain[0])
	            : null;
	          const untilVal = sentence.toindex?.genitive
	            ? (pathFromGenitive(sentence.toindex.genitive, undefined, { allowCGlobals: true }) ?? toGenFallback ?? 0)
	            : (sentence.toindex?.num ?? sentence.toindex ?? 0);
	          if (hasUntil) {
	            const step = untilVal > start ? 1 : -1;
	            const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
	            return `{ double _saved_fromindex_${loopId} = fromindex; double _saved_toindex_${loopId} = toindex; for (fromindex = ${start}; fromindex != ${untilVal}; fromindex += ${step}) { toindex = ${untilVal}; ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; toindex = _saved_toindex_${loopId}; }`;
	          }
	          const byAssign = byExpr !== null ? `by = ${byExpr}; ` : "";
	          return `{ double _saved_fromindex_${loopId} = fromindex; for (fromindex = ${start}; fromindex > 0; fromindex--) { ${byAssign}${fn}(); } fromindex = _saved_fromindex_${loopId}; }`;
	        }
	        const evokerLiteral = inlineSentenceLiteral(sentence, declared);
	        if (loopShim) loopShim.used = true;
      return `runLoop(${evokerLiteral}, ${fn});`;
    }
    if (fn) {
      if (lang === "c") return `${fn}();`;
      const arg = inlineSentenceLiteral(sentence, declared);
      if (sentence.to?.name) {
        const targetVar = sanitizeName(sentence.to.name);
        const lines = [];
        if (!declared?.has(targetVar)) {
          lines.push(`let ${targetVar};`);
          declared?.add(targetVar);
        }
        lines.push(`${targetVar} = ${fn}(${arg});`);
        lines.push(`globalThis["${sentence.to.name}"] = ${targetVar};`);
        return lines.join("\n");
      }
      return `${fn}(${arg});`;
    }
  }
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);

  if (effectiveBe === "vector" && obj.ve?.values) {
    const fillCountExpr = (() => {
      if (typeof sentence.by?.num === "number") return String(Math.trunc(sentence.by.num));
      if (sentence.by?.name) {
        const base = sanitizeName(sentence.by.name);
        if (declared?.has(base) || locals?.has(base)) return `(${base}?.obj?.num ?? 0)`;
      }
      if (sentence.by?.genitive && !sentenceArg) {
        const chain = sentence.by.genitive.chain || [];
        const root = chain[0];
        if (typeof root === "string") {
          const base = sanitizeName(root);
          if (declared?.has(base) || locals?.has(base)) {
            const path = pathFromGenitive(sentence.by.genitive, "IGNORED", { locals, declared });
            // pathFromGenitive can't run without a real sentence arg; handle the common "num of obj of X" case.
            if (chain.length === 3 && chain[1] === "obj" && chain[2] === "num") return `(${base}?.obj?.num ?? 0)`;
          }
        }
      }
      return null;
    })();

    const rawType = obj.ve.type || "num";
    const vecType = rawType === "number" ? "num" : rawType;
    if (fillCountExpr && obj.ve.values.length === 1) {
      const elem = obj.ve.values[0];
      const elemLiteral = typeof elem === "number" ? String(elem) : JSON.stringify(elem);
      const vecLiteral = `{ type: "${vecType}", values: Array(${fillCountExpr}).fill(${elemLiteral}) }`;
      if (sentenceArg) {
        const target = valueForRole("subj", sentenceArg, "ve", sentence.subj) ?? name;
        return `${target} = ${vecLiteral};`;
      }
      const sentenceObject = `{ subj: { name: "${name}" }, obj: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      if (lang === "c") {
        const isLiteralCount = /^\d+$/.test(String(fillCountExpr));
        if (!isLiteralCount) return `/* TODO: vector fill with dynamic count in C */`;
        const count = Number(fillCountExpr);
        const suffix = cState ? cState.vectorCounter++ : 0;
        if (cHelpers) {
          cHelpers.usesVectorType = true;
          cHelpers.usesVectorPrinter = true;
          cHelpers.usesString = true;
          cHelpers.usesCtype = true;
        }
        if (vecType === "bool") {
          const val = elem === "truth" || elem === true || elem === 1 ? 1 : 0;
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "bool", ${count}, ${name}_values, NULL };`;
          }
          return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "bool", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
        }
        if (vecType === "text") {
          const val = JSON.stringify(String(elem));
          const values = Array(count).fill(val).join(", ");
          if (shouldDeclare) {
            return `const char *${name}_values[] = { ${values} };\npya_vec ${name} = { "text", ${count}, NULL, ${name}_values };`;
          }
          return `do { const char *${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "text", ${count}, NULL, ${name}_values_${suffix} }; } while(0);`;
        }
        if (vecType !== "num") return `/* TODO: vector support in C for ${vecType} */`;
        const numVal = typeof elem === "number" ? elem : Number(elem) || 0;
        const values = Array(count).fill(numVal).join(", ");
        if (shouldDeclare) {
          return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "num", ${count}, ${name}_values, NULL };`;
        }
        return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "num", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
      }
      return shouldDeclare
        ? `${shouldDeclare ? "let" : ""} ${sanitizeName(name)} = ${sentenceObject};\nglobalThis[${JSON.stringify(name)}] = ${sanitizeName(name)};`
        : sentenceObject;
    }

    const values = obj.ve.values
      .map(v => (typeof v === "number" ? v : JSON.stringify(v)))
      .join(", ");
    const vecLiteral = `{ type: "${vecType}", values: [${values}] }`;
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "ve", sentence.subj) ?? name;
      return `${target} = ${vecLiteral};`;
    }
    const sentenceObject = `{ subj: { name: "${name}" }, obj: { ve: ${vecLiteral} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      const suffix = cState ? cState.vectorCounter++ : 0;
      if (cHelpers) {
        cHelpers.usesVectorType = true;
        cHelpers.usesVectorPrinter = true;
        cHelpers.usesString = true;
        cHelpers.usesCtype = true;
      }
      const count = obj.ve.values.length;
      if (vecType === "text") {
        const values = obj.ve.values.map(v => JSON.stringify(String(v))).join(", ");
        if (shouldDeclare) {
          return `const char *${name}_values[] = { ${values} };\npya_vec ${name} = { "text", ${count}, NULL, ${name}_values };`;
        }
        return `do { const char *${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "text", ${count}, NULL, ${name}_values_${suffix} }; } while(0);`;
      }
      if (vecType === "bool") {
        const values = obj.ve.values
          .map(v => (v === "truth" || v === true || v === 1 ? 1 : 0))
          .join(", ");
        if (shouldDeclare) {
          return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "bool", ${count}, ${name}_values, NULL };`;
        }
        return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "bool", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
      }
      if (vecType !== "num") {
        return `/* TODO: vector support in C for ${vecType} */`;
      }
      const values = obj.ve.values
        .map(v => (typeof v === "number" ? v : Number(v) || 0))
        .join(", ");
      if (shouldDeclare) {
        return `double ${name}_values[] = { ${values} };\npya_vec ${name} = { "num", ${count}, ${name}_values, NULL };`;
      }
      return `do { double ${name}_values_${suffix}[] = { ${values} }; ${name} = (pya_vec){ "num", ${count}, ${name}_values_${suffix}, NULL }; } while(0);`;
    }
    if (shouldDeclare) {
      return `let ${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
    }
    return `${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
  }

  if (effectiveBe === "number") {
    const rhsExpr = exprForSlot(obj, { sentenceArg, locals, declared, defaultExpr: null, field: "num" });
    if (sentenceArg && rhsExpr !== null) {
      const baseName = sentence.subj?.name ? sanitizeName(sentence.subj.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "number");
          if (obj?.thisRef === "obj") {
            return `let ${baseName} = { subj: { name: "${sentence.subj.name}" }, obj: {}, be: "number", mood: "ya" };\n${baseName}.obj = ${sentenceArg}.obj;`;
          }
          return `let ${baseName} = { subj: { name: "${sentence.subj.name}" }, obj: {}, be: "number", mood: "ya" };\n${baseName}.obj.num = ${rhsExpr};`;
        }
        if (localsTypes) localsTypes.set(baseName, "number");
        if (obj?.thisRef === "obj") {
          return `${baseName}.obj = ${sentenceArg}.obj;`;
        }
        return `${baseName}.obj = ${baseName}.obj ?? {};\n${baseName}.obj.num = ${rhsExpr};`;
      }
      const target = valueForRole("subj", sentenceArg, "num", sentence.subj) ?? `${sentenceArg}.obj?.num`;
      return `${target} = ${rhsExpr};`;
    }

    if (lang === "c" && !sentenceArg && sentence.subj?.name) {
      const baseName = sanitizeName(sentence.subj.name);
      const fromRef = obj?.thisRef ? obj.thisRef : null;
      const rhs = rhsExpr ?? fromRef ?? (typeof obj.num !== "undefined" ? obj.num : null);
      if (rhs !== null) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) locals?.add(baseName);
        return needsDecl ? `double ${baseName} = ${rhs};` : `${baseName} = ${rhs};`;
      }
    }

    if (typeof obj.num !== "undefined") {
      const value = typeof obj.num === "number" ? obj.num : Number(obj.num);
      const safeValue = Number.isNaN(value) ? 0 : value;
      const sentenceObject = `{ subj: { name: "${name}" }, obj: { num: ${safeValue} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
      const decl = shouldDeclare ? (lang === "c" ? "/* TODO: sentence object in C */" : (isPermanent ? "const" : "let")) : "";
      if (lang === "c") {
        // Fallback for C for now: keep scalar style
        if (!shouldDeclare) return `${name} = ${safeValue};`;
        const cdecl = isPermanent ? "const double" : "double";
        return `${cdecl} ${name} = ${safeValue};`;
      }
      if (shouldDeclare) {
        return `${decl} ${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
      }
      return `${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
    }
  }

  if (effectiveBe === "text" && typeof obj.text === "string") {
    const value = JSON.stringify(obj.text);
    if (sentenceArg) {
      const baseName = sentence.subj?.name ? sanitizeName(sentence.subj.name) : null;
      if (baseName) {
        const needsDecl = !locals?.has(baseName) && !declared?.has(baseName);
        if (needsDecl) {
          locals?.add(baseName);
          if (localsTypes) localsTypes.set(baseName, "text");
          return `let ${baseName} = { subj: { name: "${sentence.subj.name}" }, obj: {}, be: "text", mood: "ya" };\n${baseName}.obj.text = ${value};`;
        }
        if (localsTypes) localsTypes.set(baseName, "text");
        return `${baseName}.obj = ${baseName}.obj ?? {};\n${baseName}.obj.text = ${value};`;
      }
      const target = valueForRole("subj", sentenceArg, "text") ?? name;
      return `${target} = ${value};`;
    }
    const sentenceObject = `{ subj: { name: "${name}" }, obj: { text: ${value} }, be: "${effectiveBe}", exists: ${shouldDeclare}, mood: "ya" }`;
    if (lang === "c") {
      // Fallback for C: keep scalar style
      if (cHelpers) {
        cHelpers.usesTextHelper = true;
        cHelpers.usesString = true;
        cHelpers.usesPrintf = true;
      }
      if (!shouldDeclare) return `snprintf(${name}, PYA_TEXT_CAP, "%s", ${value});`;
      return `char ${name}[PYA_TEXT_CAP] = ${value};`;
    }
    if (shouldDeclare) {
      return `let ${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
    }
    return `${name} = ${sentenceObject};\nglobalThis["${name}"] = ${name};`;
  }

  return null;
}

const SEQUENCE_REGISTERS = new Set(["fromindex", "toindex", "atindex"]);

function collectSequenceDeps(sentences) {
  const deps = new Set();
  const scanValue = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.thisRef && SEQUENCE_REGISTERS.has(value.thisRef)) {
      deps.add(value.thisRef);
    }
    if (value.genitive?.chain) {
      const chain = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
      if (chain.includes("this")) {
        for (const reg of SEQUENCE_REGISTERS) {
          if (chain.includes(reg)) deps.add(reg);
        }
      }
    }
    if (Array.isArray(value)) value.forEach(scanValue);
  };
  const scanSentence = (sentence) => {
    if (!sentence || typeof sentence !== "object") return;
    for (const [key, value] of Object.entries(sentence)) {
      if (key === "consequence") {
        scanSentence(value);
        continue;
      }
      scanValue(value);
    }
  };

  if (Array.isArray(sentences)) {
    sentences.forEach(scanSentence);
  } else {
    scanSentence(sentences);
  }

  return deps;
}

function transpileCeremony(defSentence, bodySentences, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState }) {
  const seqDeps = collectSequenceDeps(bodySentences);
  for (const reg of seqDeps) {
    if (!defSentence?.[reg]) {
      throwErrorSentence({
        name: "sequence register missing",
        message: `ceremony "${defSentence?.subj?.name ?? "ceremony"}" reads this ${reg} but definition omits ${reg}`,
        from: { name: "compile" },
        raw: { ceremony: defSentence?.subj?.name, missing: reg }
      });
    }
  }

  const signatureWords = deriveSignatureFromDefinition(defSentence);
  const fnBaseName = signatureWords
    ? joinSignatureWords(signatureWords).replace(/\s+/g, "_")
    : (defSentence?.subj?.name || "ceremony");
  const fnName = sanitizeName(fnBaseName);

  const bodyLines = [];
  let hasReturn = false;
  const locals = new Set();
  const localsTypes = new Map();
  for (const s of bodySentences) {
    const line = transpileSentence(s, { lang, sentenceArg: lang === "c" ? undefined : "sentence", locals, localsTypes, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState });
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
  let usesMapShim = false;
  const rememberFlag = { used: false };
  const cHelpers = { usesPrintf: false, usesVectorType: false, usesVectorPrinter: false, usesString: false, usesCtype: false, usesStdlib: false, usesTextHelper: false };
  const loopShim = { used: false };
  const mindShim = { used: false };
    const jsHelpers = { usesVectorFormat: false, usesJsonMap: false, usesFs: false, readCounter: 0 };
  const cState = { vectorCounter: 0, jsonMapStrings: new Map() };
  const mapDefs = new Map();
  const declared = new Set();
  const declaredTypes = new Map();
  const ceremonyFns = new Map();
  const declaredVectorTypes = new Map();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const name = sentence?.subj?.name;

    if (sentence.mood === "def" && sentence.be === "ceremony") {
      if (sentence.subj?.name && ceremonyFns.has(sentence.subj.name)) {
        console.warn(`ceremony redefined: ${sentence.subj.name}`);
      }
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const fn = transpileCeremony(sentence, body, { lang, declared, declaredTypes, declaredVectorTypes, ceremonyFns, cHelpers, jsHelpers, cState });
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
	      if (typeof fn === "string" && fn.includes("runAtAll(")) {
	        usesMapShim = true;
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

    if (sentence.mood === "def" && (sentence.be === "map" || sentence.be === "json map")) {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const map = {};
      for (const entry of body) {
        const key = entry?.subj?.name;
        if (!key) continue;
        map[key] = entry.obj ?? {};
      }
      const mapSentence = {
        mood: "ya",
        subj: { name },
        be: sentence.be,
        obj: { map }
      };
      mapDefs.set(name, mapSentence);

      if (sentence.be === "json map") {
        try {
          const jsonObj = jsonFromMapSentence(mapSentence, mapDefs, new Set());
          cState.jsonMapStrings.set(name, JSON.stringify(jsonObj, null, 2));
        } catch (err) {
          throwErrorSentence({
            name: "json map export failed",
            message: err?.message ?? String(err),
            from: { name: "compile" },
            raw: { name, error: err?.message }
          });
        }
      }

      if (lang === "c") {
        if (sentence.be === "json map") {
          const jsonText = cState.jsonMapStrings.get(name);
          if (jsonText) {
            const varName = sanitizeName(`${name}_json`);
            lines.push(`const char *${varName} = ${JSON.stringify(jsonText)};`);
          }
        }
      } else {
        const varName = sanitizeName(name);
        const payload = JSON.stringify(mapSentence);
        lines.push(`const ${varName} = ${payload};`);
        lines.push(`globalThis[${JSON.stringify(name)}] = ${varName};`);
      }

      if (name) {
        declared.add(name);
        declaredTypes.set(name, sentence.be);
      }

      i = j;
      continue;
    }

    if (sentence.mood === "ya" && name && !sentence.exists && !declared.has(name)) {
      const pyash = sentenceToPyash(sentence);
      throwErrorSentence({
        name: "variable as not exists",
        message: `subj quoted.pyash.${pyash}.pyash.quoted be error obj name variable as not exists ya`,
        from: { name: "compile" },
        pyash,
        raw: sentence
      });
    }

    const line = transpileSentence(sentence, { lang, ceremonyFns, declared, declaredTypes, declaredVectorTypes, loopShim, mindShim, cHelpers, rememberFlag, jsHelpers, cState, mapDefs });
    if (typeof line === "string" && line.includes("remember(")) {
      usesRememberShim = true;
    }
    if (rememberFlag.used) {
      usesRememberShim = true;
      rememberFlag.used = false;
    }
    if (typeof line === "string" && line.includes("runAtAll(")) {
      usesMapShim = true;
      usesRememberShim = true;
    }
    const todoPrefix = lang === "c" ? "/* TODO" : "// TODO";
    const todoSuffix = lang === "c" ? " */" : "";
    const target = (() => {
      if (lang === "c" && sentence.mood === "ya") {
        if (typeof line === "string" && (line.startsWith("double ") || line.startsWith("const char") || line.startsWith("char *") || line.startsWith("char ") || line.startsWith("pya_vec "))) {
          return lines; // keep declarations global
        }
      }
      return lang === "c" ? mainLines : lines;
    })();
    target.push(line ?? `${todoPrefix}: ${JSON.stringify(sentence)}${todoSuffix}`);
    if (name && sentence.mood === "ya") {
      declared.add(name);
      if (sentence.be === "text" || sentence.obj?.text !== undefined) {
        declaredTypes.set(name, "text");
      } else if (sentence.be === "number" || sentence.obj?.num !== undefined) {
        declaredTypes.set(name, "number");
      } else if (sentence.be === "vector" || sentence.obj?.ve) {
        declaredTypes.set(name, "vector");
        if (sentence.obj?.ve?.type) {
          declaredVectorTypes.set(name, sentence.obj.ve.type);
        }
      }
    }
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
      const rememberShim = `const remember = (typeof globalThis.remember === "function" ? globalThis.remember : (ref) => {\n  if (ref && typeof ref === "object") {\n    const name = ref.name || ref.subj?.name;\n    if (typeof name === \"string\") {\n      if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, name)) return globalThis[name];\n    }\n    return ref;\n  }\n  if (typeof ref === \"string\") {\n    if (globalThis && Object.prototype.hasOwnProperty.call(globalThis, ref)) return globalThis[ref];\n    return undefined;\n  }\n  return ref;\n});`;
      prelude.push(rememberShim);
    }
    if (usesMapShim) {
      const cloneShim = `const structuredClone = globalThis.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));`;
      prelude.push(cloneShim);
	      const mapHelper = `function runAtAll(sentence, fn) {\n  // Resolve genitive by (like \"by num of fromindex of this\") against the evoker sentence once.\n  if (sentence?.by?.genitive?.chain?.[0] === \"this\") {\n    let curr = sentence;\n    for (const part of sentence.by.genitive.chain.slice(1)) {\n      if (typeof curr === \"number\") {\n        if (part === \"num\") continue;\n        curr = undefined;\n        break;\n      }\n      curr = curr?.[part];\n    }\n    const resolved = (typeof curr === \"number\") ? curr : curr?.num;\n    if (typeof resolved === \"number\") sentence.by = { num: resolved };\n  }\n  const vecFact = remember(sentence.obj?.name ?? sentence.obj);\n  const values = vecFact?.obj?.ve?.values ?? [];\n  const out = values.map((elem, i) => {\n    const elemSentence = structuredClone(sentence);\n    if (typeof elem === \"number\") elemSentence.obj = { num: elem };\n    else if (typeof elem === \"string\") elemSentence.obj = { text: elem };\n    else if (typeof elem === \"boolean\") elemSentence.obj = { boolean: elem };\n    else elemSentence.obj = elem ?? {};\n    elemSentence.atindex = { num: i, register: true };\n    elemSentence.this = { ...(elemSentence.this || {}), atindex: elemSentence.atindex, by: elemSentence.by, fromindex: elemSentence.fromindex, toindex: elemSentence.toindex };\n    const res = fn(elemSentence) ?? elemSentence;\n    const obj = res?.obj ?? elemSentence.obj;\n    if (obj?.num !== undefined) return obj.num;\n    if (obj?.text !== undefined) return obj.text;\n    if (obj?.boolean !== undefined) return obj.boolean;\n    return obj;\n  });\n  if (sentence.to?.name) {\n    const fact = { subj: { name: sentence.to.name }, obj: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[sentence.to.name] = fact;\n    return fact;\n  }\n  // In-place: mutate the remembered fact and do not replace the binding object.\n  if (vecFact?.obj?.ve) {\n    vecFact.obj.ve.values = out;\n    return vecFact;\n  }\n  const targetName = sentence.obj?.name ?? vecFact?.subj?.name;\n  if (targetName) {\n    const fact = { subj: { name: targetName }, obj: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n    globalThis[targetName] = fact;\n    return fact;\n  }\n  return { obj: { ve: { values: out } }, be: \"vector\", mood: \"ya\" };\n}`;
      prelude.push(mapHelper);
    }
    if (jsHelpers.usesVectorFormat) {
      prelude.push(vectorFormatHelper());
    }
    if (jsHelpers.usesJsonMap) {
      prelude.push(`function jsonFromMap(name, seen = new Set()) {\n  const map = globalThis[name];\n  if (!map || map.be !== \"json map\") throw new Error(\"json map referential defective\");\n  const mapName = map.subj?.name ?? name;\n  if (seen.has(mapName)) throw new Error(\"json map export self referential\");\n  seen.add(mapName);\n  const out = {};\n  const entries = map.obj?.map ?? {};\n  for (const key of Object.keys(entries)) {\n    const value = entries[key];\n    let jsonValue;\n    if (value?.hollow) jsonValue = null;\n    else if (value?.text !== undefined) jsonValue = value.text;\n    else if (value?.num !== undefined) jsonValue = value.num;\n    else if (value?.boolean !== undefined) jsonValue = value.boolean;\n    else if (value?.ve) {\n      const type = value.ve.type || \"num\";\n      if (type === \"hollow\") jsonValue = [];\n      else if (type === \"name\") jsonValue = (value.ve.values || []).map((child) => jsonFromMap(child, seen));\n      else if (type === \"bool\" || type === \"boolean\") jsonValue = (value.ve.values || []).map((v) => v === \"truth\" || v === true || v === 1);\n      else if (type === \"num\" || type === \"number\" || type === \"text\") jsonValue = value.ve.values || [];\n      else throw new Error(\"json map contents defective: unsupported vector type \" + type);\n    } else if (value?.name) {\n      jsonValue = jsonFromMap(value.name, seen);\n    } else if (value && Object.keys(value).length > 0) {\n      throw new Error(\"json map contents defective: unsupported contents\");\n    }\n    if (jsonValue !== undefined) out[key] = jsonValue;\n  }\n  seen.delete(mapName);\n  return out;\n}\nfunction formatJsonMap(name) {\n  return JSON.stringify(jsonFromMap(name), null, 2);\n}`);
    }
    if (jsHelpers.usesFs) {
      prelude.splice(1, 0, `import fs from "node:fs";`);
    }
    if (loopShim.used) {
      const loopHelper = `function runLoop(sentence, fn) {\n  for (;;) {\n    const currIdx = sentence?.fromindex?.num ?? sentence?.fromindex ?? 0;\n    const hasUntil = sentence?.toindex !== undefined;\n    const currUntil = sentence?.toindex?.num ?? sentence?.toindex;\n    sentence.fromindex = currIdx;\n    if (hasUntil) sentence.toindex = currUntil;\n    if (hasUntil ? currIdx === currUntil : currIdx === 0) break;\n    const prevIdx = sentence?.fromindex;\n    const prevUntil = sentence?.toindex;\n    const nextSentence = fn(sentence);\n    sentence = { ...sentence, ...(nextSentence || {}) };\n    if (sentence.fromindex === undefined) sentence.fromindex = prevIdx;\n    if (sentence.toindex === undefined) sentence.toindex = prevUntil;\n    let nextIdx;\n    if (hasUntil) {\n      nextIdx = currIdx + (currUntil > currIdx ? 1 : -1);\n    } else {\n      nextIdx = currIdx - 1;\n    }\n    sentence.fromindex = nextIdx;\n  }\n  return sentence;\n}`;
      prelude.push(loopHelper);
    }
    lines = prelude.concat(lines.slice(1));
  }

  if (lang === "c") {
    const headers = [];
    if (cHelpers.usesPrintf) headers.push("#include <stdio.h>");
    if (cHelpers.usesString) headers.push("#include <string.h>");
    if (cHelpers.usesStdlib) headers.push("#include <stdlib.h>");
    if (cHelpers.usesCtype) headers.push("#include <ctype.h>");
    if (lines.some(l => typeof l === "string" && l.includes("fmod("))) headers.push("#include <math.h>");
    const needsLoopGlobals =
      [...lines, ...mainLines].some(l => typeof l === "string" && /\b(fromindex|toindex|atindex|by)\b/.test(l));
    if (needsLoopGlobals) {
      headers.push("double fromindex = 0;");
      headers.push("double toindex = 0;");
      headers.push("double atindex = 0;");
      headers.push("double by = 0;");
    }
    if (headers.length) lines.unshift(...headers);
    const cPrelude = [];
    if (cHelpers.usesTextHelper) cPrelude.push(TEXT_HELPER);
    if (cHelpers.usesVectorType) cPrelude.push(VECTOR_TYPE_DECL);
    if (cHelpers.usesVectorPrinter) cPrelude.push(VECTOR_PRINT_HELPER);
    if (cPrelude.length) lines.splice(headers.length, 0, ...cPrelude);
    const body = mainLines.map(l => `  ${l}`).join("\n");
    lines.push("int main(void) {");
    lines.push(body || "  return 0;");
    lines.push("  return 0;");
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

function inlineSentenceLiteral(value, declared = new Set(), { inlineNames = true } = {}) {
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
        if (inlineNames) {
          return sanitizeName(nameVal);
        }
        return `{ name: ${nameVal} }`;
      }
    }
    const entries = Object.entries(value).map(([key, val]) => {
      if (key === "name" && typeof val === "string" && declared.has(val) && inlineNames) {
        return `${key}: ${val}`;
      }
      return `${key}: ${inlineSentenceLiteral(val, declared, { inlineNames })}`;
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
    throwErrorSentence({
      name: "compile error",
      message: "compile: source text is required (from text or from filename)",
      from: { name: "compile" }
    });
  }

  // Allow escaped newlines in inline text blocks
  sourceText = sourceText.replaceAll("\\n", "\n");

  const sourceState = (sentence?.fromstate?.name || sentence?.fromstate || "").toLowerCase();
  const targetState = (sentence?.tostate?.name || sentence?.become?.name || "javascript").toLowerCase();
  if (sourceState === "json" && targetState === "pyash") {
    let parsed;
    try {
      parsed = JSON.parse(sourceText);
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: "compile: invalid json",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const rootName = sentence?.subj?.name ?? "data";
    let text;
    try {
      text = jsonToPyashText(parsed, rootName).text;
    } catch (err) {
      throwErrorSentence({
        name: "compile error",
        message: err?.message ?? "compile: json export failed",
        from: { name: "compile" },
        raw: { error: err?.message }
      });
    }
    const wrappedText = `quoted.pyash.\n${text}.pyash.quoted`;
    const targetFilename = sentence?.to?.filename;
    if (targetFilename) {
      await fs.writeFile(targetFilename, text, "utf8");
    }
    const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.subj?.name;
    if (targetName) {
      doRemember({
        subj: { name: targetName },
        be: "pyash",
        obj: { text: wrappedText },
        mood: "ya",
      });
    }
    return { obj: { text: wrappedText }, be: "pyash" };
  }

  const program = buildProgram(sourceText);

  const targetLang = targetState || "javascript";
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
export { transpileSentence, transpileProgram };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename"],
    handler: compile_from_filename_to_filename
  },
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
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  }
];
