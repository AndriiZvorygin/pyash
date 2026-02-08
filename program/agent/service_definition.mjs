import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugifyServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "service";
}

export function serviceDefinitionPath({ worldRoot, serviceName } = {}) {
  if (!worldRoot || !serviceName) return null;
  const slug = slugifyServiceName(serviceName);
  return path.join(worldRoot, "conduct", "service", `${slug}.pya`);
}

function readValueText(ob) {
  if (!ob || typeof ob !== "object") return "";
  if (typeof ob.text === "string") return ob.text.trim();
  if (typeof ob.filename === "string") return ob.filename.trim();
  if (typeof ob.name === "string") return ob.name.trim();
  return "";
}

function deriveRunText(definition) {
  if (definition.runText) return definition.runText;
  if (definition.runner === "ceremony" && definition.ceremony) {
    return `be ${definition.ceremony} do`;
  }
  return "";
}

function readCaseText(caseValue) {
  if (!caseValue || typeof caseValue !== "object") return "";
  if (typeof caseValue.text === "string") return caseValue.text.trim();
  if (typeof caseValue.name === "string") return caseValue.name.trim();
  if (typeof caseValue.filename === "string") return caseValue.filename.trim();
  return "";
}

export function serviceSentenceToSystemdMap(sentence = {}) {
  if (sentence?.be !== "service") return null;
  return {
    unit_after: readCaseText(sentence.since),
    unit_wants: readCaseText(sentence.fromperson),
    service_type: readCaseText(sentence.as),
    service_exec_start: readCaseText(sentence.ob),
    service_restart: readCaseText(sentence.onto),
    install_wanted_by: readCaseText(sentence.for)
  };
}

export function systemdMapToServiceSentence(map = {}, { serviceName = "service" } = {}) {
  return {
    mood: "ya",
    su: { name: String(serviceName ?? "service") },
    since: map.unit_after ? { name: map.unit_after } : undefined,
    fromperson: map.unit_wants ? { name: map.unit_wants } : undefined,
    as: map.service_type ? { text: map.service_type } : undefined,
    ob: map.service_exec_start ? { filename: map.service_exec_start } : undefined,
    for: map.install_wanted_by ? { name: map.install_wanted_by } : undefined,
    onto: map.service_restart ? { text: map.service_restart } : undefined,
    be: "service"
  };
}

const SECTION_KEY_MAP = {
  unit: {
    after: "unit_after",
    wants: "unit_wants"
  },
  service: {
    type: "service_type",
    execstart: "service_exec_start",
    restart: "service_restart"
  },
  install: {
    wantedby: "install_wanted_by"
  }
};

export function parseSystemdIniToMap(text = "") {
  const out = {};
  let section = "";
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[(.+?)\]$/);
    if (sectionMatch) {
      section = String(sectionMatch[1]).trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    const mapKey = SECTION_KEY_MAP[section]?.[key];
    if (!mapKey) continue;
    out[mapKey] = value;
  }
  return out;
}

export function emitSystemdIniFromMap(map = {}) {
  const unit = [];
  const service = [];
  const install = [];
  if (map.unit_after) unit.push(`After=${map.unit_after}`);
  if (map.unit_wants) unit.push(`Wants=${map.unit_wants}`);
  if (map.service_type) service.push(`Type=${map.service_type}`);
  if (map.service_exec_start) service.push(`ExecStart=${map.service_exec_start}`);
  if (map.service_restart) service.push(`Restart=${map.service_restart}`);
  if (map.install_wanted_by) install.push(`WantedBy=${map.install_wanted_by}`);
  const lines = [];
  if (unit.length) lines.push("[Unit]", ...unit, "");
  if (service.length) lines.push("[Service]", ...service, "");
  if (install.length) lines.push("[Install]", ...install, "");
  return lines.join("\n").trimEnd() + "\n";
}

export function parseSystemdIniToSections(text = "") {
  const out = {};
  let section = "";
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[(.+?)\]$/);
    if (sectionMatch) {
      section = String(sectionMatch[1]).trim();
      if (!out[section]) out[section] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0 || !section) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!out[section]) out[section] = {};
    if (!out[section][key]) out[section][key] = [];
    out[section][key].push(value);
  }
  return out;
}

function emitSection(lines, name, values) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return;
  lines.push(`[${name}]`);
  for (const [key, arr] of entries) {
    const valuesArr = Array.isArray(arr) ? arr : [arr];
    for (const value of valuesArr) {
      lines.push(`${key}=${String(value ?? "")}`);
    }
  }
  lines.push("");
}

export function emitSystemdIniFromSections(sections = {}) {
  const lines = [];
  const preferred = ["Unit", "Service", "Install"];
  for (const name of preferred) {
    emitSection(lines, name, sections[name]);
  }
  for (const [name, values] of Object.entries(sections)) {
    if (preferred.includes(name)) continue;
    emitSection(lines, name, values);
  }
  return lines.join("\n").trimEnd() + "\n";
}

export async function loadServiceDefinition({ worldRoot, serviceName } = {}) {
  const filePath = serviceDefinitionPath({ worldRoot, serviceName });
  if (!filePath) return null;
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }

  const definition = {
    serviceName: String(serviceName ?? "").trim(),
    filePath,
    runner: "",
    ceremony: "",
    runText: "",
    modules: [],
    systemd: null,
    execStart: ""
  };

  const lines = splitSentences(text);
  for (const line of lines) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence || sentence.mood !== "ya") continue;
    if (sentence.be === "service") {
      const serviceMap = serviceSentenceToSystemdMap(sentence);
      if (serviceMap) {
        definition.systemd = serviceMap;
        definition.execStart = serviceMap.service_exec_start || "";
      }
      continue;
    }
    const key = normalizeKey(sentence?.su?.name);
    if (!key) continue;
    if (key === "runner") {
      definition.runner = normalizeKey(readValueText(sentence.ob));
      continue;
    }
    if (key === "ceremony") {
      definition.ceremony = readValueText(sentence.ob);
      continue;
    }
    if (key === "run") {
      definition.runText = readValueText(sentence.ob);
      continue;
    }
    if (key === "module") {
      const moduleRef = readValueText(sentence.ob);
      if (moduleRef) definition.modules.push(moduleRef);
    }
  }

  definition.runText = deriveRunText(definition);
  return definition;
}

export function resolveServiceModulePath({ worldRoot, serviceFilePath, moduleRef } = {}) {
  const ref = String(moduleRef ?? "").trim();
  if (!ref) return "";
  if (path.isAbsolute(ref)) return ref;
  if (ref.startsWith("./") || ref.startsWith("../")) {
    return path.resolve(path.dirname(serviceFilePath ?? worldRoot ?? process.cwd()), ref);
  }
  return path.resolve(worldRoot ?? process.cwd(), ref);
}
