import fs from "node:fs/promises";
import path from "node:path";

import { buildProgram } from "../program.mjs";
import { throwErrorSentence } from "../error.mjs";

const moduleCache = new Map();
let entryModuleDir = process.cwd();
let importMapCache = null;
const moduleDirStack = [];

export function setEntryModulePath(filePath) {
  if (!filePath) return;
  entryModuleDir = path.dirname(path.resolve(filePath));
  importMapCache = null;
}

export function clearModuleCache() {
  moduleCache.clear();
  importMapCache = null;
  moduleDirStack.length = 0;
}

export function pushModuleDir(dir) {
  if (dir) moduleDirStack.push(dir);
}

export function popModuleDir() {
  moduleDirStack.pop();
}

export function currentModuleDir() {
  return moduleDirStack.length ? moduleDirStack[moduleDirStack.length - 1] : entryModuleDir;
}

async function loadImportMap({ source }) {
  if (importMapCache) return importMapCache;
  const mapPath = path.join(entryModuleDir, "pyash.json");
  try {
    const raw = await fs.readFile(mapPath, "utf8");
    const data = JSON.parse(raw);
    const imports = data?.imports;
    if (!imports || typeof imports !== "object") {
      importMapCache = { imports: {} };
      return importMapCache;
    }
    importMapCache = { imports };
    return importMapCache;
  } catch (err) {
    if (err?.code === "ENOENT") {
      importMapCache = { imports: {} };
      return importMapCache;
    }
    throwErrorSentence({
      name: "module import incomplete",
      message: "import map parse failed",
      from: { name: source },
      raw: { path: mapPath, error: err?.message }
    });
  }
}

function isPathSpecifier(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec);
}

function deriveAliasFromPath(resolvedPath) {
  const base = path.basename(resolvedPath);
  const withoutExt = base.endsWith(".pya") ? base.slice(0, -4) : base;
  const parts = withoutExt.split(/[/\\._\-\s]+/).filter(Boolean);
  return parts.join(" ");
}

async function resolveModuleSpecifier(spec, { source }) {
  if (isPathSpecifier(spec)) {
    const resolved = path.resolve(currentModuleDir(), spec);
    return { modulePath: resolved, alias: deriveAliasFromPath(resolved), specType: "path" };
  }

  const map = await loadImportMap({ source });
  const mapped = map?.imports?.[spec];
  if (!mapped) {
    throwErrorSentence({
      name: "module lost",
      message: `module import missing: ${spec}`,
      from: { name: source },
      raw: { spec }
    });
  }
  const resolved = path.isAbsolute(mapped)
    ? mapped
    : path.resolve(entryModuleDir, mapped);
  return { modulePath: resolved, alias: spec, specType: "logical" };
}

function buildNameMap({ modulePrefix, localNames, exportNames, importAliases }) {
  const map = new Map();
  const internalPrefix = `${modulePrefix} internal`;
  for (const name of localNames) {
    const mapped = exportNames.has(name) ? `${modulePrefix} ${name}` : `${internalPrefix} ${name}`;
    map.set(name, mapped);
  }
  for (const alias of importAliases) {
    map.set(alias, `${internalPrefix} ${alias}`);
  }
  return map;
}

function qualifyVerb(be, { nameMap, localCeremonies, importAliases }) {
  if (!be || typeof be !== "string") return be;
  if (localCeremonies.has(be) && nameMap.has(be)) return nameMap.get(be);
  const aliases = [...importAliases].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (be === alias || be.startsWith(`${alias} `)) {
      const mapped = nameMap.get(alias);
      if (mapped) return `${mapped}${be.slice(alias.length)}`;
    }
  }
  return be;
}

function qualifyGenitiveChain(chain, { nameMap }) {
  if (!Array.isArray(chain) || chain.length === 0) return chain;
  const [root, ...rest] = chain;
  if (root === "this") return chain;
  if (nameMap.has(root)) return [nameMap.get(root), ...rest];
  return chain;
}

function qualifyValue(value, opts, { skipNames = false } = {}) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(v => qualifyValue(v, opts, { skipNames }));

  const next = { ...value };
  if (!skipNames && next.name && !next.nameTypeWords && opts.nameMap.has(next.name)) {
    next.name = opts.nameMap.get(next.name);
  }
  if (next.genitive?.chain) {
    next.genitive = { ...next.genitive, chain: qualifyGenitiveChain(next.genitive.chain, opts) };
  }
  for (const [key, val] of Object.entries(next)) {
    if (val && typeof val === "object") {
      next[key] = qualifyValue(val, opts, { skipNames });
    }
  }
  return next;
}

function qualifySentence(sentence, opts) {
  const next = { ...sentence };
  const skipNameKeys = new Set(["fromstate", "tostate", "become", "as"]);
  const isImport = sentence.be === "import" && sentence.mood === "do";

  next.be = qualifyVerb(next.be, opts);

  for (const [key, val] of Object.entries(next)) {
    if (!val || typeof val !== "object") continue;
    if (skipNameKeys.has(key)) continue;
    if (isImport && (key === "from" || key === "ob")) {
      next[key] = qualifyValue(val, opts, { skipNames: true });
      continue;
    }
    next[key] = qualifyValue(val, opts);
  }

  return next;
}

function collectModuleInfo(sentences) {
  const localNames = new Set();
  const localCeremonies = new Set();
  const exportNames = new Set();
  const importAliases = new Set();
  let inCeremony = 0;

  for (const sentence of sentences) {
    if (sentence?.mood === "def" && sentence?.be === "ceremony") {
      if (sentence?.su?.name) localCeremonies.add(sentence.su.name);
      inCeremony += 1;
    }
    if (sentence?.mood === "prah" && inCeremony > 0) {
      inCeremony -= 1;
    }
    if (inCeremony > 0) {
      continue;
    }
    const name = sentence?.su?.name;
    if (name) localNames.add(name);
    if (sentence?.mood === "ya" && sentence?.be === "export" && name) {
      exportNames.add(name);
    }
    if (sentence?.mood === "do" && sentence?.be === "import" && sentence?.from?.name) {
      const alias = sentence?.to?.name;
      if (alias) importAliases.add(alias);
    }
  }

  return { localNames, localCeremonies, exportNames, importAliases };
}

async function parseModuleFile(modulePath) {
  const raw = await fs.readFile(modulePath, "utf8");
  const program = buildProgram(raw);
  return program.sentences;
}

function ensureNoTopLevelDo(sentences, { source }) {
  let inCeremony = 0;
  for (const sentence of sentences) {
    if (sentence?.mood === "def" && sentence?.be === "ceremony") {
      inCeremony += 1;
      continue;
    }
    if (sentence?.mood === "prah" && inCeremony > 0) {
      inCeremony -= 1;
      continue;
    }
    if (inCeremony > 0) continue;
    if (sentence?.mood === "do" && sentence?.be !== "import") {
      throwErrorSentence({
        name: "module import incomplete",
        message: "top-level do is forbidden in imported modules",
        from: { name: source },
        raw: sentence
      });
    }
  }
}

export async function loadModule({ specifier, alias, source }) {
  const resolved = await resolveModuleSpecifier(specifier, { source });
  const moduleId = path.resolve(resolved.modulePath);
  const moduleAlias = alias || resolved.alias;

  if (moduleCache.has(moduleId)) {
    const cached = moduleCache.get(moduleId);
    if (cached.alias !== moduleAlias) {
      throwErrorSentence({
        name: "module import incomplete",
        message: `module already loaded as "${cached.alias}"`,
        from: { name: source },
        raw: { specifier, alias: moduleAlias }
      });
    }
    return cached;
  }

  const record = {
    id: moduleId,
    alias: moduleAlias,
    dir: path.dirname(moduleId),
    sentences: [],
    exportNames: new Set(),
    localCeremonies: new Set(),
    localNames: new Set()
  };
  moduleCache.set(moduleId, record);

  const sentences = await parseModuleFile(moduleId);
  ensureNoTopLevelDo(sentences, { source });

  for (const sentence of sentences) {
    if (sentence?.mood === "do" && sentence?.be === "import" && sentence?.from?.name && !sentence?.to?.name) {
      const spec = sentence.from.name;
      if (isPathSpecifier(spec)) {
        const resolvedPath = path.resolve(record.dir, spec);
        sentence.to = { name: deriveAliasFromPath(resolvedPath) };
      } else {
        sentence.to = { name: spec };
      }
    }
  }

  const info = collectModuleInfo(sentences);
  record.exportNames = info.exportNames;
  record.localCeremonies = info.localCeremonies;
  record.localNames = info.localNames;

  const nameMap = buildNameMap({
    modulePrefix: moduleAlias,
    localNames: info.localNames,
    exportNames: info.exportNames,
    importAliases: info.importAliases
  });

  record.sentences = sentences
    .filter(s => !(s?.mood === "ya" && s?.be === "export"))
    .map(s => qualifySentence(s, { nameMap, localCeremonies: info.localCeremonies, importAliases: info.importAliases }));

  record.nameMap = nameMap;

  return record;
}

export function moduleNamespaceFact({ alias, exportFacts }) {
  const map = {};
  for (const [symbol, value] of exportFacts.entries()) {
    map[symbol] = value ?? {};
  }
  return {
    mood: "ya",
    su: { name: alias },
    be: "map",
    ob: { map }
  };
}
