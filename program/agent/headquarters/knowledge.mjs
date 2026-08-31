import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { splitSentences } from "../../library/sentenceSplitter.mjs";
import {
  compareUtf8Bytes,
  normalizeLinkedClaimBundle,
  resolveLinkedClaimBundle
} from "../../library/knowledge_core.mjs";
import { parse } from "../../understand/index.mjs";
import { assertWorkTask, normalizeWorkTaskId } from "../../runtime/work/contract.mjs";

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../module/headquarters-knowledge.pya"
);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function text(value) {
  return String(value ?? "").trim();
}

function defect(message) {
  throw new Error(`headquarter knowledge defective: ${message}`);
}

function scalarValue(value) {
  if (value?.text !== undefined) return value.text;
  if (value?.name !== undefined) return value.name;
  if (value?.num !== undefined) return value.num;
  if (value?.boolean !== undefined) return value.boolean;
  return undefined;
}

function readSchemaSentences(source, modulePath) {
  const entries = [];
  for (const raw of splitSentences(source, { includeThen: true })) {
    if (!raw.trim()) continue;
    try {
      entries.push(parse(raw.trim()));
    } catch (error) {
      defect(`schema is not parseable: ${modulePath} (${error?.message ?? "parse error"})`);
    }
  }
  return entries;
}

export async function readHeadquartersKnowledgeSchema(modulePath = DEFAULT_SCHEMA_PATH) {
  const resolvedPath = path.resolve(String(modulePath));
  let source;
  try {
    source = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    defect(`schema unavailable: ${resolvedPath}`);
  }
  const entries = readSchemaSentences(source, resolvedPath);
  const header = entries.find(entry => (
    entry?.mood === "def"
      && entry?.be === "map"
      && entry?.su?.name === "headquarter know planned"
  ));
  if (!header) defect(`schema header missing: ${resolvedPath}`);

  const fields = entries.filter(entry => entry?.mood === "ya" && entry?.su?.name);
  const profiles = fields
    .filter(entry => Array.isArray(entry?.ob?.ve?.values) && entry.ob.ve.values.length > 0)
    .map(entry => {
      const values = entry.ob.ve.values.map(value => text(scalarValue(value) ?? value)).filter(Boolean);
      return {
        name: text(values[0]),
        requiredFacets: values
      };
    })
    .filter(profile => profile.name);
  const profileNames = new Set();
  for (const profile of profiles) {
    if (profileNames.has(profile.name)) defect(`schema repeats profile: ${profile.name}`);
    profileNames.add(profile.name);
  }
  if (profiles.length === 0) defect(`schema profiles missing: ${resolvedPath}`);

  const deadlineField = text(
    fields.find(entry => entry?.su?.name === "deadline form")?.ob?.name
      ?? fields.find(entry => entry?.su?.name === "deadline form")?.ob?.text
  );
  if (!deadlineField) defect(`schema deadline field missing: ${resolvedPath}`);

  return {
    modulePath: resolvedPath,
    profiles: profiles.sort((left, right) => compareUtf8Bytes(left.name, right.name)),
    deadlineField
  };
}

function normalizeBundle(value) {
  if (Array.isArray(value)) {
    if (value.every(record => record?.key && record?.payload !== undefined && record?.sentence)) {
      return normalizeLinkedClaimBundle(value.map(record => parse(record.sentence)));
    }
    return normalizeLinkedClaimBundle(value);
  }
  if (value?.records && Array.isArray(value.records)) {
    return normalizeLinkedClaimBundle(value.records.map(record => parse(record.sentence)));
  }
  defect("bundle must contain evidence claims");
}

function subjectName(subjectKey) {
  try {
    const parsed = parse(`${subjectKey} ya`);
    const name = text(parsed?.su?.name);
    if (name) return name;
  } catch {}
  defect(`invalid stable subject ${subjectKey}`);
}

function profileFor(schema, kind) {
  const profile = schema.profiles.find(candidate => candidate.name === kind);
  if (!profile) defect(`unknown schema profile: ${kind}`);
  return profile;
}

function candidateRecords(resolved, facet, label = facet) {
  const projection = resolved.facets?.[facet];
  if (!projection) defect(`missing ${label} facet`);
  if (projection.status === "current" && projection.record) return [projection.record];
  if (projection.status === "contested" && Array.isArray(projection.records) && projection.records.length > 0) {
    return projection.records;
  }
  defect(`${label} facet is ${projection.status}`);
}

function validateDate(value) {
  const date = text(value);
  if (!DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validateDeadline(resolved, schema) {
  const records = candidateRecords(resolved, "deadline", "deadline");
  for (const record of records) {
    const sentence = parse(record.sentence);
    const payload = record.payload;
    const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload) : [];
    if (schema.deadlineField !== "date"
      || sentence.since !== undefined
      || sentence.until !== undefined
      || payloadKeys.length !== 1
      || payload?.date === undefined
      || !validateDate(payload.date)) {
      defect("deadline facet must use an ob date without since or until");
    }
  }
  return records;
}

function referenceNames(resolved, facet, label) {
  return candidateRecords(resolved, facet, label).map(record => {
    const name = text(record.payload?.name);
    if (!name) defect(`${label} reference must use ob name`);
    return name;
  });
}

function requireEntity(entities, type, name) {
  const entity = entities.get(type)?.get(name);
  if (!entity) defect(`missing ${type} reference: ${name}`);
  return entity;
}

function validateTaskIds(workTasks) {
  const tasks = Array.isArray(workTasks) ? workTasks : [];
  const byId = new Map();
  for (const task of tasks) {
    try {
      assertWorkTask(task);
    } catch (error) {
      defect(error?.message ?? "invalid WorkTask");
    }
    const taskId = text(task.taskId);
    if (!taskId || taskId !== normalizeWorkTaskId(taskId)) {
      defect("WorkTask.taskId must be canonical");
    }
    if (byId.has(taskId)) defect(`duplicate WorkTask.taskId: ${taskId}`);
    byId.set(taskId, task);
  }
  return byId;
}

function validateReferences({ entry, resolved, entities, taskIds, schema }) {
  const kind = entry.kind;
  if (kind === "bet") {
    const personNames = referenceNames(resolved, "person", "person");
    const companyNames = referenceNames(resolved, "company", "company");
    validateDeadline(resolved, schema);
    const workerNames = referenceNames(resolved, "worker", "canonical worker");
    for (const personName of personNames) requireEntity(entities, "person", personName);
    for (const companyName of companyNames) requireEntity(entities, "company", companyName);
    for (const workerName of workerNames) {
      if (!entities.get("worker")?.has(workerName) || !taskIds.has(workerName)) {
        defect(`missing canonical worker reference: ${workerName}`);
      }
    }
    return;
  }
  if (kind === "relations") {
    for (const personName of referenceNames(resolved, "person", "person")) {
      requireEntity(entities, "person", personName);
    }
    for (const companyName of referenceNames(resolved, "company", "company")) {
      requireEntity(entities, "company", companyName);
    }
    return;
  }
  if (kind === "contacting") {
    const referenceFacets = ["person", "company"].filter(facet => resolved.facets[facet]);
    if (referenceFacets.length === 0) defect("contacting must reference a person or company");
    for (const referenceFacet of referenceFacets) {
      for (const name of referenceNames(resolved, referenceFacet, referenceFacet)) {
        requireEntity(entities, referenceFacet, name);
      }
    }
  }
}

export async function projectHeadquartersKnowledge({
  bundles = [],
  workTasks = [],
  modulePath = DEFAULT_SCHEMA_PATH
} = {}) {
  if (!Array.isArray(bundles)) defect("bundles must be an array");
  const schema = await readHeadquartersKnowledgeSchema(modulePath);
  const taskIds = validateTaskIds(workTasks);
  const projected = [];
  const entities = new Map([
    ["person", new Map()],
    ["company", new Map()],
    ["worker", new Map()]
  ]);
  const seen = new Set();

  const prepared = bundles.map(entry => {
    const kind = text(entry?.kind ?? entry?.profile);
    const profile = profileFor(schema, kind);
    const bundle = normalizeBundle(entry?.bundle ?? entry?.claims ?? entry);
    const subjectKey = text(bundle.subjectKey);
    const subject = subjectName(subjectKey);
    const identity = `${kind}\u0000${subjectKey}`;
    if (seen.has(identity)) defect(`duplicate ${kind} bundle: ${subjectKey}`);
    seen.add(identity);
    const resolved = resolveLinkedClaimBundle(bundle);
    for (const facet of profile.requiredFacets) {
      candidateRecords(resolved, facet, facet === "deadline" ? "deadline" : facet);
    }
    const provenance = resolveLinkedClaimBundle(bundle, "provenance");
    const status = Object.values(resolved.facets).some(facet => facet.status === "contested")
      ? "contested"
      : "current";
    const projection = { kind, subjectKey, status, facets: resolved.facets, provenance: provenance.facets };
    projected.push(projection);
    if (entities.has(kind)) {
      entities.get(kind).set(subject, projection);
    }
    return { entry, kind, bundle, subjectKey, resolved };
  });

  for (const { kind, resolved } of prepared) {
    validateReferences({
      entry: { kind },
      resolved,
      entities,
      taskIds,
      schema
    });
  }

  projected.sort((left, right) => (
    compareUtf8Bytes(left.subjectKey, right.subjectKey)
      || compareUtf8Bytes(left.kind, right.kind)
  ));
  return { bundles: projected };
}

export { DEFAULT_SCHEMA_PATH as HEADQUARTERS_KNOWLEDGE_SCHEMA_PATH };
