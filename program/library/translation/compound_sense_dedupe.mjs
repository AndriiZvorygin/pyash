import { rankPyacCompoundCandidates } from "./pyac_complexity.mjs";

function textOrder(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function sequenceOf(record) {
  return Array.isArray(record?.pyashSequence)
    ? record.pyashSequence.map((part) => String(part ?? "").trim()).filter(Boolean)
    : [];
}

export function compareCompoundSenseRecords(left, right) {
  const leftSequence = sequenceOf(left);
  const rightSequence = sequenceOf(right);
  const lengthOrder = leftSequence.length - rightSequence.length;
  if (lengthOrder !== 0) return lengthOrder;
  const ranked = rankPyacCompoundCandidates([left, right]);
  if (ranked.length !== 2) {
    throw new TypeError("equal-length compound candidates require complete Pyac component layers");
  }
  const sameCandidate = (candidate, original) => (
    candidate.target === original.target
    && sequenceOf(candidate).join(" ") === sequenceOf(original).join(" ")
    && JSON.stringify(candidate.componentLayers) === JSON.stringify(original.componentLayers)
  );
  if (sameCandidate(ranked[0], left) && !sameCandidate(ranked[0], right)) return -1;
  if (sameCandidate(ranked[0], right) && !sameCandidate(ranked[0], left)) return 1;
  return textOrder(left?.target, right?.target)
    || textOrder(leftSequence.join(" "), rightSequence.join(" "));
}

function isOnePartDeletion(longer, shorter) {
  if (longer.length !== shorter.length + 1) return false;
  return longer.some((_, index) => (
    [...longer.slice(0, index), ...longer.slice(index + 1)].join(" ") === shorter.join(" ")
  ));
}

function mergeAliases(winner, records) {
  const winnerTarget = String(winner.target ?? "").trim();
  const aliases = new Set();
  for (const record of records) {
    const target = String(record?.target ?? "").trim();
    if (target && target !== winnerTarget) aliases.add(target);
    for (const alias of Array.isArray(record?.aliases) ? record.aliases : []) {
      const normalized = String(alias ?? "").trim();
      if (normalized && normalized !== winnerTarget) aliases.add(normalized);
    }
  }
  return [...aliases];
}

function decisionIds(record) {
  return [...new Set([
    ...(typeof record?.verificationDecisionId === "string" && record.verificationDecisionId
      ? [record.verificationDecisionId]
      : []),
    ...(Array.isArray(record?.verificationDecisionIds)
      ? record.verificationDecisionIds.filter((id) => typeof id === "string" && id)
      : [])
  ])];
}

export function retireCompoundRecordsAboveMaximum(records = [], maximumComponents = 2) {
  if (!Array.isArray(records)) throw new TypeError("compound retirement requires an array");
  if (!Number.isSafeInteger(maximumComponents) || maximumComponents < 1) {
    throw new TypeError("compound retirement maximum must be a positive integer");
  }
  const retained = [];
  const retirements = [];
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError(`compound row ${index} must be an object`);
    }
    const pyashSequence = sequenceOf(record);
    if (pyashSequence.length <= maximumComponents) {
      retained.push(record);
      continue;
    }
    const senseId = String(record.senseId ?? "").trim();
    if (!senseId) {
      throw new TypeError(`overlength compound row ${index} has no WordNet sense id`);
    }
    retirements.push({
      senseId,
      target: String(record.target ?? "").trim(),
      pyashSequence,
      ...(Array.isArray(record.componentLayers) ? { componentLayers: [...record.componentLayers] } : {}),
      decisionIds: decisionIds(record)
    });
  }
  return {
    records: retained,
    retirements,
    report: {
      retiredRecordCount: retirements.length,
      retiredSenseCount: new Set(retirements.map((row) => row.senseId)).size
    }
  };
}

function mergeDecisionIds(winner, records) {
  const winnerSequence = sequenceOf(winner).join(" ");
  const ids = new Set();
  for (const record of records) {
    if (sequenceOf(record).join(" ") !== winnerSequence) continue;
    for (const id of decisionIds(record)) ids.add(id);
  }
  if (ids.size === 0) return winner;
  return { ...winner, verificationDecisionIds: [...ids] };
}

export function deduplicateCompoundSenseRecords(records = []) {
  if (!Array.isArray(records)) throw new TypeError("compound sense dedupe requires an array");
  const groups = new Map();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError(`compound sense row ${index} must be an object`);
    }
    const senseId = String(record.senseId ?? "").trim();
    if (!senseId) continue;
    const group = groups.get(senseId) ?? [];
    group.push({ record, index });
    groups.set(senseId, group);
  }

  const winners = new Map();
  const removals = [];
  let duplicateSenseCount = 0;
  let shorterSenseCount = 0;
  let directTrimSenseCount = 0;
  let equalLengthTieSenseCount = 0;
  let triplesBefore = 0;
  let triplesAfter = 0;

  for (const [senseId, group] of groups) {
    for (const { record } of group) if (sequenceOf(record).length === 3) triplesBefore += 1;
    const maxLength = Math.max(...group.map(({ record }) => sequenceOf(record).length));
    const shortestLength = Math.min(...group.map(({ record }) => sequenceOf(record).length));
    const shortest = group.filter(({ record }) => sequenceOf(record).length === shortestLength);
    const shortestAlternatives = new Set(shortest.map(({ record }) => sequenceOf(record).join(" ")));
    let winner;
    if (shortestAlternatives.size > 1) {
      const ranked = rankPyacCompoundCandidates(shortest.map(({ record }) => record));
      if (ranked.length !== shortest.length) {
        throw new TypeError(`equal-length compounds for ${senseId} require complete Pyac component layers`);
      }
      const top = ranked[0];
      winner = shortest.find(({ record }) => (
        record.target === top.target
        && sequenceOf(record).join(" ") === sequenceOf(top).join(" ")
        && JSON.stringify(record.componentLayers) === JSON.stringify(top.componentLayers)
      ))?.record;
    } else {
      winner = shortest
        .map(({ record, index }) => ({ record, index }))
        .sort((left, right) => textOrder(left.record.target, right.record.target) || left.index - right.index)[0].record;
    }
    const winnerSequence = sequenceOf(winner);

    if (group.length > 1) duplicateSenseCount += 1;
    if (winnerSequence.length < maxLength) {
      shorterSenseCount += 1;
      if (group.some(({ record }) => isOnePartDeletion(sequenceOf(record), winnerSequence))) {
        directTrimSenseCount += 1;
      }
    }
    if (shortestAlternatives.size > 1) equalLengthTieSenseCount += 1;

    const merged = { ...winner };
    const aliases = mergeAliases(winner, group.map(({ record }) => record));
    if (aliases.length > 0 || group.some(({ record }) => Array.isArray(record.aliases))) {
      merged.aliases = aliases;
    } else {
      delete merged.aliases;
    }
    winners.set(senseId, mergeDecisionIds(merged, group.map(({ record }) => record)));
    if (winnerSequence.length === 3) triplesAfter += 1;

    for (const { record, index } of group) {
      if (record === winner) continue;
      const losingSequence = sequenceOf(record);
      removals.push({
        senseId,
        target: record.target,
        pyashSequence: losingSequence,
        keptTarget: winner.target,
        keptSequence: winnerSequence,
        reason: losingSequence.length > winnerSequence.length
          ? "shorter-compound-for-same-sense"
          : "one-compound-per-sense",
        directOnePartTrim: isOnePartDeletion(losingSequence, winnerSequence),
        decisionIds: decisionIds(record),
        originalIndex: index
      });
    }
  }

  const emitted = new Set();
  const output = [];
  for (const record of records) {
    const senseId = String(record.senseId ?? "").trim();
    if (!senseId) {
      output.push(record);
      continue;
    }
    if (emitted.has(senseId)) continue;
    emitted.add(senseId);
    output.push(winners.get(senseId));
  }

  return {
    records: output,
    removals,
    report: {
      inputRecordCount: records.length,
      outputRecordCount: output.length,
      duplicateSenseCount,
      removedRecordCount: records.length - output.length,
      shorterSenseCount,
      directTrimSenseCount,
      equalLengthTieSenseCount,
      triplesBefore,
      triplesAfter
    }
  };
}
