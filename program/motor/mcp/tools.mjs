import crypto from "node:crypto";

import { canonicalJsonStringify } from "../../verbs/exchange/write_json.mjs";
import { jsonToMapSentences } from "../../verbs/exchange/json_map.mjs";

function valueToJson(value) {
  if (!value || typeof value !== "object") return value;
  if (value.unspecified) return undefined;
  if (value.hollow) return null;
  if (value.text !== undefined) return value.text;
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.name !== undefined) return value.name;
  if (value.filename !== undefined) return value.filename;
  if (value.ve) {
    const type = value.ve.type || "text";
    const values = Array.isArray(value.ve.values) ? value.ve.values : [];
    if (type === "bool" || type === "boolean") {
      return values.map(v => v === "truth" || v === true || v === 1);
    }
    return values.slice();
  }
  return value;
}

function jsonToOb(value) {
  if (value === null) return { hollow: true };
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { num: value };
  if (typeof value === "boolean") return { boolean: value };
  if (Array.isArray(value)) {
    if (value.length === 0) return { ve: { type: "hollow", values: [] } };
    const types = new Set(value.map(v => typeof v));
    if (types.size === 1 && types.has("number")) {
      return { ve: { type: "num", values: value.slice() } };
    }
    if (types.size === 1 && types.has("boolean")) {
      return { ve: { type: "bool", values: value.map(v => (v ? "truth" : "lie")) } };
    }
    if (types.size === 1 && types.has("string")) {
      return { ve: { type: "text", values: value.slice() } };
    }
    return { text: JSON.stringify(value) };
  }
  if (value && typeof value === "object") {
    return { text: JSON.stringify(value) };
  }
  return { text: String(value ?? "") };
}

function buildToolIdentity({ server, tool }) {
  const record = {
    server,
    name: tool.name ?? "",
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null
  };
  const bytes = canonicalJsonStringify(record);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeTool(raw) {
  const name = String(raw?.name ?? raw?.tool?.name ?? "").trim();
  if (!name) return null;
  const capabilities = raw?.capabilities ?? raw?.tool?.capabilities ?? raw?.metadata?.capabilities ?? null;
  return {
    name,
    description: raw?.description ?? raw?.tool?.description ?? "",
    inputSchema: raw?.inputSchema ?? raw?.input_schema ?? raw?.parameters ?? raw?.tool?.inputSchema ?? raw?.tool?.parameters ?? {},
    outputSchema: raw?.outputSchema ?? raw?.output_schema ?? raw?.tool?.outputSchema ?? null,
    capabilities: capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? capabilities : null
  };
}

function collectExistingNames({ allRememberFn }) {
  const used = new Set();
  const entries = typeof allRememberFn === "function" ? allRememberFn() : [];
  for (const entry of entries) {
    if (entry?.su?.name) used.add(entry.su.name);
  }
  return used;
}

function jsonArrayToVector(values, { rootName, doRememberFn, allRememberFn }) {
  if (values.length === 0) {
    return { be: "vector", ob: { ve: { type: "hollow", values: [] } } };
  }
  const typeSet = new Set(values.map((v) => (v === null ? "hollow" : Array.isArray(v) ? "array" : typeof v)));
  if (typeSet.has("object")) {
    const names = [];
    const existingNames = collectExistingNames({ allRememberFn });
    let index = 1;
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const childName = `${rootName} item ${index}`;
      index += 1;
      const { rootName: resolvedRoot, sentences } = jsonToMapSentences(value, childName, { existingNames });
      existingNames.add(resolvedRoot);
      for (const sentence of sentences) doRememberFn(sentence);
      names.push(resolvedRoot);
    }
    return { be: "vector", ob: { ve: { type: "name", values: names } } };
  }
  if (typeSet.has("array") || typeSet.has("hollow") || typeSet.size > 1) {
    return { be: "text", ob: { text: JSON.stringify(values) } };
  }
  if (typeSet.has("boolean")) {
    return { be: "vector", ob: { ve: { type: "bool", values: values.map(v => (v ? "truth" : "lie")) } } };
  }
  if (typeSet.has("number")) {
    return { be: "vector", ob: { ve: { type: "num", values: values.slice() } } };
  }
  return { be: "vector", ob: { ve: { type: "text", values: values.map(v => String(v ?? "")) } } };
}

function validateSchemaValue(value, schema) {
  if (!schema || typeof schema !== "object") return true;
  const type = schema.type;
  if (!type) return true;
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") {
    if (!(typeof value === "number" && Number.isFinite(value))) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  if (type === "integer") {
    if (!(typeof value === "number" && Number.isInteger(value))) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    return true;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    return true;
  }
  if (type === "object") return value && typeof value === "object" && !Array.isArray(value);
  return true;
}

function validateSchemaArgs(args, schema, { toolName }) {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;
  if (type && type !== "object") {
    throw new Error(`mcp tool defective: ${toolName} expects ${type}`);
  }
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (args[key] === undefined && propSchema && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
      args[key] = propSchema.default;
    }
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      throw new Error(`mcp tool defective: missing required ${key}`);
    }
  }
  const additionalAllowed = schema.additionalProperties !== false;
  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties?.[key];
    if (!propSchema) {
      if (!additionalAllowed) {
        throw new Error(`mcp tool defective: additional properties not allowed (${key})`);
      }
      continue;
    }
    if (!validateSchemaValue(value, propSchema)) {
      throw new Error(`mcp tool defective: ${key} type mismatch`);
    }
  }
}

export {
  valueToJson,
  jsonToOb,
  buildToolIdentity,
  normalizeTool,
  collectExistingNames,
  jsonArrayToVector,
  validateSchemaArgs
};
