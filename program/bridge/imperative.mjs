import { invokeLoop, runDefinitionBody } from "./sandpit.mjs";
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
import { resolveInlineGenitive, normalizeDownloadSentence, shouldBootstrapNumberForVerb } from "./imperative_helpers.mjs";

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

  const { mood, be, ob, to, from, su } = sentence;
  if (mood !== "do") return null;

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
    for (const name of record.exportNames) {
      if (record.localCeremonies.has(name)) continue;
      const mapped = record.nameMap.get(name);
      const fact = mapped ? memory.remember(mapped) : null;
      if (fact?.ob !== undefined) exportFacts.set(name, fact.ob);
      if (mapped) exportRefs.set(name, { name: mapped });
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
  if (!fn && be === "compile") {
    fn = compileHandler;
  }

  // Inline conditional with consequence (e.g., "be equally ... then ...")
  if (sentence.consequence && (be === "equally" || be === "tiny" || be === "giant")) {
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
    return { condition: truth };
  }

  if (hasAtAll) {
    const atAllResult = await runAtAll({
      sentence,
      remember: memory.remember,
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
    if (sigWords && !defResolvedBySignature && defEntry?.name) {
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
