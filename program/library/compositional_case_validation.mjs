import pyashWords from "./pyashWords.json" with { type: "json" };

import {
  COMPOSITIONAL_AXIS_ORDER,
  COMPOSITIONAL_CONTEXT_ORDER,
  compositionalGrid
} from "./compositionalCases.mjs";

const HNUC_PATTERN = /^0x[0-9a-fA-F]{4}$/u;
const KEYWORD_PATTERN = /^[a-z][a-z0-9]*$/u;

function issue(severity, code, path, message) {
  return { severity, code, path, message };
}

function addError(errors, code, path, message) {
  errors.push(issue("error", code, path, message));
}

function addWarning(warnings, code, path, message) {
  warnings.push(issue("warning", code, path, message));
}

function lexiconMap(lexicon) {
  const byEnglish = new Map();
  for (const entry of Array.isArray(lexicon) ? lexicon : []) {
    if (entry?.en && !byEnglish.has(entry.en)) byEnglish.set(entry.en, entry);
  }
  return byEnglish;
}

function validateHnuc(info, path, errors, warnings, { assigned }) {
  const value = info?.hnuc;
  if (value === "0x0000") {
    addError(errors, "UNASSIGNED_HNUC", path, "0x0000 is not an assigned HNUC identity");
    return false;
  }
  if (value == null && !assigned) {
    addWarning(warnings, "UNASSIGNED_HNUC", path, "HNUC is intentionally unassigned; code is not allocated");
    return false;
  }
  if (typeof value !== "string" || !HNUC_PATTERN.test(value)) {
    addError(errors, "MALFORMED_HNUC", path, `HNUC must be a 16-bit hex code, got ${String(value)}`);
    return false;
  }
  const number = Number.parseInt(value.slice(2), 16);
  if (number === 0 || number > 0xffff) {
    addError(errors, "UNASSIGNED_HNUC", path, `${value} is not an assigned 16-bit HNUC identity`);
    return false;
  }
  return true;
}

function validateLexeme(info, path, byEnglish, errors) {
  if (!info?.case) {
    addError(errors, "LEXEME_MISSING", path, "assigned cell must name a canonical lexicon morpheme");
    return null;
  }
  const lexeme = byEnglish.get(info.case);
  if (!lexeme) {
    addError(errors, "LEXEME_MISSING", path, `lexicon has no entry for ${info.case}`);
    return null;
  }
  const mismatches = [];
  if (lexeme.hnuc !== info.hnuc) mismatches.push(`hnuc ${info.hnuc} != ${lexeme.hnuc}`);
  if (lexeme.pya !== info.pya) mismatches.push(`pya ${info.pya} != ${lexeme.pya}`);
  if (mismatches.length > 0) {
    addError(errors, "LEXICON_MISMATCH", path, `${info.case} disagrees with lexicon: ${mismatches.join(", ")}`);
  }
  return lexeme;
}

function validateKeyword(info, path, errors) {
  const keyword = info?.keyword;
  if (typeof keyword !== "string" || keyword.trim() === "") {
    addError(errors, "EMPTY_KEYWORD", path, "keyword must be one lowercase Pyash token, got empty keyword");
    return null;
  }
  if (!KEYWORD_PATTERN.test(keyword)) {
    addError(errors, "INVALID_KEYWORD", path, `keyword must be one lowercase Pyash token, got ${keyword}`);
    return keyword;
  }
  return keyword;
}

function validateUnassignedShape(info, path, errors) {
  if (info?.status !== "unassigned") return false;
  if (info.case != null || info.pya != null || info.hnuc != null) {
    addError(errors, "UNASSIGNED_SHAPE", path, "unassigned entry must use null case, pya, and hnuc fields");
  }
  return true;
}

function sortIssues(issues) {
  const contextRank = new Map(COMPOSITIONAL_CONTEXT_ORDER.map((value, index) => [value, index]));
  const axisRank = new Map(COMPOSITIONAL_AXIS_ORDER.map((value, index) => [value, index]));
  const codeRank = new Map([
    ["AXIS_MISMATCH", 0],
    ["INVALID_KEYWORD", 1],
    ["EMPTY_KEYWORD", 2],
    ["MISSING_CONTEXT", 3],
    ["MISSING_AXIS", 4]
  ]);
  return [...issues].sort((left, right) => {
    const [leftContext, leftAxis = "context"] = left.path.split(".");
    const [rightContext, rightAxis = "context"] = right.path.split(".");
    const contextDifference = (contextRank.get(leftContext) ?? Number.MAX_SAFE_INTEGER)
      - (contextRank.get(rightContext) ?? Number.MAX_SAFE_INTEGER);
    if (contextDifference !== 0) return contextDifference;
    const leftAxisDifference = axisRank.get(leftAxis) ?? -1;
    const rightAxisDifference = axisRank.get(rightAxis) ?? -1;
    if (leftAxisDifference !== rightAxisDifference) return leftAxisDifference - rightAxisDifference;
    return (codeRank.get(left.code) ?? 100) - (codeRank.get(right.code) ?? 100)
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message);
  });
}

function formatIssue(item) {
  return `${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`;
}

export function validateCompositionalCases({ grid = compositionalGrid, lexicon = pyashWords } = {}) {
  const errors = [];
  const warnings = [];
  const byEnglish = lexiconMap(lexicon);
  const seenKeywords = new Map();
  const seenHnucs = new Map();
  let mappings = 0;
  let assignedCodes = 0;
  let knownUnassigned = 0;

  for (const context of Object.keys(grid ?? {})) {
    if (!COMPOSITIONAL_CONTEXT_ORDER.includes(context)) {
      addError(errors, "UNEXPECTED_CONTEXT", `${context}.context`, "grid contains a non-canonical context");
    }
  }

  for (const context of COMPOSITIONAL_CONTEXT_ORDER) {
    const contextEntry = grid?.[context];
    const contextPath = `${context}.context`;
    if (!contextEntry || typeof contextEntry !== "object") {
      addError(errors, "MISSING_CONTEXT", contextPath, "grid context is missing");
      continue;
    }

    if (!contextEntry.context || typeof contextEntry.context !== "object") {
      addError(errors, "MISSING_CONTEXT", contextPath, "context identity is missing");
    }

    const contextUnassigned = validateUnassignedShape(contextEntry.context, contextPath, errors);
    const contextAssigned = !contextUnassigned || contextEntry.context?.hnuc != null;
    if (contextUnassigned) knownUnassigned += 1;
    if (contextEntry.context && validateHnuc(contextEntry.context, contextPath, errors, warnings, { assigned: contextAssigned })) {
      assignedCodes += 1;
      const lexeme = byEnglish.get(contextEntry.context.name);
      if (!lexeme) {
        addError(errors, "LEXEME_MISSING", contextPath, `lexicon has no entry for ${contextEntry.context.name}`);
      } else if (lexeme.hnuc !== contextEntry.context.hnuc || lexeme.pya !== contextEntry.context.pya) {
        addError(errors, "LEXICON_MISMATCH", contextPath, `${contextEntry.context.name} disagrees with lexicon`);
      }
    }

    for (const axis of Object.keys(contextEntry)) {
      if (axis !== "context" && !COMPOSITIONAL_AXIS_ORDER.includes(axis)) {
        addError(errors, "UNEXPECTED_AXIS", `${context}.${axis}`, "grid contains a non-canonical axis");
      }
    }

    for (const axis of COMPOSITIONAL_AXIS_ORDER) {
      mappings += 1;
      const path = `${context}.${axis}`;
      const info = contextEntry[axis];
      if (!info || typeof info !== "object") {
        addError(errors, "MISSING_AXIS", path, "grid axis is missing");
        continue;
      }
      if (info.axis !== axis) {
        addError(errors, "AXIS_MISMATCH", path, `axis must be ${axis}, got ${String(info.axis)}`);
      }
      const keyword = validateKeyword(info, path, errors);
      if (keyword) {
        const previous = seenKeywords.get(keyword);
        if (previous) {
          addError(errors, "DUPLICATE_KEYWORD", path, `keyword ${keyword} is already used at ${previous}`);
        } else {
          seenKeywords.set(keyword, path);
        }
      }
      const unassignedEntry = validateUnassignedShape(info, path, errors);
      const assigned = !unassignedEntry || info.hnuc != null;
      if (unassignedEntry) knownUnassigned += 1;
      const validHnuc = validateHnuc(info, path, errors, warnings, { assigned });
      if (!validHnuc) continue;
      assignedCodes += 1;
      const lexeme = validateLexeme(info, path, byEnglish, errors);
      if (lexeme) {
        const existing = seenHnucs.get(info.hnuc.toLowerCase());
        const identity = `${lexeme.en}\u0000${lexeme.pya}`;
        if (existing && existing.identity !== identity) {
          addError(errors, "HNUC_REUSE_CONFLICT", path, `HNUC ${info.hnuc} conflicts with ${existing.path} (${existing.identity.replace("\u0000", " / ")})`);
        } else if (!existing) {
          seenHnucs.set(info.hnuc.toLowerCase(), { identity, path });
        }
      }
    }
  }

  const orderedErrors = sortIssues(errors);
  const orderedWarnings = sortIssues(warnings);
  const summary = {
    contexts: COMPOSITIONAL_CONTEXT_ORDER.filter(context => grid?.[context]).length,
    mappings,
    assignedCodes,
    knownUnassigned,
    errors: orderedErrors.length,
    warnings: orderedWarnings.length
  };
  return {
    ok: orderedErrors.length === 0,
    errors: orderedErrors,
    warnings: orderedWarnings,
    summary
  };
}

export function formatCompositionalValidationReport(result) {
  const lines = [
    ...(result?.errors ?? []).map(formatIssue),
    ...(result?.warnings ?? []).map(formatIssue)
  ];
  const summary = result?.summary ?? {};
  lines.push(
    `SUMMARY contexts=${summary.contexts ?? 0} mappings=${summary.mappings ?? 0}`
      + ` assignedCodes=${summary.assignedCodes ?? 0} knownUnassigned=${summary.knownUnassigned ?? 0}`
      + ` errors=${summary.errors ?? 0} warnings=${summary.warnings ?? 0}`
  );
  return lines.join("\n");
}

export const formatValidationReport = formatCompositionalValidationReport;
