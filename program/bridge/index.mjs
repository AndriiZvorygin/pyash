// bridge (formerly dispatcher)
import { add, subtract, invert, exponential, multiply, divide, produce, neuron, twiceCrescent, chip, understand, read, mind, giant, tiny, equally } from "../verbs/index.mjs";
import {
  remember,
  doRemember,
  allRemember,
  getDefinition,
  getDefinitionEntry,
  getDefinitionEntryBySignature,
  getDefinitionEntries,
  getDefinitionBody,
  pushMemoryContext,
  popMemoryContext,
  recordSandpitTrace
} from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { handleCondition } from "./conditions.mjs";
import { handleThisBinding, handleReturn } from "./returns.mjs";
import { handleImperative } from "./imperative.mjs";
import { state } from "./state.mjs";
import { startRefinery, recordPlatform, endRefinery, isInsideRefinery } from "./refinery.mjs";
import { deriveSignatureFromDefinition, registerSignature, registerSignatureHandler } from "./signature.mjs";
import { builtInSignatures } from "../verbs/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { applyEnvDefaults } from "../configure/env.mjs";

function resolveFillCount(by, remember) {
  if (!by) return null;
  if (typeof by.num === "number") return by.num;
  if (typeof by.name === "string") return remember(by.name)?.ob?.num ?? null;
  if (by.genitive?.chain?.length) {
    const [root, ...rest] = by.genitive.chain;
    let curr = root === "this" ? null : remember(root);
    for (const part of rest) {
      if (curr == null) break;
      curr = curr[part];
    }
    if (typeof curr === "number") return curr;
    if (typeof curr?.num === "number") return curr.num;
  }
  return null;
}

for (const sig of builtInSignatures) {
  registerSignatureHandler(sig);
}

const SEQUENCE_REGISTERS = new Set(["fromindex", "toindex", "atindex"]);

function collectSequenceDeps(sentence, deps = new Set()) {
  if (!sentence || typeof sentence !== "object") return deps;
  const scanValue = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.thisRef && SEQUENCE_REGISTERS.has(value.thisRef)) {
      deps.add(value.thisRef);
    }
    if (value.genitive?.chain) {
      const chain = Array.isArray(value.genitive.chain) ? value.genitive.chain : [];
      if (chain.includes("this")) {
        for (const reg of SEQUENCE_REGISTERS) {
          if (chain.includes(reg)) deps.add(reg);
        }
      }
    }
    if (Array.isArray(value)) {
      value.forEach(scanValue);
    }
  };

  for (const [key, value] of Object.entries(sentence)) {
    if (key === "consequence") {
      collectSequenceDeps(value, deps);
      continue;
    }
    if (typeof value === "object") scanValue(value);
  }
  return deps;
}

function validateCeremonySequenceDeps(name) {
  if (!name) return;
  const defSentence = getDefinition(name);
  if (!defSentence) return;
  const body = getDefinitionBody(name);
  const deps = new Set();
  for (const s of body) collectSequenceDeps(s, deps);
  for (const reg of deps) {
    if (!defSentence[reg]) {
      throwErrorSentence({
        name: "sequence register missing",
        message: `ceremony "${name}" reads this ${reg} but definition omits ${reg}`,
        from: { name: "interpret" },
        raw: { ceremony: name, missing: reg }
      });
    }
  }
}

export async function interpret(sentence) {
  if (!sentence) return;
  applyEnvDefaults({ rememberFn: remember, doRememberFn: doRemember });
  if (sentence.subj && !sentence.su) sentence.su = sentence.subj;
  if (sentence.obj && !sentence.ob) sentence.ob = sentence.obj;
  if (sentence.subj) delete sentence.subj;
  if (sentence.obj) delete sentence.obj;

  const { mood, be, su, ob, to, from } = sentence;
  const isMapDef = mood === "def" && (be === "map" || be === "json map" || be === "csv map");
  const isMapPrah = mood === "prah" && (be === "map" || be === "json map" || be === "csv map");
  const insideMap = state.mapStack.length > 0;
  const isRefineryDef = mood === "def" && be === "refinery";
  const isRefineryPrah = mood === "prah" && be === "refinery";
  const insideRefinery = isInsideRefinery();

  if (isMapDef) {
    state.mapStack.push({ name: su?.name ?? null, kind: be, entries: [] });
    return { mapStart: true };
  }

  if (insideMap && mood !== "prah") {
    const frame = state.mapStack[state.mapStack.length - 1];
    frame.entries.push(sentence);
    return { recorded: true };
  }

  if (insideMap && mood === "prah") {
    const frame = state.mapStack.pop();
    const map = {};
    const seen = new Set();
    for (const entry of frame.entries) {
      if (frame.kind === "map") {
        if (!entry?.su?.name) {
          throwErrorSentence({
            name: "pyash map sentence lost su",
            message: "pyash map sentence lost su",
            from: { name: "interpret" },
            raw: entry
          });
        }
        if (seen.has(entry.su.name)) {
          throwErrorSentence({
            name: "pyash map switch excess",
            message: "pyash map switch excess",
            from: { name: "interpret" },
            raw: { name: entry.su.name }
          });
        }
        seen.add(entry.su.name);
      }
      if (frame.kind === "json map") {
        if (!entry?.su?.name) {
          throwErrorSentence({
            name: "json map sentence lost su",
            message: "json map sentence lost su",
            from: { name: "interpret" },
            raw: entry
          });
        }
        if (entry?.ob === undefined) {
          throwErrorSentence({
            name: "json map sentence lost ob",
            message: "json map sentence lost ob",
            from: { name: "interpret" },
            raw: entry
          });
        }
      }
      const key = entry?.su?.name;
      if (!key) continue;
      map[key] = frame.kind === "map" ? entry : (entry.ob ?? {});
    }
    const mapSentence = {
      mood: "ya",
      su: { name: frame.name },
      be: frame.kind,
      ob: { map }
    };
    doRemember(mapSentence);
    return { stored: frame.name };
  }

  if (isRefineryDef) {
    startRefinery(su?.name ?? null);
    return { refineryStart: true };
  }

  if (insideRefinery && mood !== "prah") {
    return recordPlatform(sentence);
  }

  if (insideRefinery && mood === "prah") {
    return { refineryEnd: endRefinery(sentence.su?.name ?? null) };
  }

  if (!insideRefinery && mood === "ya" && be === "platform") {
    throwErrorSentence({
      name: "refinery defective",
      message: "platform outside refinery",
      from: { name: "interpret" },
      raw: sentence
    });
  }

  // one-line skip after a false condition
  if (!state.lastCondition && mood !== "then") {
    state.lastCondition = true;
    return { skipped: true };
  }

  const isParagraphDef = mood === "def" && sentence.be === "ceremony";
  const insideParagraph = state.definitionStack.length > 0;

  if (isParagraphDef) {
    state.definitionStack.push(su?.name ?? null);
  }

  if (insideParagraph && !state.executingBody && mood !== "prah" && !isParagraphDef) {
    doRemember(sentence);
    return { recorded: true };
  }

  if (mood === "prah") {
    let prahSentence = sentence;
    if (!prahSentence.su?.name && state.definitionStack.length > 0) {
      prahSentence = { ...prahSentence, su: { name: state.definitionStack[state.definitionStack.length - 1] } };
    }
    doRemember(prahSentence);
    if (state.definitionStack.length > 0) state.definitionStack.pop();
    if (prahSentence.su?.name) validateCeremonySequenceDeps(prahSentence.su.name);
    return { paragraphEnd: true };
  }

  // --- Conditional ---
  if (mood === "then") {
    return handleCondition(sentence, { state, remember });
  }

  // --- Declarative (including definitions): append; last-write-wins via remember ---
  const thisBound = handleThisBinding(sentence, state);
  if (thisBound) {
    return interpret(thisBound);
  }

  const retResult = handleReturn(sentence, state, remember);
  if (retResult) {
    return retResult;
  }

  if (mood === "ya" || mood === "def") {
    if (mood === "def" && be === "ceremony") {
      const sig = deriveSignatureFromDefinition(sentence);
      if (sig) {
        sentence.signatureWords = sig;
        if (su?.name && getDefinitionEntryBySignature(su.name, sig)) {
          console.warn(`ceremony redefined: ${su.name}`);
        }
        registerSignature({ name: su?.name, signatureWords: sig });
      }
    }

    // Vector fill sugar: "ob ve <type> <value> by num N be vector ya"
    if (mood === "ya" && be === "vector" && sentence?.ob?.ve?.values?.length === 1) {
      const resolved = resolveFillCount(sentence.by, remember);
      const n = resolved == null ? null : Math.trunc(resolved);
      if (n > 0) {
        const elem = sentence.ob.ve.values[0];
        const filled = { ...sentence, ob: { ...(sentence.ob || {}), ve: { ...(sentence.ob.ve || {}), values: Array(n).fill(elem) } } };
        // Avoid persisting the fill-count as part of the stored fact.
        delete filled.by;
        doRemember(filled);
        return { stored: su?.name };
      }
    }

    doRemember(sentence);
    return { stored: su?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    if (sentence.exists) {
      throwErrorSentence({
        name: "exists defective",
        message: "exists is only valid on ya sentences",
        from: { name: "interpret" },
        raw: sentence
      });
    }
    const imperativeResult = await handleImperative({
      sentence,
      state,
      memory: {
        remember,
        doRemember,
        allRemember,
        pushMemoryContext,
        popMemoryContext,
        getDefinition,
        getDefinitionEntries,
        getDefinitionEntryBySignature
      },
      recordSandpitTrace,
      getDefinitionEntry,
      interpret
    });
    if (imperativeResult) return imperativeResult;
  }

  // --- Interrogative ---
  if (mood === "que") {
    const fact = remember(su?.name);
    if (!fact) return null;

    // For now your tests want the whole matching sentence as Pyash
    return sentenceToPyash(fact);
  }

  throw new Error(`Unknown mood: ${mood}`);
}

export { allRemember };
