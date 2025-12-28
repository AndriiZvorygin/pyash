import YAML from "yaml";
import { throwErrorSentence } from "../../error.mjs";

const JSON_NUMBER_RE = /^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$/;

function yamlError({ name, message, source, line, column, raw }) {
  throwErrorSentence({
    name,
    message: message || name,
    from: { name: source },
    raw: { line, column, ...raw }
  });
}

function scalarSource(node) {
  if (!node) return "";
  if (typeof node.source === "string") return node.source;
  if (node.range && typeof node.range[0] === "number" && typeof node.range[1] === "number" && typeof node.doc?.src === "string") {
    return node.doc.src.slice(node.range[0], node.range[1]);
  }
  return String(node.value ?? "");
}

function classifyScalar(node) {
  const isPlain = node?.type === "PLAIN";
  if (typeof node?.value === "number") return { type: "num", value: node.value };
  if (typeof node?.value === "boolean") return { type: "bool", value: node.value };
  if (node?.value === null) return { type: "hollow", value: null };
  const raw = String(scalarSource(node) ?? "").trim();
  if (!isPlain) return { type: "text", value: String(node?.value ?? "") };
  if (raw === "" || raw === "~" || /^null$/i.test(raw)) return { type: "hollow", value: null };
  if (/^(true|false)$/i.test(raw)) return { type: "bool", value: /^true$/i.test(raw) };
  if (JSON_NUMBER_RE.test(raw)) return { type: "num", value: Number(raw) };
  return { type: "text", value: raw };
}

function keyTextFromScalar(node, source) {
  if (!YAML.isScalar(node)) {
    yamlError({ name: "yaml key defective", source, message: "yaml key defective" });
  }
  const isPlain = node?.type === "PLAIN";
  const raw = String(scalarSource(node) ?? "").trim();
  let key;
  if (!isPlain) {
    key = String(node?.value ?? "");
  } else if (raw === "" || raw === "~" || /^null$/i.test(raw)) {
    key = "null";
  } else if (/^(true|false)$/i.test(raw)) {
    key = /^true$/i.test(raw) ? "true" : "false";
  } else if (JSON_NUMBER_RE.test(raw)) {
    key = raw;
  } else {
    key = raw;
  }
  if (!String(key ?? "").trim()) {
    yamlError({ name: "yaml key defective", source, message: "yaml key defective" });
  }
  return key;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = cloneValue(val);
    }
    return out;
  }
  return value;
}

function collectAnchors(node, anchors) {
  if (!node || typeof node !== "object") return;
  if (node.anchor) anchors.set(node.anchor, node);
  if (YAML.isMap(node)) {
    for (const pair of node.items) {
      collectAnchors(pair.key, anchors);
      collectAnchors(pair.value, anchors);
    }
    return;
  }
  if (YAML.isSeq(node)) {
    for (const item of node.items) collectAnchors(item, anchors);
  }
}

function resolveAlias(node, ctx) {
  const aliasName = String(node?.source ?? "").trim();
  if (!aliasName) {
    yamlError({ name: "yaml referential defective", source: ctx.source, message: "yaml referential defective" });
  }
  const target = ctx.anchors.get(aliasName);
  if (!target) {
    yamlError({ name: "yaml referential defective", source: ctx.source, message: "yaml referential defective", raw: { alias: aliasName } });
  }
  if (ctx.resolving.has(aliasName)) {
    yamlError({ name: "yaml referential defective", source: ctx.source, message: "yaml referential defective", raw: { alias: aliasName } });
  }
  ctx.resolving.add(aliasName);
  const value = yamlNodeToJson(target, ctx);
  ctx.resolving.delete(aliasName);
  return cloneValue(value);
}

function mergeObjectInto(target, source, ctx) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    yamlError({ name: "yaml defective", source: ctx.source, message: "yaml defective" });
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) target[key] = value;
  }
}

function yamlMapToJson(node, ctx) {
  const out = {};
  for (const pair of node.items) {
    const keyText = keyTextFromScalar(pair.key, ctx.source);
    if (keyText === "<<") {
      const mergeValue = yamlNodeToJson(pair.value, ctx);
      if (Array.isArray(mergeValue)) {
        for (const entry of mergeValue) {
          mergeObjectInto(out, entry, ctx);
        }
      } else {
        mergeObjectInto(out, mergeValue, ctx);
      }
      continue;
    }
    const value = yamlNodeToJson(pair.value, ctx);
    out[keyText] = value;
  }
  return out;
}

function yamlSeqToJson(node, ctx) {
  const out = [];
  for (const item of node.items) {
    out.push(yamlNodeToJson(item, ctx));
  }
  return out;
}

function yamlNodeToJson(node, ctx) {
  if (!node) return null;
  if (node?.tag) {
    yamlError({ name: "yaml defective", source: ctx.source, message: "yaml defective" });
  }
  if (node?.constructor?.name === "Alias") {
    return resolveAlias(node, ctx);
  }
  if (YAML.isMap(node)) return yamlMapToJson(node, ctx);
  if (YAML.isSeq(node)) return yamlSeqToJson(node, ctx);
  if (YAML.isScalar(node)) {
    const classified = classifyScalar(node);
    if (classified.type === "hollow") return null;
    if (classified.type === "bool") return Boolean(classified.value);
    if (classified.type === "num") return Number(classified.value);
    return String(classified.value ?? "");
  }
  yamlError({ name: "yaml defective", source: ctx.source, message: "yaml defective" });
  return null;
}

export function parseYamlToJsonValue(text, { source = "yaml" } = {}) {
  let docs;
  try {
    docs = YAML.parseAllDocuments(String(text ?? ""), { keepNodeTypes: true });
  } catch (err) {
    yamlError({
      name: "yaml defective",
      source,
      message: "yaml defective",
      raw: { error: err?.message }
    });
  }
  if (!docs || docs.length === 0) {
    yamlError({ name: "yaml defective", source, message: "yaml defective" });
  }
  if (docs.length !== 1) {
    yamlError({ name: "yaml defective", source, message: "yaml defective" });
  }
  const doc = docs[0];
  if (doc?.errors?.length) {
    const err = doc.errors[0];
    yamlError({
      name: "yaml defective",
      source,
      message: "yaml defective",
      line: err?.linePos?.[0]?.line,
      column: err?.linePos?.[0]?.col,
      raw: { error: err?.message }
    });
  }
  const root = doc.contents;
  if (!YAML.isMap(root)) {
    yamlError({ name: "yaml root defective", source, message: "yaml root defective" });
  }
  const anchors = new Map();
  collectAnchors(root, anchors);
  const ctx = { anchors, resolving: new Set(), source };
  const value = yamlNodeToJson(root, ctx);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    yamlError({ name: "yaml root defective", source, message: "yaml root defective" });
  }
  return value;
}

export function yamlStringify(value) {
  return YAML.stringify(value ?? {});
}

export function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => Buffer.from(a, "utf8").compare(Buffer.from(b, "utf8")));
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}
