const INFERABLE_COMPOUND_STATUSES = new Set([
  "lowered-compound",
  "accepted-curated",
  "accepted-delimited",
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm"
]);

function normalizeTerm(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function atomIndex(atomicEntries) {
  if (!Array.isArray(atomicEntries)) throw new TypeError("atomic entries must be an array");
  const atoms = new Map();
  for (const entry of atomicEntries) {
    const english = normalizeTerm(entry?.en);
    if (!english || atoms.has(english)) continue;
    if (typeof entry?.pya !== "string" || !entry.pya.trim()) continue;
    atoms.set(english, {
      english: entry.en,
      pya: entry.pya,
      ...(entry.hnuc === undefined ? {} : { hnuc: entry.hnuc })
    });
  }
  return atoms;
}

function compoundKey(entry, index) {
  return entry?.id ?? `${entry?.language ?? "compound"}:${entry?.surface ?? entry?.target ?? index}`;
}

function inferable(entry) {
  const sequence = entry?.pyashSequence ?? entry?.pyash;
  return INFERABLE_COMPOUND_STATUSES.has(entry?.status)
    && Array.isArray(sequence)
    && sequence.length > 0;
}

function atomForEntry(entry, atoms) {
  const explicit = normalizeTerm(entry?.specificAtom);
  const candidate = explicit || (inferable(entry) ? normalizeTerm(entry?.target) : "");
  return candidate ? atoms.get(candidate) ?? null : null;
}

export function linkCompoundToAtom(entry, { atomicEntries = [] } = {}) {
  if (!entry || typeof entry !== "object") throw new TypeError("compound entry must be an object");
  const atom = atomForEntry(entry, atomIndex(atomicEntries));
  if (!atom) return { ...entry };
  return { ...entry, specificAtom: atom.english };
}

export function buildCompoundAtomLinks({ atomicEntries = [], compoundEntries = [] } = {}) {
  if (!Array.isArray(compoundEntries)) throw new TypeError("compound entries must be an array");
  const atoms = atomIndex(atomicEntries);
  const entries = compoundEntries.map((entry) => {
    if (!entry || typeof entry !== "object") throw new TypeError("compound entries must contain objects");
    const atom = atomForEntry(entry, atoms);
    return atom ? { ...entry, specificAtom: atom.english } : { ...entry };
  });
  const atomToCompounds = new Map();
  const compoundToAtom = new Map();
  for (const [index, entry] of entries.entries()) {
    const atom = atomForEntry(entry, atoms);
    if (!atom) continue;
    const key = compoundKey(entry, index);
    const link = {
      compoundKey: key,
      compound: entry,
      atom
    };
    compoundToAtom.set(key, link);
    const rows = atomToCompounds.get(normalizeTerm(atom.english)) ?? [];
    rows.push(link);
    atomToCompounds.set(normalizeTerm(atom.english), rows);
  }
  for (const rows of atomToCompounds.values()) {
    rows.sort((left, right) => String(left.compound.surface ?? left.compound.target).localeCompare(String(right.compound.surface ?? right.compound.target)));
  }
  return { entries, atomToCompounds, compoundToAtom };
}

export function linkedCompoundAtom(entry, { atomicEntries = [] } = {}) {
  const atom = atomForEntry(entry, atomIndex(atomicEntries));
  return atom ? { ...atom } : null;
}

