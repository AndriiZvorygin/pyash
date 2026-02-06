import { remember } from "../../../remember/index.mjs";
import { sanitizeName } from "./util.mjs";

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
      if (rest.length === 1 && (rest[0] === "num" || rest[0] === "text" || rest[0] === "boolean" || rest[0] === "name")) return rootName;
      if (rest.length === 2 && rest[0] === "ob" && (rest[1] === "num" || rest[1] === "text" || rest[1] === "boolean")) return rootName;
      return [rootName, ...rest.map(part => `.${part}`)].join("");
    }
    const isThisPrefix = chainArr[0] === "this";
    const isThisSuffix = chainArr[chainArr.length - 1] === "this";
    const parts = isThisPrefix ? chainArr.slice(1) : (isThisSuffix ? chainArr.slice(0, -1) : null);
    if (parts && parts.length) {
      const head = parts[0];
      if (parts.length === 2 && parts[0] === "ob") {
        if (parts[1] === "text") return "pya_ob_text";
        if (parts[1] === "num") return "pya_ob_num";
        if (parts[1] === "boolean") return "pya_ob_bool";
      }
      if (head === "by") {
        if (parts.length === 1) return "by";
        if (parts.length === 2 && parts[1] === "num") return "by";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "by";
      }
      if (head === "to") {
        if (parts.length === 1) return "pya_to_num";
        if (parts.length === 2 && parts[1] === "num") return "pya_to_num";
        if (parts.length === 2 && parts[1] === "text") return "pya_to_text";
        if (parts.length === 2 && parts[1] === "boolean") return "pya_to_bool";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "pya_to_num";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "text") return "pya_to_text";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "boolean") return "pya_to_bool";
      }
      if (head === "from") {
        if (parts.length === 1) return "pya_from_num";
        if (parts.length === 2 && parts[1] === "num") return "pya_from_num";
        if (parts.length === 3 && parts[1] === "ob" && parts[2] === "num") return "pya_from_num";
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
    const localType = localsTypes?.get(sanitizeName(root));
    if (localType === "number") {
      if (rest.length === 1 && rest[0] === "num") return sanitizeName(root);
      if (rest.length === 2 && rest[0] === "ob" && rest[1] === "num") {
        const base = sanitizeName(root);
        return `${base}.ob?.num ?? ${base}`;
      }
    }
    if (rest.length === 1) {
      const base = sanitizeName(root);
      if (rest[0] === "text") return `${base}.ob?.text`;
      if (rest[0] === "name") return `${base}.ob?.name`;
      if (rest[0] === "boolean") return `${base}.ob?.boolean ?? ${base}`;
      if (rest[0] === "num") return `${base}.ob?.num ?? ${base}`;
    }
    if (rest.length === 2 && rest[0] === "ob") {
      const base = sanitizeName(root);
      if (rest[1] === "text") return `${base}.ob?.text`;
      if (rest[1] === "name") return `${base}.ob?.name`;
      if (rest[1] === "boolean") return `${base}.ob?.boolean ?? ${base}`;
      if (rest[1] === "num") return `${base}.ob?.num ?? ${base}`;
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
    return `${vecRef}.ob?.ve?.values?.[${idxExpr}]`;
  }

  if (field === "text" && typeof slot.wo === "string") {
    return JSON.stringify(slot.wo);
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
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      if (field === "num") return `${name}.ob?.num ?? ${name}`;
      return `${name}.ob?.${field} ?? ${name}`;
    }
    if (declared?.has(name)) {
      if (field === "text") return `${name}.ob?.text`;
      if (field === "name") return `${name}.ob?.name`;
      return `${name}.ob?.${field}`;
    }
    return name;
  }

  return defaultExpr ?? null;
}

function lvalueForName(name, { declared, locals, field = "num" } = {}) {
  const clean = sanitizeName(name);
  if (locals?.has(clean)) return clean;
  if (declared?.has(clean)) return `${clean}.ob.${field}`;
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
      return `${name}?.ob?.ve?.values ?? ${name}?.ve?.values ?? []`;
    }
    return "[]";
  }
  return "[]";
}

function vectorExprFromGenitive(genitive, sentenceArg, { locals, declared } = {}) {
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const [root, tail] = chainArr;
  if (chainArr.length === 2 && tail === "ve") {
    if (root === "this") {
      return sentenceArg ? `${sentenceArg}.ob?.ve ?? ${sentenceArg}.ve` : null;
    }
    const name = sanitizeName(root);
    if (locals?.has(name) || declared?.has(name)) {
      return `${name}.ob?.ve ?? ${name}.ve`;
    }
    return `remember(${JSON.stringify(root)})?.ob?.ve`;
  }
  const path = pathFromGenitive(genitive, sentenceArg, { locals, declared, allowCGlobals: true });
  return path;
}

function cExpr(expr) {
  return String(expr ?? "0")
    .replace(/\?\./g, ".")
    .replace(/\.ob\.(num|text|name|boolean)\b/g, "")
    .replace(/\s*\?\?\s*[^)]+/g, "");
}

export {
  pathFromGenitive,
  valueForRole,
  targetPath,
  exprForSlot,
  lvalueForName,
  vectorValuesExpr,
  vectorExprFromGenitive,
  cExpr
};
