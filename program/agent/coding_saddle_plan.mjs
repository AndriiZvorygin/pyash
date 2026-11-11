import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../beautiful.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";
import { saddleSessionProfileKey } from "./coding_saddle_state.mjs";

const PLAN_PREFIX = "coding saddle plan ";
const STEP_ID = /^step-(\d{3})$/u;
const STEP_STATES = new Set(["pending", "in_progress", "done", "blocked"]);

export function saddlePlanPath({ agentHouse, sessionName = "coding", sessionFile = "" } = {}) {
  const key = saddleSessionProfileKey({ sessionName, sessionFile });
  return path.join(path.resolve(agentHouse), "conduct", `coding-saddle-plan-${key}.pya`);
}

function textFact(name, value) {
  return sentenceToPyash({ mood: "ya", su: { name }, ob: { text: String(value ?? "") }, be: "text" });
}

function normalizeStepState(value, fallback = "pending") {
  const state = String(value ?? fallback).trim().toLowerCase().replace(/[ -]+/gu, "_");
  if (!STEP_STATES.has(state)) throw new Error(`unknown plan step status: ${state || "(empty)"}`);
  return state;
}

export async function readCodingSaddlePlan(filename) {
  const plan = { objective: "", steps: [] };
  let source;
  try {
    source = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return plan;
    throw error;
  }
  const steps = new Map();
  for (const raw of splitSentences(source, { includeThen: true })) {
    let sentence;
    try { sentence = parse(raw.trim()); } catch { continue; }
    const subject = String(sentence?.su?.name ?? "");
    const value = String(sentence?.ob?.text ?? "");
    if (subject === `${PLAN_PREFIX}objective`) {
      plan.objective = value;
      continue;
    }
    const match = subject.match(/^coding saddle plan step (\d{3}) (title|state|evidence)$/u);
    if (!match) continue;
    const [, ordinal, field] = match;
    const step = steps.get(ordinal) ?? { id: `step-${ordinal}`, title: "", status: "pending", evidence: "" };
    if (field === "title") step.title = value;
    if (field === "state") step.status = normalizeStepState(value);
    if (field === "evidence") step.evidence = value;
    steps.set(ordinal, step);
  }
  plan.steps = [...steps.values()].sort((a, b) => a.id.localeCompare(b.id));
  return plan;
}

function normalizePlanInput(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    throw new Error("plan tool input must be a JSON object with action, objective, and steps or a step update");
  }
  throw new Error("plan tool input must be a JSON object");
}

function normalizeStepId(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const normalized = raw.startsWith("step-") ? raw : `step-${raw.padStart(3, "0")}`;
  if (!STEP_ID.test(normalized)) throw new Error(`invalid plan step id: ${raw || "(empty)"}`);
  return normalized;
}

export function applyCodingSaddlePlanAction(currentPlan, rawInput) {
  const input = normalizePlanInput(rawInput);
  const action = String(input.action ?? "").trim().toLowerCase().replace(/[ -]+/gu, "_");
  if (["create", "replace", "revise", "set"].includes(action)) {
    const objective = String(input.objective ?? "").trim();
    if (!objective) throw new Error("a plan objective is required");
    if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 12) {
      throw new Error("a plan needs between 1 and 12 ordered steps");
    }
    return {
      objective,
      steps: input.steps.map((step, index) => {
        const title = String(step?.title ?? "").trim();
        if (!title) throw new Error(`plan step ${index + 1} needs a title`);
        const status = normalizeStepState(step?.status, "pending");
        const evidence = String(step?.evidence ?? "").trim();
        if (status === "done" && !evidence) throw new Error(`plan step ${index + 1} needs evidence before it can be marked done`);
        return { id: `step-${String(index + 1).padStart(3, "0")}`, title, status, evidence };
      })
    };
  }
  if (action === "update_step") {
    const id = normalizeStepId(input.id ?? input.step);
    const steps = (currentPlan?.steps ?? []).map((step) => ({ ...step }));
    const index = steps.findIndex((step) => step.id === id);
    if (index < 0) throw new Error(`plan step does not exist: ${id}`);
    const status = normalizeStepState(input.status, steps[index].status);
    const evidence = String(input.evidence ?? steps[index].evidence ?? "").trim();
    if (status === "done" && !evidence) throw new Error(`${id} needs evidence before it can be marked done`);
    const title = String(input.title ?? steps[index].title).trim();
    if (!title) throw new Error(`${id} needs a title`);
    steps[index] = { ...steps[index], title, status, evidence };
    return { ...currentPlan, steps };
  }
  throw new Error("plan action must be create, replace, revise, set, or update_step");
}

export async function writeCodingSaddlePlan(filename, plan = {}) {
  const lines = [];
  if (String(plan.objective ?? "").trim()) lines.push(textFact(`${PLAN_PREFIX}objective`, plan.objective));
  for (const [index, step] of (Array.isArray(plan.steps) ? plan.steps : []).entries()) {
    const ordinal = String(index + 1).padStart(3, "0");
    lines.push(textFact(`${PLAN_PREFIX}step ${ordinal} title`, step.title));
    lines.push(textFact(`${PLAN_PREFIX}step ${ordinal} state`, normalizeStepState(step.status)));
    if (step.evidence) lines.push(textFact(`${PLAN_PREFIX}step ${ordinal} evidence`, step.evidence));
  }
  const target = path.resolve(filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}`;
  try {
    await fs.writeFile(temporary, `${lines.join("\n")}\n`, "utf8");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

export async function updateCodingSaddlePlan(filename, rawInput) {
  const current = await readCodingSaddlePlan(filename);
  const next = applyCodingSaddlePlanAction(current, rawInput);
  await writeCodingSaddlePlan(filename, next);
  return next;
}

export async function clearCodingSaddlePlan(filename) {
  await fs.rm(path.resolve(filename), { force: true });
}

export function formatCodingSaddlePlan(plan = {}) {
  if (!String(plan.objective ?? "").trim()) return "No active plan for this session.";
  const lines = [`plan · ${plan.objective}`];
  for (const step of plan.steps ?? []) {
    lines.push(`${step.id} [${step.status}] ${step.title}`);
    if (step.evidence) lines.push(`  evidence: ${step.evidence}`);
  }
  return lines.join("\n");
}
