import { parse as parseCsv } from "csv-parse/sync";
import { throwErrorSentence } from "../../../error.mjs";
import { compareUtf8 } from "./util.mjs";

export function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function parseCsvText(text, { source }) {
  const rows = parseCsv(text, {
    relax_column_count: true,
    relax_quotes: false,
    skip_empty_lines: false
  });

  const firstCellText = (row) => String(row?.[0] ?? "").trim();
  const firstCellLower = (row) => firstCellText(row).toLowerCase();
  const nonEmptyRowIndex = rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "")
  );
  if (nonEmptyRowIndex < 0) {
    throwErrorSentence({
      name: "csv header defective",
      message: "csv header defective",
      from: { name: source },
      raw: { rows: rows.length, line: 1, column: 1 }
    });
  }

  const isTemplate = firstCellText(rows[0]) === "Data Import Template";
  let headerRowIndex = -1;
  if (isTemplate) {
    headerRowIndex = rows.findIndex((row) => firstCellText(row) === "Column Name:");
    if (headerRowIndex < 0) {
      throwErrorSentence({
        name: "csv header defective",
        message: "csv header defective",
        from: { name: source },
        raw: { line: 1, column: 1 }
      });
    }
  } else {
    const nonEmptyRows = rows.filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "")
    );
    const tail = nonEmptyRows.slice(-20);
    const counts = new Map();
    for (const row of tail) {
      const width = Array.isArray(row) ? row.length : 0;
      if (width <= 0) continue;
      counts.set(width, (counts.get(width) ?? 0) + 1);
    }
    let widthMode = 0;
    let bestCount = -1;
    for (const [width, count] of counts.entries()) {
      if (count > bestCount || (count === bestCount && width > widthMode)) {
        widthMode = width;
        bestCount = count;
      }
    }
    const headerLike = (row) => {
      const cells = Array.isArray(row) ? row : [];
      if (cells.length !== widthMode) return false;
      let hasAlpha = false;
      for (const cell of cells) {
        const text = String(cell ?? "").trim();
        if (!text) return false;
        if (/[A-Za-z]/.test(text)) hasAlpha = true;
        if (/^\d+(\.\d+)?$/.test(text)) return false;
      }
      return hasAlpha;
    };
    headerRowIndex = rows.findIndex((row) => headerLike(row));
    if (headerRowIndex < 0) {
      headerRowIndex = rows.findIndex((row) =>
        Array.isArray(row) && row.length === widthMode
      );
    }
  }

  if (headerRowIndex < 0) headerRowIndex = nonEmptyRowIndex;

  const headerRow = rows[headerRowIndex] || [];
  const headerRaw = isTemplate ? headerRow.slice(1) : headerRow;
  const dropIndices = new Set();
  if (isTemplate) {
    headerRaw.forEach((cell, idx) => {
      const raw = String(cell ?? "").trim();
      if (raw === "" || raw === "~") dropIndices.add(idx);
    });
  }
  const filteredHeader = headerRaw.filter((_, idx) => !dropIndices.has(idx));
  let canonical = isTemplate
    ? filteredHeader.map((cell) => String(cell ?? ""))
    : filteredHeader.map((cell) =>
      String(cell ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    );
  if (isTemplate) {
    const counts = new Map();
    canonical = canonical.map((key) => {
      const base = String(key ?? "");
      if (!base.trim()) return key;
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      if (count === 0) return base;
      return `${base} ${count + 1}`;
    });
  }

  const seen = new Set();
  const headerColumnOffset = isTemplate ? 2 : 1;
  const filteredIndexMap = headerRaw
    .map((_, idx) => idx)
    .filter((idx) => !dropIndices.has(idx));
  for (let i = 0; i < canonical.length; i += 1) {
    const key = canonical[i];
    const trimmedKey = String(key ?? "").trim();
    if (!trimmedKey) {
      throwErrorSentence({
        name: "csv header defective",
        message: "csv header defective",
        from: { name: source },
        raw: { key, line: headerRowIndex + 1, column: filteredIndexMap[i] + headerColumnOffset }
      });
    }
    if (!isTemplate && seen.has(key)) {
      throwErrorSentence({
        name: "csv header defective",
        message: `csv header defective: duplicate header key ${key}`,
        from: { name: source },
        raw: { key, line: headerRowIndex + 1, column: filteredIndexMap[i] + headerColumnOffset }
      });
    }
    seen.add(key);
  }

  const width = canonical.length;
  if (width === 0) {
    throwErrorSentence({
      name: "csv header defective",
      message: "csv header defective",
      from: { name: source },
      raw: { line: headerRowIndex + 1, column: headerColumnOffset }
    });
  }
  const columns = canonical.map(() => []);
  const metaLabels = new Set([
    "column name:",
    "mandatory:",
    "type:",
    "info:",
    "doctype:",
    "column labels:",
    "start entering data below this line"
  ]);
  let dataStart = headerRowIndex + 1;
  if (isTemplate) {
    const startIndex = rows.findIndex(
      (row, idx) => idx > headerRowIndex && firstCellLower(row) === "start entering data below this line"
    );
    if (startIndex >= 0) dataStart = startIndex + 1;
  }
  for (let r = dataStart; r < rows.length; r += 1) {
    const rowCells = rows[r] || [];
    const firstLower = firstCellLower(rowCells);
    if (isTemplate && (metaLabels.has(firstLower))) continue;
    if (isTemplate && rowCells.every((cell) => String(cell ?? "").trim() === "")) continue;
    const dataCells = (isTemplate ? rowCells.slice(1) : rowCells).filter(
      (_, idx) => !dropIndices.has(idx)
    );
    if (dataCells.length > width) {
      throwErrorSentence({
        name: "csv row defective",
        message: "csv row defective",
        from: { name: source },
        raw: { row: r, line: r + 1, column: dataCells.length + (isTemplate ? 1 : 0) }
      });
    }
    while (dataCells.length < width) dataCells.push("");
    for (let c = 0; c < width; c += 1) {
      columns[c].push(String(dataCells[c] ?? ""));
    }
  }

  return { headerRaw: filteredHeader, header: canonical, columns };
}
