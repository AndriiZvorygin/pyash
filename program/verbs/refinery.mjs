import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { runRefinery } from "../bridge/refinery.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import { surfaceErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveGenitiveText(genitive) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;
  const [root, ...rest] = chainArr;
  let curr = typeof root === "string" ? remember(root) : undefined;
  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name) {
      const fact = remember(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
    } else {
      curr = curr?.[part];
    }
  }
  if (typeof curr === "string") return curr;
  if (typeof curr === "number") return String(curr);
  if (curr && typeof curr === "object") {
    if (curr.text !== undefined) return String(curr.text);
    if (curr.num !== undefined) return String(curr.num);
    if (curr.boolean !== undefined) return curr.boolean ? "truth" : "lie";
  }
  return curr;
}

function resolveTaskOb(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (typeof ob.text === "string") return { text: ob.text };
  if (typeof ob.num === "number") return { num: ob.num };
  if (typeof ob.boolean === "boolean") return { boolean: ob.boolean };
  if (ob.genitive) {
    const text = resolveGenitiveText(ob.genitive);
    if (typeof text === "string") return { text };
  }
  if (typeof ob.name === "string") {
    const fact = remember(ob.name);
    if (fact?.ob?.text !== undefined) return { text: String(fact.ob.text) };
    if (fact?.ob?.num !== undefined) return { num: Number(fact.ob.num) };
    if (fact?.ob?.boolean !== undefined) return { boolean: !!fact.ob.boolean };
    return { text: ob.name };
  }
  return null;
}

async function refinery(sentence) {
  const interpret = await resolveInterpret();
  const refineryName =
    sentence?.from?.name ??
    resolveConfigText("refinery name", { rememberFn: remember }) ??
    null;
  const taskOb = resolveTaskOb(sentence?.ob);
  const priorTask = remember("task");

  if (taskOb) {
    doRemember({ mood: "ya", su: { name: "task" }, ob: taskOb, be: "text" });
  }

  try {
    const resultSentence = await runRefinery({
      name: refineryName,
      interpret,
      runId: null,
      onEvoke: (actionSentence) => {
        emitExchangeSentence({ mood: "ya", be: "evoke", ob: { la: actionSentence } });
      },
      onCheckpoint: (checkpointSentence) => {
        emitExchangeSentence(checkpointSentence);
      },
      onRetry: (retrySentence) => {
        emitExchangeSentence(retrySentence);
      },
      onResult: (res) => {
        const surfaced = surfaceErrorSentence(res);
        if (surfaced?.mood) emitExchangeSentence(surfaced);
      }
    });
    if (resultSentence?.mood && resultSentence?.be) {
      if (resultSentence.be === "error") return resultSentence;
      return { ob: resultSentence.ob ?? {}, be: resultSentence.be };
    }
    return { ob: resultSentence ?? {}, be: "result" };
  } finally {
    if (priorTask) {
      doRemember(priorTask);
    }
  }
}

export const signatures = [
  { signatureWords: ["be", "refinery", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text"], handler: refinery }
];

export default refinery;
