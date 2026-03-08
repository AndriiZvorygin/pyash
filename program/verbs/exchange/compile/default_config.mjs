import fs from "node:fs/promises";
import path from "node:path";
import { buildProgram } from "../../../program.mjs";

async function loadConfigText(configPath) {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function loadDefaultConfigProgram(cwd) {
  const configPaths = [
    path.resolve(cwd, "configure", "default.pya"),
    path.resolve(cwd, "configure", "secret.pya"),
    path.resolve(cwd, "configure", "container.pya")
  ];
  const chunks = [];
  for (const configPath of configPaths) {
    if (configPath.endsWith(`${path.sep}container.pya`) && !(await isContainerEnv())) continue;
    const raw = await loadConfigText(configPath);
    if (raw) chunks.push(raw);
  }
  if (!chunks.length) return null;
  return buildProgram(chunks.join("\n"));
}

async function isContainerEnv() {
  if (process.env?.PYA_CONTAINER || process.env?.CONTAINER || process.env?.container) return true;
  const markers = ["/.dockerenv", "/run/.containerenv"];
  for (const marker of markers) {
    try {
      await fs.access(marker);
      return true;
    } catch {
      // ignore missing markers
    }
  }
  return false;
}

function findDefaultSayMapping(sentences, { baseDir = process.cwd() } = {}) {
  let mapping = null;
  for (const sentence of sentences || []) {
    if (sentence?.be !== "default") continue;
    if (sentence?.su?.name !== "say") continue;
    const targetName = sentence?.ob?.name;
    if (!targetName) continue;
    mapping = {
      targetName,
      fromFilename: sentence?.from?.filename,
      fromName: sentence?.from?.name
    };
  }
  if (mapping && !mapping.fromFilename && !mapping.fromName) {
    for (const sentence of sentences || []) {
      if (sentence?.mood !== "do" || sentence?.be !== "import") continue;
      if (sentence?.ob?.name !== "say") continue;
      if (sentence?.to?.name !== mapping.targetName) continue;
      const fromFilename = sentence?.from?.filename;
      if (fromFilename) {
        mapping.fromFilename = path.isAbsolute(fromFilename)
          ? fromFilename
          : path.resolve(baseDir, fromFilename);
      } else {
        mapping.fromName = sentence?.from?.name;
      }
      break;
    }
  }
  return mapping;
}

function findRetryConfig(sentences) {
  const config = {};
  for (const sentence of sentences || []) {
    if (sentence?.mood !== "ya") continue;
    const name = sentence?.su?.name;
    if (!name || !name.startsWith("reiterate ")) continue;
    const value = sentence?.ob?.num ?? sentence?.ob?.text;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    if (name === "reiterate delay") config.initialDelayMs = parsed;
    if (name === "reiterate backoff") config.backoff = parsed;
    if (name === "reiterate attempts") config.maxAttempts = parsed;
    if (name === "reiterate cap") config.maxDelayMs = parsed;
  }
  return config;
}

function applyDefaultSayMapping(sentences, mapping) {
  if (!mapping?.targetName) return sentences;
  const hasSay = (sentences || []).some(s => s?.be === "say");
  if (!hasSay) return sentences;
  const hasImport = sentences.some(s =>
    s?.be === "import"
    && s?.ob?.name === "say"
    && s?.to?.name === mapping.targetName
    && ((mapping.fromFilename && s?.from?.filename === mapping.fromFilename)
      || (mapping.fromName && s?.from?.name === mapping.fromName))
  );
  const importSentence = !hasImport ? {
    mood: "do",
    be: "import",
    from: mapping.fromFilename ? { filename: mapping.fromFilename } : { name: mapping.fromName ?? mapping.targetName },
    ob: { name: "say" },
    to: { name: mapping.targetName }
  } : null;
  const rewritten = sentences.map((sentence) => {
    if (sentence?.be !== "say") return sentence;
    const next = { ...sentence, be: mapping.targetName };
    if (!next.to) next.to = { name: "result", nameTypeWords: ["text"] };
    return next;
  });
  return importSentence ? [importSentence, ...rewritten] : rewritten;
}

export { applyDefaultSayMapping, findDefaultSayMapping, findRetryConfig, loadDefaultConfigProgram };
