import { invokeLoop, runDefinitionBody } from "./sandpit.mjs";
import fs from "node:fs";
import path from "node:path";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "./signature.mjs";
import { runAtAll } from "./map.mjs";
import compileHandler from "../verbs/exchange/compile.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { resolveThisValue } from "../library/thisBinding.mjs";
import { throwErrorSentence, surfaceErrorSentence } from "../error.mjs";
import { loadModule, moduleNamespaceFact, pushModuleDir, popModuleDir, registerModuleAlias, isModuleExecuting, pushModuleExecution, popModuleExecution } from "./modules.mjs";
import { deriveSignatureFromDefinition, registerSignatureAlias } from "./signature.mjs";
import { handleLifecycleAspect } from "./runtime.mjs";
import { resolveVerbAlias } from "../library/verbAliases.mjs";
import { callMcpTool, lookupMcpTool } from "../motor/mcp.mjs";
import { resolveInlineGenitive, normalizeDownloadSentence, shouldBootstrapNumberForVerb, applyResolvedTypedValue } from "./imperative_helpers.mjs";
import { throwFileUnavailable } from "../library/file_errors.mjs";
import { isWorldToolsActive, resolveWorldPath } from "../library/world.mjs";
import { TYPE_TOKENS } from "../library/grammar/keywords.mjs";

const GENITIVE_TEXT_TAILS = new Set(["text", "filename"]);
const GENITIVE_TYPE_TAILS = new Set(
  TYPE_TOKENS.map((token) => String(token).toLowerCase())
);

GENITIVE_TYPE_TAILS.add("number");
GENITIVE_TYPE_TAILS.add("boolean");

function resolveGenitiveLiteral(genitive, { state, memory, depth = 0, seen = new Set() } = {}) {
  if (depth > 10) return null;
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return null;
  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state?.currentEvokeRef || state?.currentEvoke)
      : (typeof root === "string" && memory ? memory.remember(root) : null);
  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.genitive) {
      if (seen.has(curr.genitive)) return null;
      seen.add(curr.genitive);
      const resolved = resolveGenitiveLiteral(curr.genitive, { state, memory, depth: depth + 1, seen });
      if (resolved !== null && resolved !== undefined) {
        curr = resolved;
      }
    }
    if (curr && typeof curr === "object" && curr.name && memory) {
      const fact = memory.remember(curr.name);
      if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
    }
    if (curr && typeof curr === "object") {
      if (curr.text !== undefined && (part === "filename" || part === "text")) {
        curr = curr.text;
        continue;
      }
      if (curr.filename !== undefined && part === "filename") {
        curr = curr.filename;
        continue;
      }
      if (curr.ob?.text !== undefined && (part === "filename" || part === "text")) {
        curr = curr.ob.text;
        continue;
      }
      if (curr.ob?.filename !== undefined && part === "filename") {
        curr = curr.ob.filename;
        continue;
      }
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr[part];
      }
    } else {
      curr = curr?.[part];
    }
  }
  if (typeof curr === "string" || typeof curr === "number" || typeof curr === "boolean") return curr;
  if (curr && typeof curr === "object") {
    if (curr.text !== undefined) return curr.text;
    if (curr.filename !== undefined) return curr.filename;
    if (curr.num !== undefined) return curr.num;
    if (curr.boolean !== undefined) return curr.boolean;
  }
  return curr ?? null;
}

function resolveIoGenitives(sentence, { state, memory } = {}) {
  for (const key of ["from", "to"]) {
    const value = sentence?.[key];
    if (!value?.genitive) continue;
    const chainArr = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
    const tail = chainArr.at(-1);
    if (!GENITIVE_TEXT_TAILS.has(tail)) continue;
    const resolved = resolveGenitiveLiteral(value.genitive, { state, memory });
    if (resolved === null || resolved === undefined) continue;
    if (tail === "filename") {
      sentence[key] = { filename: String(resolved) };
    } else if (tail === "text") {
      sentence[key] = { text: String(resolved) };
    }
  }
}

function resolveTypedGenitives(sentence, { state, memory } = {}) {
  if (!sentence || typeof sentence !== "object") return;
  const skipKeys = new Set(["mood", "be", "exists", "signatureWords", "signature", "ret", "this", "consequence", "alternative"]);
  for (const [key, value] of Object.entries(sentence)) {
    if (skipKeys.has(key)) continue;
    if (!value?.genitive) continue;
    if (typeof value !== "object") continue;
    const chainArr = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
    const tail = String(chainArr.at(-1) ?? "").toLowerCase();
    if (!GENITIVE_TYPE_TAILS.has(tail)) continue;
    const resolved = resolveGenitiveLiteral(value.genitive, { state, memory });
    if (resolved === null || resolved === undefined) continue;
    if (tail === "name") {
      value.name = String(resolved);
      const parentChain = chainArr.slice(0, -1);
      if (parentChain.length) {
        const parentResolved = resolveGenitiveLiteral({ chain: parentChain }, { state, memory });
        if (parentResolved && typeof parentResolved === "object") {
          const typeWords = Array.isArray(parentResolved.nameTypeWords)
            ? parentResolved.nameTypeWords.map((word) => String(word))
            : null;
          if (typeWords && typeWords.length) {
            value.nameTypeWords = typeWords;
            continue;
          }
        }
      }
      const fact = memory?.remember?.(value.name);
      const be = String(fact?.be ?? "").trim();
      if (be === "mind") value.nameTypeWords = ["mind"];
      else if (be === "refinery") value.nameTypeWords = ["refinery"];
      else if (be === "map") value.nameTypeWords = ["map"];
      continue;
    }
    applyResolvedTypedValue(value, tail, resolved);
  }
}

function resolveSourceFilename(raw, { rememberFn } = {}) {
  if (!raw) return null;
  const value = String(raw);
  const agentCwd = rememberFn?.("agent cwd")?.ob?.filename ?? null;
  if (agentCwd && !path.isAbsolute(value)) {
    return path.resolve(agentCwd, value);
  }
  if (isWorldToolsActive({ rememberFn })) {
    const { resolved } = resolveWorldPath(value, { rememberFn });
    return resolved;
  }
  return path.resolve(value);
}

function guardSourceFilenames(sentence, { rememberFn } = {}) {
  if (sentence?.mood !== "do") return;
  const be = sentence?.be ?? "";
  if (be === "import") return;
  if (be === "exists" || be === "touch" || be === "directory" || be === "text" || be === "filename") return;
  if (be === "download") return;
  if (be === "read" && (sentence?.ob?.wo === "tail" || sentence?.ob?.text === "tail")) return;
  const slots = [
    sentence?.from?.filename ? { role: "from", value: sentence.from.filename } : null,
    sentence?.ob?.filename ? { role: "ob", value: sentence.ob.filename } : null
  ].filter(Boolean);
  if (!slots.length) return;
  for (const slot of slots) {
    const raw = String(slot.value ?? "");
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) continue;
    const resolved = resolveSourceFilename(raw, { rememberFn });
    if (!resolved) continue;
    if (!fs.existsSync(resolved)) {
      throwFileUnavailable({ path: resolved, from: be || "interpret" });
    }
  }
}

export async function handleImperative({
  sentence,
  state,
  memory,
  recordSandpitTrace,
  getDefinitionEntry,
  interpret
}) {
  if (sentence?.be) {
    const resolved = resolveVerbAlias(sentence.be);
    if (resolved !== sentence.be) {
      const hasDefinition = typeof getDefinitionEntry === "function" && getDefinitionEntry(sentence.be);
      if (!hasDefinition) sentence.be = resolved;
    }
  }

  if (sentence?.mood === "do") {
    normalizeDownloadSentence(sentence);
  }

  const { mood } = sentence;
  if (mood !== "do") return null;

  resolveIoGenitives(sentence, { state, memory });
  resolveTypedGenitives(sentence, { state, memory });
  const { be, ob, to, from, su } = sentence;
  guardSourceFilenames(sentence, { rememberFn: memory.remember });

  if (be === "import" && (sentence.from?.name || sentence.from?.filename)) {
    const specifier = sentence.from.name ?? sentence.from.filename;
    const symbol = sentence.ob?.name;
    const alias = symbol ? null : sentence.to?.name;
    const source = "interpret import";
    const record = await loadModule({ specifier, alias, source });
    if (isModuleExecuting(record.id)) {
      throwErrorSentence({
        name: "module import cycle",
        message: `module import cycle detected: ${record.id}`,
        from: { name: source },
        raw: sentence
      });
    }

    if (!record.alreadyLoaded) {
      pushModuleExecution(record.id, { source });
      pushModuleDir(record.dir);
      try {
        for (const s of record.sentences) {
          await interpret(s);
        }
      } finally {
        popModuleDir();
        popModuleExecution(record.id);
      }
    }

    const exportFacts = new Map();
    const exportRefs = new Map();
    const exportNameMap = record.alreadyLoaded && record.primaryNameMap ? record.primaryNameMap : record.nameMap;
    for (const name of record.exportNames) {
      if (record.localCeremonies.has(name)) continue;
      const mapped = exportNameMap.get(name);
      const fact = mapped ? memory.remember(mapped) : null;
      if (fact?.ob !== undefined) exportFacts.set(name, fact.ob);
      if (mapped) exportRefs.set(name, { name: mapped });
    }

    // Namespace imports keep qualified ceremony names internally (e.g. "ns foo").
    // Register unqualified exported ceremony aliases so callers can invoke
    // exported verbs directly (e.g. "be foo ...") when the module exports them.
    for (const name of record.exportNames) {
      if (!record.localCeremonies.has(name)) continue;
      const mapped = exportNameMap.get(name);
      const entries = mapped ? memory.getDefinitionEntries(mapped) : [];
      const all = memory.allRemember();
      for (const entry of entries) {
        const def = all[entry.index];
        const sig = def?.signatureWords ?? (def ? deriveSignatureFromDefinition(def) : null);
        if (!sig?.length) continue;
        const aliasSig = [...sig];
        aliasSig[1] = name;
        registerSignatureAlias({ name: mapped, signatureWords: aliasSig, source: record.id });
      }
    }

    if (symbol) {
      if (!record.exportNames.has(symbol)) {
        throwErrorSentence({
          name: "module export incomplete",
          message: `module export missing: ${symbol}`,
          from: { name: source },
          raw: sentence
        });
      }

      if (record.localCeremonies.has(symbol)) {
        const mapped = record.nameMap.get(symbol);
        const entries = mapped ? memory.getDefinitionEntries(mapped) : [];
        if (!entries.length) {
          throwErrorSentence({
            name: "module export incomplete",
            message: `module ceremony signature missing: ${symbol}`,
            from: { name: source },
            raw: sentence
          });
        }
        const localName = sentence.to?.name ?? symbol;
        const all = memory.allRemember();
        for (const entry of entries) {
          const def = all[entry.index];
          const sig = def?.signatureWords ?? (def ? deriveSignatureFromDefinition(def) : null);
          if (!sig) {
            throwErrorSentence({
              name: "module export incomplete",
              message: `module ceremony signature missing: ${symbol}`,
              from: { name: source },
              raw: sentence
            });
          }
          const aliasSig = [...sig];
          aliasSig[1] = localName;
          registerSignatureAlias({ name: mapped, signatureWords: aliasSig, source: record.id });
        }
        return { imported: localName };
      }

      const mapped = record.nameMap.get(symbol);
      const fact = mapped ? memory.remember(mapped) : null;
      if (!fact) {
        throwErrorSentence({
          name: "module export incomplete",
          message: `module export missing: ${symbol}`,
          from: { name: source },
          raw: sentence
        });
      }
      const localName = sentence.to?.name ?? symbol;
      memory.doRemember({ ...fact, su: { name: localName }, mood: "ya" });
      return { imported: localName };
    }

    const namespaceAlias = alias ?? record.alias;
    if (namespaceAlias) {
      registerModuleAlias({ alias: namespaceAlias, moduleId: record.id, source });
      const namespaceFact = moduleNamespaceFact({ alias: namespaceAlias, exportRefs });
      memory.doRemember(namespaceFact);
    }

    return { imported: namespaceAlias };
  }

  if (sentence.ob?.thisRef) {
    const resolved = resolveThisValue(sentence.ob, state.currentEvokeRef || state.currentEvoke);
    if (resolved !== null && resolved !== undefined) {
      sentence.ob = typeof resolved === "number" ? { num: resolved } : resolved;
    }
    if (sentence.be === "plus" && sentence.ob?.num === undefined && sentence.ob?.thisRef === "by") {
      console.log("debug plus ob thisRef by", resolved);
    }
  } else if (sentence.ob?.genitive) {
    const resolved = resolveInlineGenitive(sentence.ob.genitive, state);
    if (resolved !== undefined) {
      sentence.ob = { num: resolved };
    }
  }
  if (sentence.by?.genitive) {
    const resolved = resolveInlineGenitive(sentence.by.genitive, state);
    if (resolved !== undefined) {
      sentence.by = { num: resolved };
    }
  }

  const lifecycleResult = handleLifecycleAspect(sentence, { remember: memory.remember, doRemember: memory.doRemember });
  if (lifecycleResult) {
    const surfaced = surfaceErrorSentence(lifecycleResult);
    if (surfaced?.mood && surfaced?.be) {
      if (surfaced.ob !== undefined) {
        memory.doRemember({
          su: { name: "result" },
          ob: surfaced.ob,
          be: surfaced.be,
          mood: "ya"
        });
      }
    }
    return surfaced;
  }

  const hasSequenceRegisters =
    sentence.fromindex != null || sentence.toindex != null || sentence.atindex != null;
  let fn = null;
  let defEntry = getDefinitionEntry(be);
  let defResolvedBySignature = false;
  const hasLoopRegisters = sentence.fromindex != null || sentence.toindex != null;
  const hasAtAll = sentence.at?.name === "all" || sentence.at === "all";

  const sigWords = deriveSignatureFromCall(sentence, { remember: memory.remember });
  const baseSigWords =
    hasSequenceRegisters && sigWords
      ? (() => {
          const { fromindex, toindex, atindex, ...rest } = sentence;
          return deriveSignatureFromCall(rest, { remember: memory.remember });
        })()
      : null;
  let sigKey = null;
  let baseSigKey = null;
  if (sigWords) {
    sigKey = joinSignatureWords(sigWords);
    if (!defEntry) {
      const defName = lookupSignature(sigKey);
      if (defName) {
        const sigForDef = Array.isArray(sigWords) ? [...sigWords] : null;
        if (sigForDef) sigForDef[1] = defName;
        defEntry = memory.getDefinitionEntryBySignature(defName, sigForDef ?? sigWords) ?? getDefinitionEntry(defName);
        defResolvedBySignature = Boolean(defEntry);
      }
    }
    if (!fn && !defEntry) {
      const handler = lookupSignatureHandler(sigKey);
      if (handler) fn = handler;
    }
  }
  if (!fn && !defEntry && baseSigWords) {
    baseSigKey = joinSignatureWords(baseSigWords);
    const defName = lookupSignature(baseSigKey);
    if (defName) {
      const sigForDef = Array.isArray(baseSigWords) ? [...baseSigWords] : null;
      if (sigForDef) sigForDef[1] = defName;
      defEntry = memory.getDefinitionEntryBySignature(defName, sigForDef ?? baseSigWords) ?? getDefinitionEntry(defName);
      defResolvedBySignature = Boolean(defEntry);
    }
    if (!fn && !defEntry) {
      const handler = lookupSignatureHandler(baseSigKey);
      if (handler) fn = handler;
    }
  }
  if (!fn && !defEntry && lookupMcpTool(be)) {
    fn = (callSentence) => callMcpTool({
      verbName: be,
      sentence: callSentence,
      rememberFn: memory.remember,
      doRememberFn: memory.doRemember,
      allRememberFn: memory.allRemember
    });
  }

  // Fallback: allow compile to run even if signature words don't fully match a registered handler
  if (!fn && !defEntry && be === "compile") {
    fn = compileHandler;
  }

  // Inline conditional with consequence (e.g., "be equally ... then ...")
  if ((sentence.consequence || sentence.alternative) && (be === "equally" || be === "tiny" || be === "giant" || be === "resemble")) {
    if (!fn) {
      const pyash = sentenceToPyash(sentence);
      throwErrorSentence({
        name: "unknown verb",
        message: `Unknown verb/signature: ${sigKey ?? be}`,
        from: { name: "interpret" },
        pyash,
        raw: sentence
      });
    }
    const lhs =
      sentence.ob?.name && memory.remember(sentence.ob.name)
        ? memory.remember(sentence.ob.name).ob
        : sentence.ob !== undefined
        ? sentence.ob
        : sentence.su?.name && memory.remember(sentence.su.name)
        ? memory.remember(sentence.su.name).ob
        : sentence.su;
    const rhs =
      sentence.from?.name && memory.remember(sentence.from.name)
        ? memory.remember(sentence.from.name).ob
        : sentence.from;
    const truth = await fn({ su: lhs, from: rhs });
    if (truth && sentence.consequence) {
      return interpret(sentence.consequence);
    }
    if (!truth && sentence.alternative) {
      return interpret(sentence.alternative);
    }
    return { condition: truth };
  }

  if (hasAtAll) {
    const atAllResult = await runAtAll({
      sentence,
      remember: memory.remember,
      memory,
      getDefinitionEntry,
      state,
      recordSandpitTrace,
      interpret
    });
    if (atAllResult) {
      memory.doRemember(atAllResult);
      memory.doRemember({ su: { name: "result" }, ob: atAllResult.ob, be: atAllResult.be, mood: "ya" });
      return { acted: atAllResult.su?.name, value: atAllResult.ob };
    }
  }

  if (!fn && !defEntry && sigKey && !hasAtAll) {
    const sigWordsStr = sigWords ? sigWords.join(" ") : "(none)";
    const pyash = sentenceToPyash(sentence);
    throwErrorSentence({
      name: "unknown verb",
      message: `Unknown verb/signature: ${sigKey}; derived: ${sigWordsStr}`,
      from: { name: "interpret" },
      pyash,
      raw: sentence
    });
  }

  if (!fn && defEntry) {
    if (sigWords && defEntry?.name) {
      const matched = memory.getDefinitionEntryBySignature(defEntry.name, sigWords);
      if (matched) {
        defEntry = matched;
        defResolvedBySignature = true;
      }
    }
    if (su?.name === "tloh" || sentence.be === "tloh" || sentence.until !== undefined || sentence.tloh !== undefined) {
      throw new Error("tloh/until no longer supported; use fromindex/toindex");
    }

    if (hasLoopRegisters) {
      const lastResult = await invokeLoop({
        defEntry,
        sentence,
        state,
        memory,
        interpret,
        recordSandpitTrace
      });
      return { invoked: be, result: lastResult };
    }

    if (typeof defEntry.end !== "number") {
      throw new Error(`Definition ${be} missing closing prah`);
    }

    // Enforce signature compatibility between evoker and definition
    const defSentence = memory.allRemember()[defEntry.index];
    const defSignatureWords = defSentence?.signatureWords;
    const callSignatureWords = sigWords;
    if (!defResolvedBySignature && Array.isArray(defSignatureWords) && defSignatureWords.length > 0 && Array.isArray(callSignatureWords) && callSignatureWords.length > 0) {
      const defSigKey = joinSignatureWords(defSignatureWords);
      const callSigKey = joinSignatureWords(callSignatureWords);
      const relaxedCallSigKey = baseSigWords ? joinSignatureWords(baseSigWords) : null;
      if (defSigKey !== callSigKey && defSigKey !== relaxedCallSigKey) {
        const pyash = sentenceToPyash(sentence);
        throwErrorSentence({
          name: "signature inconsistency",
          message: `Ceremony signature inconsistency: expected ${defSigKey}, got ${callSigKey}`,
          from: { name: "interpret" },
          pyash,
          raw: sentence
        });
      }
    }

    const defResult = await runDefinitionBody({
      defEntry,
      sentence,
      state,
      memory,
      interpret,
      recordSandpitTrace
    });

    return defResult;
  }

  if (!fn && !hasAtAll) {
    const sigWordsStr = sigWords ? sigWords.join(" ") : "(none)";
    const pyash = sentenceToPyash(sentence);
    throwErrorSentence({
      name: "unknown verb",
      message: `Unknown verb: ${be}; derived: ${sigWordsStr}`,
      from: { name: "interpret" },
      pyash,
      raw: sentence
    });
  }

  const addressedName = to?.name || (be === "subtract" ? sentence.from?.name : undefined);
  let target = addressedName ? memory.remember(addressedName) : memory.remember(to?.name);
  const shouldBootstrapNumber = shouldBootstrapNumberForVerb({ be, sentence, addressedName });
  if (!target && shouldBootstrapNumber) {
    // create default numeric fact if it doesn't exist for math-like verbs
    target = { su: { name: addressedName }, be: "number", ob: { num: 0 }, mood: "ya" };
    memory.doRemember(target);
  }

  const useRawTo =
    be === "mind" ||
    be === "say" ||
    be === "write" ||
    (be === "plus" && (sentence.ob?.text || target?.ob?.text !== undefined));
  const toValue = useRawTo ? (to ?? sentence.to) : (target?.ob ?? to);

  // pass the current value, not the name
  const callSentence = {
    ...sentence,
    ob: sentence.ob,
    to: toValue ?? to ?? sentence.to,
    from: sentence.from ?? from,
    by: sentence.by
  };

  const result = await fn(callSentence, { remember: memory.remember });

  if (result?.mood && result?.be && result?.su) {
    const surfaced = surfaceErrorSentence(result);
    if (surfaced.be !== "chip") {
      memory.doRemember(surfaced);
    }
    if (surfaced.ob !== undefined) {
      const priorResult = memory.remember("result");
      if (surfaced.be === "stream" && priorResult?.be && priorResult.be !== "stream") {
        return surfaced;
      }
      memory.doRemember({
        su: { name: "result" },
        ob: surfaced.ob,
        be: surfaced.be,
        mood: "ya"
      });
    }
    return surfaced;
  }

  // record the command itself in history
  memory.doRemember(sentence);

  // expect verbs to return { ob: number | {num: number} }
  if (result?.ob !== undefined) {
    // ensure a target fact exists if user addressed one
    const targetBe = sentence.to?.context || sentence.become?.name || sentence.be || "result";
    const dest =
      target ||
      (addressedName
        ? {
            su: { name: addressedName },
            be: targetBe,
            ob: {},
            mood: "ya",
          }
        : to?.name
        ? {
            su: { name: to.name },
            be: targetBe,
            ob: {},
            mood: "ya",
          }
        : sentence?.su
        ? {
            su: sentence.su,
            be: sentence.be === "read" ? "text" : targetBe,
            ob: {},
            mood: "ya",
          }
        : null);

    const normalizedObj =
      typeof result.ob === "object" ? result.ob : { num: result.ob };
    const resultBe = result.be ?? targetBe;

    if (dest) {
      dest.ob = normalizedObj;
      if (result.be !== undefined) {
        dest.be = resultBe;
      } else if (!dest.be) {
        dest.be = resultBe;
      }
      memory.doRemember(dest);
    }

    // Also store result under the action's su name to ease migration.
    if (sentence?.su?.name) {
      memory.doRemember({
        su: { name: sentence.su.name },
        ob: normalizedObj,
        be: resultBe,
        mood: "ya"
      });
    }

    // Always store a result fact for reference
    memory.doRemember({
      su: { name: "result" },
      ob: normalizedObj,
      be: resultBe,
      mood: "ya"
    });
  }

  return { acted: to?.name, value: result?.ob };
}
