import { remember, doRemember } from "../remember/index.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import {
  decideHeadquartersApproval,
  requestHeadquartersApproval
} from "../agent/headquarters/approval.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function caseText(value, { resolveName = true } = {}) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (value.text !== undefined) return text(value.text);
  if (value.name !== undefined) {
    const name = text(value.name);
    if (resolveName) {
      const fact = remember(name);
      if (fact?.ob?.text !== undefined) return text(fact.ob.text);
      if (fact?.ob?.name !== undefined) return text(fact.ob.name);
      if (fact?.ob?.map !== undefined) return fact.ob.map;
    }
    return name;
  }
  if (value.map !== undefined) return value.map;
  return "";
}

function proposalValue(sentence) {
  if (sentence?.with?.map) return sentence.with.map;
  if (sentence?.with?.text !== undefined) return sentence.with.text;
  if (sentence?.with?.name !== undefined) return caseText(sentence.with);
  return {};
}

function typed(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { map: value };
  if (typeof value === "boolean") return { boolean: value };
  if (typeof value === "number") return { num: value };
  return { text: String(value ?? "") };
}

function resultMap(result) {
  const fields = {
    "task id": result.taskId,
    owner: result.owner,
    state: result.state,
    action: result.action,
    proposal: JSON.stringify(result.proposal ?? {}),
    "request id": result.requestId,
    "resume token": result.resumeToken,
    "checkpoint identity": result.checkpointIdentity,
    "resume status": result.resumeStatus,
    "resume phase": result.resumePhase,
    "decision actor": result.decisionActor,
    actor: result.decisionActor,
    rationale: result.rationale,
    status: result.status,
    policy: JSON.stringify(result.policy ?? {}),
    "evidence path": result.evidencePath,
    "status path": result.statusPath,
    "envelope path": result.envelopePath,
    "artifact links": JSON.stringify(result.artifactLinks ?? []),
    noop: result.noop ? "truth" : "lie"
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typed(value)]));
}

function recordRatifyFact(result) {
  const allowed = ["allowed", "approved"].includes(result.state);
  const pending = result.state === "pending";
  const fact = {
    mood: "ya",
    be: "ratify",
    su: { name: `work task ${result.taskId}` },
    ob: pending ? { text: "pending" } : { boolean: allowed },
    mode: pending ? "ask" : (allowed ? "allow" : "deny"),
    totext: { text: result.state },
    fromtext: { text: result.resumeToken },
    accordingto: { name: result.action }
  };
  doRemember(fact);
  emitExchangeSentence(fact);
  return fact;
}

export async function ratify(sentence, { remember: rememberFn = remember } = {}) {
  const worldRoot = resolveWorldRoot({ rememberFn });
  if (!worldRoot) throw new Error("headquarters approval defective: world root is required");
  const taskId = caseText(sentence?.for, { resolveName: false });
  const action = caseText(sentence?.ob, { resolveName: false });
  if (!taskId || !action) throw new Error("headquarters approval defective: task and action are required");
  let result;
  if (sentence?.accordingto) {
    result = await decideHeadquartersApproval(worldRoot, {
      taskId,
      action,
      requestId: caseText(sentence.accordingto, { resolveName: false }),
      resumeToken: caseText(sentence.fromtext, { resolveName: false }),
      decision: caseText(sentence.with, { resolveName: true }),
      actor: caseText(sentence?.as, { resolveName: false }) || "Headquarters",
      rationale: caseText(
        sentence?.totext ?? sentence?.rationale ?? sentence?.via ?? sentence?.by,
        { resolveName: true }
      )
    });
  } else {
    result = await requestHeadquartersApproval(worldRoot, {
      taskId,
      action,
      proposal: proposalValue(sentence),
      now: new Date()
    });
  }
  recordRatifyFact(result);
  return { ob: { map: resultMap(result) }, be: "map" };
}

export default ratify;

const requestSignatures = [
  ["for", "name", "num", "ob", "text", "to", "name", "num", "with", "text"],
  ["for", "name", "num", "ob", "text", "to", "name", "map", "with", "text"],
  ["for", "name", "num", "ob", "text", "with", "text"],
  ["for", "name", "num", "ob", "text", "to", "name", "num", "with", "name", "num"],
  ["for", "text", "ob", "text", "to", "name", "num", "with", "text"],
  ["for", "text", "ob", "text", "with", "text"]
];

const decisionSignatures = [];
const decisionBases = [
  { accordingto: ["text"], for: ["name", "num"], ob: ["text"] },
  { accordingto: ["name", "num"], for: ["name", "num"], ob: ["text"] },
  { accordingto: ["text"], for: ["text"], ob: ["text"] },
  { accordingto: ["text"], for: ["name", "num"], fromtext: ["text"], ob: ["text"] }
];
const decisionTails = [
  {},
  { as: ["text"] },
  { totext: ["text"] },
  { as: ["text"], totext: ["text"] }
];
for (const base of decisionBases) {
  for (const destination of [null, ["name", "num"], ["name", "map"]]) {
    for (const tail of decisionTails) {
      const cases = {
        ...base,
        ...tail,
        with: ["text"]
      };
      if (destination) cases.to = destination;
      decisionSignatures.push([
        ...Object.keys(cases).sort().flatMap(key => [key, ...cases[key]])
      ]);
    }
  }
}

export const signatures = [
  ...requestSignatures.map((tail) => ({ signatureWords: ["be", "ratify", ...tail], handler: ratify })),
  ...decisionSignatures.map((tail) => ({ signatureWords: ["be", "ratify", ...tail], handler: ratify }))
];
