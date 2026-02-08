import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  parseSystemdIniToMap,
  emitSystemdIniFromMap,
  emitSystemdIniFromSections,
  parseSystemdIniToSections,
  serviceSentenceToSystemdMap
} from "../program/agent/service_definition.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

function usage() {
  return [
    "Usage:",
    "  node command/systemd_bridge.mjs --action sentence-to-ini --input <service.pya> --output <service.ini>",
    "  node command/systemd_bridge.mjs --action ini-to-pyash-map --input <service.ini> --output <map.pya> [--service-name <name>]",
    "  node command/systemd_bridge.mjs --action ini-to-pyash-sections --input <service.ini> --output <maps.pya> [--service-name <name>]",
    "  node command/systemd_bridge.mjs --action pyash-sections-to-ini --input <maps.pya> --output <service.ini>"
  ].join("\n");
}

function stableServiceKeys() {
  return [
    "unit_after",
    "unit_wants",
    "service_type",
    "service_exec_start",
    "service_restart",
    "install_wanted_by"
  ];
}

function mapToPyashJsonMapText(map, { serviceName }) {
  const lines = [];
  lines.push(sentenceToPyash({
    mood: "def",
    su: { name: serviceName },
    be: "json map"
  }));
  for (const key of stableServiceKeys()) {
    const value = map[key];
    if (typeof value !== "string" || !value.trim()) continue;
    lines.push(sentenceToPyash({
      mood: "ya",
      su: { name: key },
      ob: { text: value }
    }));
  }
  lines.push("prah");
  return lines.join("\n") + "\n";
}

function sectionMapNames(serviceName) {
  return {
    unit: `${serviceName} unit`,
    service: `${serviceName} service`,
    install: `${serviceName} install`
  };
}

function emitPyashSectionMapsText(sections, { serviceName }) {
  const names = sectionMapNames(serviceName);
  const sectionSpecs = [
    { section: "Unit", mapName: names.unit },
    { section: "Service", mapName: names.service },
    { section: "Install", mapName: names.install }
  ];
  const lines = [];
  for (const spec of sectionSpecs) {
    lines.push(sentenceToPyash({ mood: "def", su: { name: spec.mapName }, be: "json map" }));
    const rows = sections?.[spec.section] ?? {};
    for (const [key, values] of Object.entries(rows)) {
      const arr = Array.isArray(values) ? values : [values];
      const clean = arr.map(v => String(v ?? ""));
      if (clean.length <= 1) {
        lines.push(sentenceToPyash({ mood: "ya", su: { name: key }, ob: { text: clean[0] ?? "" } }));
      } else {
        lines.push(sentenceToPyash({ mood: "ya", su: { name: key }, ob: { ve: { type: "text", values: clean } }, be: "vector" }));
      }
    }
    lines.push("prah");
  }
  return lines.join("\n") + "\n";
}

function parsePyashSectionMapsText(text) {
  const lines = splitSentences(String(text ?? ""));
  const out = {};
  let currentName = "";
  for (const line of lines) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence) continue;
    if (sentence.mood === "def" && sentence.be === "json map" && sentence?.su?.name) {
      currentName = sentence.su.name;
      if (!out[currentName]) out[currentName] = {};
      continue;
    }
    if (sentence.mood !== "ya" || !currentName || !sentence?.su?.name) continue;
    if (Array.isArray(sentence?.ob?.ve?.values)) {
      out[currentName][sentence.su.name] = sentence.ob.ve.values.map(v => String(v ?? ""));
      continue;
    }
    if (typeof sentence?.ob?.text === "string") {
      out[currentName][sentence.su.name] = [sentence.ob.text];
    }
  }
  return out;
}

function pyashMapsToSystemdSections(pyashMaps) {
  const sections = { Unit: {}, Service: {}, Install: {} };
  for (const [mapName, kv] of Object.entries(pyashMaps ?? {})) {
    const lower = String(mapName).toLowerCase();
    if (lower.endsWith(" unit")) {
      sections.Unit = kv;
      continue;
    }
    if (lower.endsWith(" service")) {
      sections.Service = kv;
      continue;
    }
    if (lower.endsWith(" install")) {
      sections.Install = kv;
    }
  }
  return sections;
}

async function sentenceToIni({ inputPath, outputPath }) {
  const raw = await fs.readFile(inputPath, "utf8");
  const lines = splitSentences(raw);
  const first = lines.find(line => String(line ?? "").trim());
  if (!first) throw new Error("service sentence missing");
  const sentence = parse(first);
  const map = serviceSentenceToSystemdMap(sentence);
  if (!map) throw new Error("input is not `be service ya` sentence");
  const ini = emitSystemdIniFromMap(map);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, ini, "utf8");
}

async function iniToPyashMap({ inputPath, outputPath, serviceName }) {
  const raw = await fs.readFile(inputPath, "utf8");
  const map = parseSystemdIniToMap(raw);
  const text = mapToPyashJsonMapText(map, { serviceName });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, "utf8");
}

async function iniToPyashSections({ inputPath, outputPath, serviceName }) {
  const raw = await fs.readFile(inputPath, "utf8");
  const sections = parseSystemdIniToSections(raw);
  const text = emitPyashSectionMapsText(sections, { serviceName });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, "utf8");
}

async function pyashSectionsToIni({ inputPath, outputPath }) {
  const raw = await fs.readFile(inputPath, "utf8");
  const pyashMaps = parsePyashSectionMapsText(raw);
  const sections = pyashMapsToSystemdSections(pyashMaps);
  const ini = emitSystemdIniFromSections(sections);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, ini, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const action = String(readFlagValue(args, "--action") ?? "").trim().toLowerCase();
  const inputPath = readFlagValue(args, "--input");
  const outputPath = readFlagValue(args, "--output");
  const serviceName = readFlagValue(args, "--service-name") ?? "service";

  if (!action || !inputPath || !outputPath) {
    console.error(usage());
    process.exit(1);
  }

  if (action === "sentence-to-ini") {
    await sentenceToIni({ inputPath, outputPath });
    return;
  }
  if (action === "ini-to-pyash-map") {
    await iniToPyashMap({ inputPath, outputPath, serviceName });
    return;
  }
  if (action === "ini-to-pyash-sections") {
    await iniToPyashSections({ inputPath, outputPath, serviceName });
    return;
  }
  if (action === "pyash-sections-to-ini") {
    await pyashSectionsToIni({ inputPath, outputPath });
    return;
  }
  console.error(usage());
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
