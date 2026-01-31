import fsSync from "node:fs";
import path from "node:path";
import { clearModuleCache, loadModule, setEntryModulePath } from "../../../bridge/modules.mjs";
import { throwErrorSentence } from "../../../error.mjs";
import { collectExportFacts, findDefinitionBlock, mapNamespaceSentences } from "./module_helpers.mjs";

async function expandModulesForCompile(entryPath, sentences) {
  clearModuleCache();
  if (entryPath) setEntryModulePath(entryPath);

  const modules = [];
  const seen = new Set();
  const aliasToId = new Map();
  const entryDir = entryPath ? path.dirname(path.resolve(entryPath)) : process.cwd();
  const normalizeSpecifier = (specifier, baseDir) => {
    if (!specifier) return specifier;
    if (specifier.startsWith("./") || specifier.startsWith("../") || path.isAbsolute(specifier)) {
      return specifier;
    }
    if (specifier.includes("/") || specifier.includes("\\") || specifier.endsWith(".pya")) {
      const primary = path.resolve(baseDir || entryDir, specifier);
      if (fsSync.existsSync(primary)) return primary;
      const fallback = path.resolve(process.cwd(), specifier);
      if (fsSync.existsSync(fallback)) return fallback;
      return primary;
    }
    return specifier;
  };

  const includeModule = async (specifier, alias, baseDir) => {
    const record = await loadModule({
      specifier: normalizeSpecifier(specifier, baseDir),
      alias,
      source: "compile import"
    });
    const cacheKey = `${record.id}::${record.alias}`;
    if (seen.has(cacheKey)) return record;
    seen.add(cacheKey);

    const local = [];
    for (const s of record.sentences) {
      if (s?.mood === "do" && s?.be === "import") {
        const specifier = s?.from?.name ?? s?.from?.filename ?? s?.ob?.filename;
        if (specifier) {
          await includeModule(specifier, s?.to?.name, record.dir);
          continue;
        }
      }
      local.push(s);
    }

    const exportFacts = collectExportFacts(record, local);
    modules.push({ record, sentences: local, exportFacts });
    return record;
  };

  const entry = [];
  const aliasBlocks = [];

  for (const s of sentences) {
    if (s?.mood === "do" && s?.be === "import") {
      const specifier = s?.from?.name ?? s?.from?.filename ?? s?.ob?.filename;
      if (!specifier) {
        entry.push(s);
        continue;
      }
      const symbol = s.ob?.name;
      const record = await includeModule(specifier, symbol ? null : s.to?.name, entryDir);
      const aliasName = symbol ? null : (record.alias ?? s.to?.name);
      if (aliasName) {
        const existing = aliasToId.get(aliasName);
        if (existing && existing !== record.id) {
          throwErrorSentence({
            name: "module alias conflict",
            message: `module alias already used: ${aliasName}`,
            from: { name: "compile" },
            raw: { alias: aliasName, existing, current: record.id }
          });
        }
        aliasToId.set(aliasName, record.id);
      }
      if (symbol) {
        if (record.localCeremonies.has(symbol)) {
          const mapped = record.nameMap.get(symbol);
          const block = findDefinitionBlock(record.sentences, mapped);
          if (block?.def) {
            const localName = s.to?.name ?? symbol;
            aliasBlocks.push({ def: { ...block.def, su: { name: localName } }, body: block.body, prah: block.prah });
          }
        } else {
          const exported = collectExportFacts(record, record.sentences);
          if (exported.has(symbol)) {
            const localName = s.to?.name ?? symbol;
            const fact = exported.get(symbol);
            if (fact?.be === "map" || fact?.be === "json map") {
              const entries = fact.ob?.map ?? {};
              const def = { mood: "def", be: fact.be, su: { name: localName } };
              const body = Object.entries(entries).map(([key, ob]) => ({
                mood: "ya",
                su: { name: key },
                ob: ob ?? {}
              }));
              const prah = { mood: "prah", be: fact.be, su: { name: localName } };
              aliasBlocks.push({ def, body, prah });
            } else {
              aliasBlocks.push({ fact: { mood: "ya", su: { name: localName }, be: fact?.be, ob: fact?.ob ?? {} } });
            }
          }
        }
      }
      continue;
    }
    entry.push(s);
  }

  const combined = [];
  for (const mod of modules) {
    combined.push(...mod.sentences);
    if (mod.exportFacts.size && mod.record.alias) {
      combined.push(...mapNamespaceSentences({ alias: mod.record.alias, exportFacts: mod.exportFacts, nameMap: mod.record.nameMap }));
    }
  }

  for (const block of aliasBlocks) {
    if (block.fact) {
      combined.push(block.fact);
      continue;
    }
    combined.push(block.def, ...block.body, block.prah);
  }

  combined.push(...entry);
  return combined;
}

export { expandModulesForCompile };
